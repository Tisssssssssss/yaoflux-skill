#!/usr/bin/env node
/**
 * YAO FLUX · 命令行入口
 *
 *   node bin/yaoflux.mjs start [--port 8787] [--open]
 *   node bin/yaoflux.mjs status
 *   node bin/yaoflux.mjs emit '{"platform":"workbuddy","kind":"tool_call","text":"..."}'
 *   node bin/yaoflux.mjs emit --agent workbuddy --kind tool_call --text "读取源码" --tool Read
 *   node bin/yaoflux.mjs watch
 *   node bin/yaoflux.mjs install            # 默认 dry-run，只输出计划
 *   node bin/yaoflux.mjs install --apply    # 明确确认后才写用户目录
 *   node bin/yaoflux.mjs uninstall --apply
 *   node bin/yaoflux.mjs doctor
 *   node bin/yaoflux.mjs mcp               # 以 stdio 模式运行 MCP Server
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRelayServer, DEFAULT_PORT } from '../scripts/event_relay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const PORT = Number(opt('--port') || process.env.YAOFLUX_PORT || DEFAULT_PORT);
const ORIGIN = 'http://127.0.0.1:' + PORT;

function opt(name, def) {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
}
function has(flag) { return argv.includes(flag); }
function out(...a) { console.log(...a); }
function fail(msg) { console.error('[yaoflux] ' + msg); process.exitCode = 1; }

async function getJSON(url, timeout = 1500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  return r.json();
}

function boardURL() { return ORIGIN + '/'; }

/* ---------------- start ---------------- */
async function start() {
  const relay = createRelayServer({ port: PORT });
  try { await relay.listen(); }
  catch (err) {
    if (err.code === 'EADDRINUSE') {
      try {
        const h = await getJSON(ORIGIN + '/health');
        if (h.service === 'yaoflux-event-relay') {
          out('已有 YAO FLUX 网关在运行，直接复用：' + boardURL());
          if (has('--open')) openBrowser(boardURL());
          return;
        }
      } catch { /* 端口被别的服务占用 */ }
      return fail('端口 ' + PORT + ' 被其它程序占用，可用 --port 换一个');
    }
    return fail('网关启动失败：' + err.message);
  }
  out('YAO FLUX 实时网关已启动');
  out('  看板   ' + boardURL());
  out('  SSE    ' + ORIGIN + '/events');
  out('  投递   POST ' + ORIGIN + '/emit');
  out('  健康   ' + ORIGIN + '/health');
  out('  停止   Ctrl+C');
  if (has('--open')) openBrowser(boardURL());
  // 前台常驻：保持事件循环
  process.on('SIGINT', () => { out('\n已停止'); relay.server.close(() => process.exit(0)); });
}

function openBrowser(url) {
  const bin = process.platform === 'darwin' ? 'open' : (process.platform === 'linux' ? 'xdg-open' : null);
  if (!bin) return out('请手动打开：' + url);
  const p = spawn(bin, [url], { stdio: 'ignore', detached: false });
  p.on('error', () => out('请手动打开：' + url));
}

/* ---------------- status ---------------- */
async function status() {
  try {
    const h = await getJSON(ORIGIN + '/health');
    out('网关     在线 (' + ORIGIN + ')');
    out('已收事件 ' + h.received);
    out('SSE 连接 ' + h.clients);
    out('可重放   ' + h.replay);
    out('运行时长 ' + Math.round(h.uptime_ms / 1000) + 's');
    out('看板     ' + boardURL());
  } catch (err) {
    out('网关     离线 (' + err.message + ')');
    out('启动方式 node bin/yaoflux.mjs start');
    process.exitCode = 1;
  }
}

/* ---------------- emit ---------------- */
async function emit() {
  let payload;
  const inline = argv.slice(1).find(a => !a.startsWith('--'));
  if (inline && inline.trim().startsWith('{')) {
    try { payload = JSON.parse(inline); }
    catch (err) { return fail('JSON 解析失败：' + err.message); }
  } else {
    const keys = ['agent', 'platform', 'kind', 'text', 'content', 'session', 'role', 'tool', 'file', 'op', 'task', 'tokens', 'turn', 'thread', 'speaker'];
    payload = {};
    for (const k of keys) {
      const v = opt('--' + k);
      if (v && v !== true) payload[k] = v;
    }
    if (!payload.agent && !payload.platform) return fail('缺少 --agent <id>（如 workbuddy / codex-cli）');
    if (!payload.kind) return fail('缺少 --kind <类型>');
  }
  const evt = {
    platform: payload.platform || payload.agent || 'unknown',
    kind: payload.kind || 'message',
    text: payload.text || '',
  };
  const map = { content: 'content', session: 'session_id', role: 'role', tool: 'tool', file: 'file', op: 'op', task: 'task', thread: 'thread', speaker: 'speaker' };
  for (const [k, target] of Object.entries(map)) if (payload[k] != null) evt[target] = payload[k];
  for (const k of ['tokens', 'turn']) if (payload[k] != null && Number.isFinite(Number(payload[k]))) evt[k] = Number(payload[k]);
  try {
    const r = await fetch(ORIGIN + '/emit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt), signal: AbortSignal.timeout(2500),
    });
    const j = await r.json();
    if (!j.ok) return fail('投递失败：' + j.error);
    out('已投递 seq=' + j.event.seq + ' · ' + evt.platform + ' / ' + evt.kind);
  } catch (err) {
    fail('无法连接网关：' + err.message + '（先运行 start，或让已装好的 MCP Server 拉起内联网关）');
  }
}

/* ---------------- watch ---------------- */
async function watch() {
  out('监听 ' + ORIGIN + '/events … Ctrl+C 退出');
  try {
    const res = await fetch(ORIGIN + '/events');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const p of parts) {
        const line = p.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        try {
          const e = JSON.parse(line.slice(6));
          out('[' + e.seq + '] ' + e.platform + ' / ' + e.kind + '  ' + (e.text || e.tool || ''));
        } catch { /* skip */ }
      }
    }
  } catch (err) { fail('SSE 断开：' + err.message); }
}

/* ---------------- doctor ---------------- */
async function doctor() {
  const checks = [];
  const push = (ok, name, detail) => checks.push({ ok, name, detail });
  push(Number(process.versions.node.split('.')[0]) >= 18, 'Node.js >= 18', process.version);

  const dash = path.join(ROOT, 'assets', 'yaoflux.html');
  const mcp = path.join(SCRIPTS, 'mcp_server.mjs');
  const relayFile = path.join(SCRIPTS, 'event_relay.mjs');
  push(fs.existsSync(dash), '看板资源', dash);
  push(fs.existsSync(mcp), 'MCP Server', mcp);
  push(fs.existsSync(relayFile), '事件网关', relayFile);

  // Skill 规范校验：包根 SKILL.md 必须是含 name / description 的标准 YAML frontmatter
  const rootSkill = path.join(ROOT, 'SKILL.md');
  const parseFM = p => {
    if (!fs.existsSync(p)) return null;
    const m = fs.readFileSync(p, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const name = (m[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
    let desc = (m[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim();
    if (desc) desc = desc.replace(/^"([\s\S]*)"$/, '$1');
    return { name, desc };
  };
  const fm = parseFM(rootSkill);
  push(!!(fm?.name && fm?.desc), '包根 SKILL.md YAML frontmatter',
    fm ? 'name=' + fm.name + ' / description ' + (fm.desc || '').length + ' 字' : '缺失或缺少 name / description');
  push(fs.existsSync(path.join(ROOT, 'scripts', 'mcp_server.mjs')) &&
       fs.existsSync(path.join(ROOT, 'references', 'agent-detection.md')),
       '标准 Skill 目录布局', 'SKILL.md + scripts/ + references/ 均在包根');

  const home = process.env.HOME;
  const paths = [
    ['WorkBuddy 配置目录', path.join(home, '.workbuddy')],
    ['WorkBuddy MCP 清单', path.join(home, '.workbuddy', 'mcp.json')],
    ['WorkBuddy Skills 目录', path.join(home, '.workbuddy', 'skills')],
    ['Codex 配置', path.join(home, '.codex', 'config.toml')],
    ['Claude Code 设置', path.join(home, '.claude', 'settings.json')],
  ];
  for (const [name, p] of paths) push(fs.existsSync(p), name, p + (fs.existsSync(p) ? '' : '（未安装，跳过）'));

  let online = false;
  try { const h = await getJSON(ORIGIN + '/health'); online = h.service === 'yaoflux-event-relay'; } catch { /* offline */ }
  push(online, '事件网关在线', online ? ORIGIN : '未启动（安装后可由 MCP Server 自动拉起）');

  // MCP 协议握手自检：起一个真子进程，发 initialize / tools/list，检查响应
  const handshake = await new Promise(resolve => {
    if (!fs.existsSync(mcp)) return resolve({ ok: false, detail: 'mcp_server.mjs 缺失' });
    const child = spawn(process.execPath, [mcp], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', tools = 0, initialized = false, timer;
    const done = v => { clearTimeout(timer); try { child.kill(); } catch {} resolve(v); };
    timer = setTimeout(() => done({ ok: false, detail: '握手超时' }), 4000);
    child.stdout.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 1 && m.result?.serverInfo?.name === 'yaoflux') initialized = true;
          if (m.id === 2 && Array.isArray(m.result?.tools)) tools = m.result.tools.length;
          if (initialized && tools) done({ ok: true, detail: tools + ' 个工具：initialize / tools/list 正常' });
        } catch { /* ignore */ }
      }
    });
    child.on('error', err => done({ ok: false, detail: err.message }));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'doctor', version: '1' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  });
  push(handshake.ok, 'MCP 协议握手', handshake.detail);

  for (const c of checks) out((c.ok ? '  OK   ' : '  --   ') + c.name + '  ·  ' + c.detail);
  const bad = checks.filter(c => !c.ok);
  out('\n' + (bad.length ? bad.length + ' 项未就绪（未安装的客户端属正常跳过）' : '全部就绪'));
  out('看板地址 ' + boardURL());
}

/* ---------------- install / uninstall / mcp ---------------- */
async function install(apply, uninstall) {
  const file = path.join(SCRIPTS, 'install.mjs');
  if (!fs.existsSync(file)) return fail('缺少安装器：' + file);
  const mod = await import(pathToFileURL(file).href);
  const result = await mod.runInstall({ root: ROOT, apply, uninstall, targets: opt('--targets') });
  return result;
}

async function runMCP() {
  const mod = path.join(SCRIPTS, 'mcp_server.mjs');
  if (!fs.existsSync(mod)) return fail('缺少 MCP Server：' + mod);
  await import(pathToFileURL(mod).href);   // 该模块自行接管 stdin/stdout
}

function help() {
  out(`YAO FLUX · 实时会话观象台（个人 / 非商业演示）

用法  node bin/yaoflux.mjs <命令> [选项]

  start      前台启动事件网关并托管看板（--port N --open）
  status     查看网关状态
  emit       手动投递一条事件（JSON 字符串或 --agent/--kind/--text）
  watch      终端监听 SSE 事件流
  install    输出安装计划（默认 dry-run，不写任何文件）
             --apply 才真正写入；--targets workbuddy,codex 可缩小范围
  uninstall  输出卸载计划；--apply 才执行
  doctor     环境自检 + MCP 协议握手验证
  mcp        以 stdio 模式运行 MCP Server（供各 Agent 配置引用）
  help       显示本帮助

看板   ${boardURL()}
授权   PolyForm Noncommercial 1.0.0 · ORIGINAL: HALOFLUX by Ryder191`);
}

const handlers = { start, status, emit, watch, doctor, help };
try {
  if (cmd === 'install') await install(has('--apply'), false);
  else if (cmd === 'uninstall') await install(has('--apply'), true);
  else if (cmd === 'mcp') await runMCP();
  else if (handlers[cmd]) await handlers[cmd]();
  else { fail('未知命令：' + cmd); help(); }
} catch (err) {
  fail(err.stack || err.message);
}
