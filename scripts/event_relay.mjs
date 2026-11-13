#!/usr/bin/env node
/**
 * YAO FLUX · 统一事件网关（零依赖，本地回环）
 *
 * 位置：所有 Agent 的实时事件都汇到这里，再由页面用 SSE 消费。
 *   Agent 侧：MCP 工具 / Hook / CLI  → POST /emit
 *   页面侧：GET /dashboard（自动带 ?relay=）+ GET /events SSE
 *
 * 安全边界（不可放宽）：
 *   - 只监听 127.0.0.1，不对外暴露；
 *   - 不扫描磁盘、不读取任何 Agent 会话文件 / 日志 / 云同步数据；
 *   - 只接收「外部主动投递」的结构化事件，字段走白名单并逐项限长；
 *   - 事件只存在进程内存里（默认 40 条重放），不落盘、不上云。
 *
 * 两种运行方式：
 *   1) 独立常驻： node event_relay.mjs [port]
 *   2) 被 MCP Server 内联拉起： import { createRelayServer } from './event_relay.mjs'
 *      端口已被占用时调用方复用已有网关，不重复监听。
 *
 * 用法：
 *   node scripts/event_relay.mjs 8787
 *   浏览器打开 http://127.0.0.1:8787/   （自动跳转到带 ?relay= 的看板）
 *   curl -X POST http://127.0.0.1:8787/emit -H 'Content-Type: application/json' \
 *        -d '{"platform":"workbuddy","kind":"tool_call","text":"读取源码",
 *             "session_id":"conv_01","tool":"Read","file":"lab.html"}'
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = Number(process.env.YAOFLUX_PORT || 8787);
export const MAX_HISTORY = Number(process.env.YAOFLUX_HISTORY || 40);
// 标准单 Skill 布局：HERE = <root>/scripts，资产与注册表在包根，上溯一级
const DASHBOARD = path.resolve(HERE, '../assets/yaoflux.html');
const REGISTRY = path.resolve(HERE, '../agents.json');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

function frame(obj) { return 'data: ' + JSON.stringify(obj) + '\n\n'; }
function json(res, code, obj, extra = {}) {
  res.writeHead(code, { ...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** 只保留看板认识的白名单字段，避免把任意对象透传进页面 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const evt = {
    ts: Number.isFinite(raw.ts) ? raw.ts : Date.now(),
    // platform 必须对应 agents.json 里的 agent.id，页面按它分源
    platform: String(raw.platform || raw.agent_id || 'unknown').slice(0, 64),
    agent_name: String(raw.agent_name || '').slice(0, 64),
    capability: String(raw.capability || 'unknown').slice(0, 16),
    session_id: String(raw.session_id || '').slice(0, 96),
    role: String(raw.role || 'assistant').slice(0, 16),
    kind: String(raw.kind || 'message').slice(0, 24),
    text: (raw.text == null ? '' : String(raw.text)).slice(0, 500),
    tokens: Number.isFinite(raw.tokens) ? raw.tokens : null,
    origin: 'LIVE',
  };
  // 对话细节（P1 通道）：缺 content 时页面只用 text 摘要，绝不补写正文
  if (typeof raw.content === 'string' && raw.content.length) evt.content = raw.content.slice(0, 240);
  if (Number.isFinite(raw.turn)) evt.turn = raw.turn;
  if (typeof raw.thread === 'string' && raw.thread.length) evt.thread = raw.thread.slice(0, 80);
  if (typeof raw.speaker === 'string' && raw.speaker.length) evt.speaker = raw.speaker.slice(0, 12);
  if (Array.isArray(raw.context)) evt.context = raw.context.slice(0, 5).map(v => String(v).slice(0, 200));
  // 工作内容字段：全部可选透传，缺失时页面留空，绝不推断
  const tool = raw.tool || raw.tool_name;
  if (typeof tool === 'string' && tool.length) evt.tool = tool.slice(0, 60);
  const file = raw.file || raw.path;
  if (typeof file === 'string' && file.length) evt.file = file.slice(0, 160);
  if (typeof raw.op === 'string' && raw.op.length) evt.op = raw.op.slice(0, 12);
  if (typeof raw.task === 'string' && raw.task.length) evt.task = raw.task.slice(0, 160);
  if (Number.isFinite(raw.duration_ms) && raw.duration_ms >= 0) evt.duration_ms = raw.duration_ms;
  return evt;
}

/**
 * 创建（但不自动监听）事件网关。被 CLI 与 MCP Server 共用。
 * @returns {{server, port, state, broadcast, normalize, listen: () => Promise<void>}}
 */
export function createRelayServer(options = {}) {
  const port = Number(options.port || DEFAULT_PORT);
  const clients = new Set();
  const history = [];
  let received = 0;
  const startedAt = Date.now();
  const state = () => ({
    ok: true, service: 'yaoflux-event-relay', port,
    clients: clients.size, received, replay: history.length,
    uptime_ms: Date.now() - startedAt,
  });

  function broadcast(evt) {
    const item = { seq: ++received, ...evt };   // seq 供页面去重续传
    history.push(item);
    if (history.length > MAX_HISTORY) history.shift();
    const line = frame(item);
    for (const res of clients) {
      try { res.write(line); } catch { clients.delete(res); }
    }
    return item;
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { return json(res, 400, { ok: false, error: 'bad url' }); }

    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

    // 根路径自动带上 relay 参数打开看板，用户只需访问一个地址
    if (req.method === 'GET' && url.pathname === '/') {
      const actual = (server.address() && server.address().port) || port;
      const origin = 'http://127.0.0.1:' + actual;
      res.writeHead(302, { ...CORS, Location: '/dashboard?relay=' + encodeURIComponent(origin), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/dashboard') {
      if (!fs.existsSync(DASHBOARD)) return json(res, 404, { ok: false, error: 'dashboard not found: ' + DASHBOARD });
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(DASHBOARD).pipe(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected · YAO FLUX event relay\n\n');
      const since = Number(url.searchParams.get('since') || 0);
      for (const evt of history) if (evt.seq > since) res.write(frame(evt));
      clients.add(res);
      const keep = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15000);
      req.on('close', () => { clearInterval(keep); clients.delete(res); });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/history') {
      return json(res, 200, { ok: true, events: history });
    }

    if (req.method === 'GET' && url.pathname === '/agents') {
      try {
        const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
        return json(res, 200, { ok: true, registry: reg });
      } catch (err) {
        return json(res, 500, { ok: false, error: 'registry unreadable: ' + err.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/emit') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => {
        let raw;
        try { raw = JSON.parse(body || '{}'); }
        catch { return json(res, 400, { ok: false, error: 'invalid json' }); }
        // 兼容批量投递：{ events: [...] } 或裸数组
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw.events) ? raw.events : [raw]);
        if (list.length > 50) return json(res, 413, { ok: false, error: 'max 50 events per request' });
        const sent = [];
        for (const item of list) {
          const evt = normalize(item);
          if (evt) sent.push(broadcast(evt));
        }
        if (!sent.length) return json(res, 400, { ok: false, error: 'event must be a JSON object' });
        return json(res, 200, { ok: true, received, clients: clients.size, count: sent.length, event: sent[sent.length - 1] });
      });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/status')) {
      return json(res, 200, state());
    }

    return json(res, 404, { ok: false, error: 'not found' });
  });

  server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* closed */ } });

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = err => { server.removeListener('listening', onListen); reject(err); };
      const onListen = () => { server.removeListener('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListen);
      server.listen(port, '127.0.0.1');
    });
  }

  return { server, port, state, broadcast, normalize, history, clients, listen };
}

/** 直接运行时前台常驻；作为模块被 import 时不自动启动 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || DEFAULT_PORT);
  const relay = createRelayServer({ port });
  relay.listen().then(() => {
    const origin = 'http://127.0.0.1:' + port;
    console.log('YAO FLUX relay listening on ' + origin);
    console.log('  board  GET  ' + origin + '/');
    console.log('  SSE    GET  /events?since=<seq>');
    console.log('  snap   GET  /history');
    console.log('  emit   POST /emit');
    console.log('  health GET  /health');
  }).catch(err => {
    if (err.code === 'EADDRINUSE') {
      console.error('[yaoflux] port ' + port + ' already in use — assuming an existing relay is serving.');
      process.exit(0);
    }
    console.error('[yaoflux] relay failed:', err.message);
    process.exit(1);
  });
}
