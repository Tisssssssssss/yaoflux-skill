/**
 * 通用适配器：给未定级 / 新装 Agent 的兜底。
 * 只做「事件主动上报」：任意脚本用 `yaoflux emit` 或 POST /emit 接入，
 * 不 tail 本地会话日志、不读取任何会话正文。
 */
import { subscribeRelay } from '../relay_client.mjs';

export const id = 'generic';
export const label = 'Generic / CLI';
export const capability = 'L2';
export const transport = 'CLI emit / POST /emit';
export const auto = false;
export const platformIds = [];

export function matches() { return true; }   // 兜底：处理注册表里没有对应适配器的来源

export function detect() {
  return { sources: ['config dir / CLI / app bundle'], evidence: 'catalog match' };
}
export function capabilities() {
  return {
    level: capability, realtime: false, auto, transport,
    caveat: '手动 / 脚本主动上报；封闭 GUI 与云同步客户端（L3）没有本地事件源，显示 no stream，不伪造数据',
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
      { action: 'report-only', note: '仅输出识别结果与 CLI 投递命令，不自动写入任何目录' },
    ],
  };
}
