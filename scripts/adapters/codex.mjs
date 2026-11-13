/** Codex CLI 适配器：~/.codex/config.toml 的 [mcp_servers.yaoflux] */
import { subscribeRelay } from '../relay_client.mjs';

export const id = 'codex-cli';
export const label = 'Codex CLI';
export const capability = 'L1';
export const transport = 'MCP stdio (config.toml)';
export const auto = false;
export const configSnippet = '../../config/mcp.codex.toml';
export const platformIds = ['codex-cli', 'codex'];

export function matches(evt) { return platformIds.includes(evt.platform); }

export function detect() {
  return { sources: ['~/.codex/config.toml', 'codex (PATH)'], evidence: 'config + cli' };
}
export function capabilities() {
  return {
    level: capability, realtime: true, auto, transport,
    caveat: 'Codex 只支持 stdio MCP；事件由模型调用 yaoflux_emit 上报，不读取本地 session 日志',
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
      { action: 'append-toml', file: '~/.codex/config.toml', key: '[mcp_servers.yaoflux]' },
      { action: 'verify', note: '重启 Codex，codex mcp list 确认已加载' },
    ],
  };
}
