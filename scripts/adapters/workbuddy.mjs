/** WorkBuddy 适配器：MCP stdio + Skill 主动上报 */
import { subscribeRelay } from '../relay_client.mjs';

export const id = 'workbuddy';
export const label = 'WorkBuddy';
export const capability = 'L1';
export const transport = 'MCP stdio (yaoflux_emit)';
export const auto = false;                 // 需 Skill 在关键节点调用 MCP 工具
export const configSnippet = '../../config/mcp.workbuddy.json';
export const platformIds = ['workbuddy'];

export function matches(evt) { return platformIds.includes(evt.platform); }

export function detect() {
  return {
    sources: ['~/.workbuddy/', '~/.workbuddy/mcp.json', '/Applications/WorkBuddy.app'],
    evidence: 'app + bundle + config + mcp',
  };
}
export function capabilities() {
  return {
    level: capability, realtime: true, auto, transport,
    caveat: '无公开全量会话 API；仅覆盖 Skill 参与的会话，事件由 Skill 调用 MCP 工具主动上报',
    session_text: false,
  };
}
/** 订阅真实事件流（SSE）。Node 侧 BroadcastChannel 跨进程无效，已改用回环网关。 */
export function subscribe(emit, opts = {}) {
  return subscribeRelay({ filter: matches, onEvent: emit, onStatus: opts.onStatus });
}
/** 只返回安装计划，绝不自动写入用户目录 */
export function install() {
  return {
    requires_confirmation: true,
    steps: [
      { action: 'copy', from: './ (skill root)', to: '~/.workbuddy/skills/yaoflux/' },
      { action: 'merge', file: '~/.workbuddy/mcp.json', key: 'mcpServers.yaoflux' },
      { action: 'manual', note: '在「连接器 → 自定义连接」中信任 yaoflux，然后重启会话' },
    ],
  };
}
