/** Claude Code 适配器：Hooks 自动上报（唯一无需模型配合的真·自动通道） */
import { subscribeRelay } from '../relay_client.mjs';

export const id = 'claude-code';
export const label = 'Claude Code';
export const capability = 'L1';
export const transport = 'Hooks (PostToolUse / Stop) → hook.mjs';
export const auto = true;                  // 运行时自动触发，模型无需调用任何工具
export const configSnippet = '../../config/claude-hooks.json';
export const platformIds = ['claude-code', 'claude'];

export function matches(evt) { return platformIds.includes(evt.platform); }

export function detect() {
  return { sources: ['~/.claude/settings.json', 'claude (PATH)'], evidence: 'config + cli' };
}
export function capabilities() {
  return {
    level: capability, realtime: true, auto, transport,
    caveat: 'Hook 只读 stdin 元数据（工具名 / 文件路径），绝不读取 transcript_path 会话文件；也可用 MCP 补充语义事件',
    session_text: false,
  };
}
export function subscribe(emit, opts = {}) {
  return subscribeRelay({ filter: matches, onEvent: emit, onStatus: opts.onStatus });
}
export function install() {
  return {
    requires_confirmation: true,
    steps: [
      { action: 'merge-json', file: '~/.claude/settings.json', key: 'hooks.PostToolUse / hooks.Stop' },
      { action: 'verify', note: '重启后执行一次工具调用，看板 AGENT DATA STREAM 应出现 tool_result' },
    ],
  };
}
