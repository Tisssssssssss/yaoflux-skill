/** DeepSeek Harness 适配器：插件 skills/ + MCP stdio（v0.1 Developer Preview） */
import { subscribeRelay } from '../relay_client.mjs';

export const id = 'deepseek-harness';
export const label = 'DeepSeek Harness';
export const capability = 'L1';
export const transport = '插件 skills/ + MCP stdio';
export const auto = false;
export const configSnippet = '../../config/dsh-plugin.json';
export const platformIds = ['deepseek-harness', 'dsh'];

export function matches(evt) { return platformIds.includes(evt.platform); }

export function detect() {
  return {
    sources: ['/Applications/DeepSeek Harness.app', '~/.deepseek', 'dsh (PATH)'],
    evidence: 'app + bundle',
  };
}
export function capabilities() {
  return {
    level: capability, realtime: true, auto, transport,
    caveat: 'v0.1 Developer Preview，插件目录与 MCP 清单格式可能变更，安装器只输出手动步骤不自动写入',
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
      { action: 'copy', from: './ (plugin root)', to: '<harness>/plugins/yaoflux/' },
      { action: 'merge', note: '注册 MCP stdio server，命令与 WorkBuddy 同一份 mcp_server.mjs' },
      { action: 'verify', note: '调用 yaoflux_status 验证网关，再用同一触发词验证与 WorkBuddy 行为一致' },
    ],
  };
}
