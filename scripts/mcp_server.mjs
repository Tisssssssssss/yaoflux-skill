#!/usr/bin/env node
/**
 * YAO FLUX · MCP Server（stdio，零依赖）
 *
 * 这是「主流 Agent 装上即可用」的统一入口：WorkBuddy / Codex CLI /
 * Claude Code / DeepSeek Harness 等只要支持 MCP stdio，把本文件注册为
 * 一个 MCP server，就能直接调用 yaoflux_* 工具把会话事件推给看板。
 *
 * 协议：JSON-RPC 2.0，stdin/stdout 每行一条消息；stdout 只输出协议消息，
 *       所有日志走 stderr（MCP 规范硬性要求）。
 *
 * 网关：优先复用 127.0.0.1:8787 上已有的 YAO FLUX relay；没有就由本进程
 *       内联拉起，多个 Agent 同时在线时不会端口冲突。
 *
 * 边界：只上报结构化事件，不读会话正文 / 日志 / 云数据，不上云、不落盘。
 */
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayServer, DEFAULT_PORT } from './event_relay.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(HERE, '../agents.json');
const PORT = Number(process.env.YAOFLUX_PORT || DEFAULT_PORT);
const ORIGIN = 'http://127.0.0.1:' + PORT;
const VERSION = '0.2.0';

function log(...args) { console.error('[yaoflux-mcp]', ...args); }
function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function registry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); }
  catch { return { agents: [], summary: {} }; }
}
function agentMeta(id) {
  const a = (registry().agents || []).find(x => x.id === id);
  return a ? { agent_name: a.name, capability: a.capability } : {};
}

/* ---------- 回环网关：复用已有实例，否则内联拉起 ---------- */
let relayState = null;
async function ensureRelay() {
  if (relayState) return relayState;
  try {
    const r = await fetch(ORIGIN + '/health', { signal: AbortSignal.timeout(700) });
    const j = await r.json();
    if (j && j.service === 'yaoflux-event-relay') {
      relayState = { owned: false, port: PORT };
      log('reusing existing relay on', ORIGIN);
      return relayState;
    }
  } catch { /* 没有现成网关 */ }
  const relay = createRelayServer({ port: PORT });
  try {
    await relay.listen();
    relayState = { owned: true, port: PORT, relay };
    log('in-process relay started on', ORIGIN);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      relayState = { owned: false, port: PORT };
      log('port busy, reusing', ORIGIN);
    } else throw err;
  }
  return relayState;
}

/** 投递一条或多条事件；失败时尝试拉起网关再重试一次 */
async function postEvents(list) {
  await ensureRelay();
  const body = JSON.stringify({ events: list });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(ORIGIN + '/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(2500),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'relay rejected event');
      return j;
    } catch (err) {
      if (attempt === 1) throw err;
      relayState = null;                 // 可能是旧网关已退出，重拉
      await ensureRelay();
    }
  }
}

/** 把 MCP 工具参数归一化成 relay 认识的事件对象 */
function toEvent(args) {
  const platform = String(args.platform || args.agent_id || 'unknown').slice(0, 64);
  const evt = {
    ts: Number.isFinite(args.ts) ? args.ts : Date.now(),
    platform,
    ...agentMeta(platform),
    session_id: String(args.session_id || (platform + ':session')).slice(0, 96),
    role: String(args.role || 'assistant').slice(0, 16),
    kind: String(args.kind || 'message').slice(0, 24),
    text: String(args.text == null ? '' : args.text).slice(0, 500),
  };
  const OPT = ['content', 'thread', 'speaker', 'tool', 'file', 'op', 'task'];
  for (const k of OPT) if (typeof args[k] === 'string' && args[k].length) evt[k] = args[k];
  for (const k of ['tokens', 'turn', 'duration_ms']) if (Number.isFinite(args[k])) evt[k] = args[k];
  if (typeof args.agent_name === 'string') evt.agent_name = args.agent_name.slice(0, 64);
  return evt;
}

/* ---------- MCP 工具定义 ---------- */
const EVENT_PROPS = {
  agent_id: { type: 'string', description: '来源 Agent 的 id，必须对应 agents.json（如 workbuddy / codex-cli / deepseek-harness / claude-code）。页面据此分源。' },
  kind: { type: 'string', description: '事件类型', enum: ['message', 'plan', 'tool_call', 'tool_result', 'file', 'search', 'todo', 'done', 'error'] },
  text: { type: 'string', description: '脱敏摘要（不要放会话正文、密钥、个人信息）' },
  content: { type: 'string', description: '可选：话轮正文片段；缺省时页面只用 text 摘要，绝不补写' },
  session_id: { type: 'string', description: '会话 id；同一个 id 的事件会在 INVESTIGATION FEED 聚成一个话轮' },
  role: { type: 'string', enum: ['user', 'assistant', 'tool', 'system'] },
  tool: { type: 'string', description: '工具名，如 Read / Edit / Bash' },
  file: { type: 'string', description: '涉及的文件路径（仅路径，不含内容）' },
  op: { type: 'string', description: '操作类型，如 read / write / exec' },
  task: { type: 'string', description: '当前任务摘要' },
  tokens: { type: 'number', description: '本步 token 消耗（没有真实数据就不要传）' },
  duration_ms: { type: 'number', description: '耗时毫秒（没有真实数据就不要传）' },
  turn: { type: 'number', description: '话轮序号' },
  thread: { type: 'string', description: '主题头' },
  speaker: { type: 'string', description: '说话人' },
};

const TOOLS = [
  {
    name: 'yaoflux_emit',
    title: '上报一条 Agent 事件',
    description: '把当前会话的一个结构化事件（计划 / 工具调用 / 结果 / 完成 / 错误）实时推给 YAO FLUX 看板。只传脱敏摘要与元数据，不要传会话正文或密钥。',
    inputSchema: { type: 'object', properties: EVENT_PROPS, required: ['agent_id', 'kind'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'yaoflux_emit_batch',
    title: '批量上报事件',
    description: '一次上报多条事件（最多 50 条），用于补齐一段执行推理链。',
    inputSchema: {
      type: 'object',
      properties: { events: { type: 'array', items: { type: 'object', properties: EVENT_PROPS, required: ['agent_id', 'kind'] }, maxItems: 50 } },
      required: ['events'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'yaoflux_status',
    title: '查询 YAO FLUX 网关状态',
    description: '返回事件网关是否在线、已接收事件数、SSE 客户端数、重放条数与看板地址。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'yaoflux_open',
    title: '获取看板地址',
    description: '返回可直接用浏览器打开的 YAO FLUX 看板 URL（自动带上 relay 参数，打开即为 LIVE 模式）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'yaoflux_agents',
    title: '列出已识别的本机 Agent',
    description: '返回只读注册表摘要：各 Agent 的 id、名称、能力档（L1/L2/L3）与是否启用，用于确认 emit 时该填哪个 agent_id。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
];

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text: String(text) }], isError };
}

async function callTool(name, args) {
  switch (name) {
    case 'yaoflux_emit': {
      const r = await postEvents([toEvent(args)]);
      return textResult('已上报 1 条事件（seq=' + r.event.seq + '，来源 ' + (args.agent_id || args.platform) + '）。看板：' + ORIGIN + '/');
    }
    case 'yaoflux_emit_batch': {
      const list = (args.events || []).map(toEvent);
      if (!list.length) return textResult('events 为空，未上报', true);
      const r = await postEvents(list);
      return textResult('已上报 ' + r.count + ' 条事件，累计 ' + r.received + ' 条。看板：' + ORIGIN + '/');
    }
    case 'yaoflux_status': {
      await ensureRelay();
      let health;
      try {
        const res = await fetch(ORIGIN + '/health', { signal: AbortSignal.timeout(1200) });
        health = await res.json();
      } catch (err) { return textResult('网关不可达：' + err.message, true); }
      return textResult(JSON.stringify({ ...health, board: ORIGIN + '/', relay_owned_by_this_process: !!relayState?.owned }, null, 2));
    }
    case 'yaoflux_open':
      await ensureRelay();
      return textResult(ORIGIN + '/');
    case 'yaoflux_agents': {
      const reg = registry();
      const agents = (reg.agents || []).map(a => ({ id: a.id, name: a.name, capability: a.capability, enabled: !!a.enabled }));
      return textResult(JSON.stringify({ summary: reg.summary, agents }, null, 2));
    }
    default:
      return textResult('未知工具：' + name, true);
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      // 回显客户端协议版本，兼容 2024-11-05 ~ 2025-11-25 各版客户端
      ensureRelay().catch(err => log('relay prestart failed:', err.message));
      return {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'yaoflux', version: VERSION },
        instructions: 'YAO FLUX 实时观象台。启用后请在关键节点调用 yaoflux_emit 上报结构化事件（脱敏摘要，不传会话正文）；用 yaoflux_open 获取看板地址。',
      };
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS };
    case 'tools/call': {
      const name = params.name;
      const args = params.arguments || {};
      try { return await callTool(name, args); }
      catch (err) { return textResult('调用失败：' + err.message, true); }
    }
    case 'resources/list': return { resources: [] };
    case 'resources/templates/list': return { resourceTemplates: [] };
    case 'prompts/list': return { prompts: [] };
    case 'notifications/initialized':
    case 'notifications/cancelled': return {};
    default:
      throw Object.assign(new Error('Method not found: ' + method), { code: -32601 });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); }
  catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const { id, method, params } = msg || {};
  if (typeof method !== 'string') return;
  try {
    const result = await dispatch(method, params || {});
    if (id !== undefined) write({ jsonrpc: '2.0', id, result });
  } catch (err) {
    log('request failed:', method, err.message);
    if (id !== undefined) write({ jsonrpc: '2.0', id, error: { code: err.code || -32603, message: err.message } });
  }
});
rl.on('close', () => {
  if (relayState?.owned?.relay) {
    try { relayState.owned.relay.server.close(); } catch { /* already closed */ }
  }
  process.exit(0);
});
log('stdio server ready, version', VERSION);
