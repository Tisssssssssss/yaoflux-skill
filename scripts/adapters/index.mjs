/**
 * 注册表驱动的适配器加载器。
 * 平台差异全部收敛在这里与 adapters/ 目录，SKILL.md 与看板不感知具体平台。
 *
 * 重要：跨进程事件一律走 HTTP 回环网关（POST /emit + SSE /events），
 * 不再使用 Node 的 BroadcastChannel —— 它只在同进程 worker 之间通信。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { subscribeRelay } from '../relay_client.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * 读取 agents.json，按每条 adapter 字段动态 import 对应模块。
 * 未知 adapter 自动回落到 generic，保证新增 Agent 不会让整条链路崩掉。
 */
export async function loadAdapters(registryPath) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const cache = new Map();
  const mounted = [];

  for (const agent of registry.agents || []) {
    const key = agent.adapter || 'generic';
    if (!cache.has(key)) {
      const file = path.join(DIR, `${key}.mjs`);
      const target = fs.existsSync(file) ? file : path.join(DIR, 'generic.mjs');
      cache.set(key, await import(pathToFileURL(target).href));
    }
    mounted.push({ agent, adapter: cache.get(key), enabled: !!agent.enabled });
  }
  return { registry, mounted };
}

/** 汇总当前可接入的事件源，供 MCP Server / 页面 / doctor 使用 */
export function summarize(mounted) {
  return mounted
    .filter(m => m.enabled)
    .map(m => ({
      id: m.agent.id,
      name: m.agent.name,
      capability: m.agent.capability,
      transport: m.adapter.transport || 'unknown',
      auto: !!m.adapter.auto,
      ...m.adapter.capabilities(),
    }));
}

/** 订阅全部已启用 Agent 的事件，返回取消订阅函数 */
export function subscribeAll(mounted, onEvent, opts = {}) {
  const active = mounted.filter(m => m.enabled);
  return subscribeRelay({
    onEvent: evt => {
      const owner = active.find(m => m.adapter.matches?.(evt));
      onEvent(evt, owner || null);
    },
    onStatus: opts.onStatus,
    since: opts.since,
  });
}
