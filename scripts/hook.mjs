#!/usr/bin/env node
/**
 * YAO FLUX · 通用事件 Hook（stdin JSON → 回环网关）
 *
 * 给支持 Hooks 的 Agent（Claude Code 等）用：工具调用前后、响应结束时由
 * 运行时自动调用本脚本，无需模型主动配合，这是唯一的「真·自动」通道。
 *
 * 安全边界：
 *   - 只读 stdin 的元数据字段，**绝不读取 transcript_path 指向的会话文件**；
 *   - 不采集会话正文、工具返回内容、命令输出；text 只写「工具名 + 文件路径」；
 *   - 只 POST 到 127.0.0.1，不上云、不落盘；
 *   - 任何失败都静默退出 0，绝不返回非 0 阻塞用户的正常操作。
 *
 * Claude Code settings.json 片段见 config/claude-hooks.json。
 */
const PORT = Number(process.env.YAOFLUX_PORT || 8787);
const ORIGIN = 'http://127.0.0.1:' + PORT;
const AGENT = process.env.YAOFLUX_AGENT || 'claude-code';

const KIND = {
  PreToolUse: 'tool_call',
  PostToolUse: 'tool_result',
  Stop: 'done',
  SubagentStop: 'done',
  UserPromptSubmit: 'message',
  SessionStart: 'message',
  SessionEnd: 'done',
  Notification: 'message',
  PreCompact: 'message',
};

function summarize(d) {
  const ev = d.hook_event_name || 'unknown';
  const tool = d.tool_name || '';
  const input = d.tool_input && typeof d.tool_input === 'object' ? d.tool_input : {};
  const file = input.file_path || input.path || input.notebook_path || '';
  return [ev, tool, file].filter(Boolean).join(' ').slice(0, 200);
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 64 * 1024) break;
  }
  let d;
  try { d = JSON.parse(raw || '{}'); }
  catch { return; }
  if (!d || typeof d !== 'object') return;

  const input = d.tool_input && typeof d.tool_input === 'object' ? d.tool_input : {};
  const file = input.file_path || input.path || input.notebook_path || '';
  const evt = {
    platform: AGENT,
    kind: KIND[d.hook_event_name] || 'message',
    role: d.hook_event_name === 'UserPromptSubmit' ? 'user' : 'assistant',
    session_id: String(d.session_id || (AGENT + ':session')).slice(0, 96),
    text: summarize(d),
    tool: String(d.tool_name || '').slice(0, 60),
  };
  if (typeof file === 'string' && file.length) evt.file = file.slice(0, 160);

  try {
    await fetch(ORIGIN + '/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
      signal: AbortSignal.timeout(1500),
    });
  } catch { /* 网关未启动也不影响 Agent 正常工作 */ }
}

main().catch(() => {}).finally(() => { process.exit(0); });
