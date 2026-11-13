#!/usr/bin/env node
/**
 * YAO FLUX · Agent Registry
 * 只读探测本机已安装的 Agent，按证据分级，生成 agents.json 注册表。
 *
 * 安全边界（不可放宽）：
 *  - 只做存在性判断与「应用 bundle id」这一个元数据字段的读取。
 *  - 不读取任何会话内容、不递归进入 projects / sessions / history / conversations。
 *  - 不移动、改名、删除、写入任何被探测的文件；唯一写入是本脚本自己的 agents.json。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || '';
const OUT = process.argv[2] || path.resolve(SCRIPT_DIR, '../agents.json');
const APP_DIRS = ['/Applications', path.join(HOME, 'Applications')];

/** 明确跳过：任何可能存放会话正文的位置，一律不进入 */
const SKIP_PATTERNS = [
  'projects', 'sessions', 'session', 'history', 'conversations',
  'chats', 'logs', 'shell-snapshots', 'todos', 'cache', 'Cache',
];

/** 已知 Agent 特征库：名称、配置目录、CLI、bundle id 片段 */
const CATALOG = [
  {
    id: 'workbuddy', name: 'WorkBuddy', kind: 'runtime', adapter: 'workbuddy',
    apps: ['WorkBuddy.app'], configs: ['.workbuddy'], clis: [], bundle: /workbuddy/i,
    capability: 'L1', note: 'MCP(STDIO/SSE) + Skill 注入可实时推送；无公开全量会话 API',
  },
  {
    id: 'deepseek-harness', name: 'DeepSeek Harness', kind: 'runtime', adapter: 'harness',
    apps: ['DeepSeek Harness.app'], configs: ['.deepseek', '.config/deepseek-harness'], clis: ['dsh'],
    bundle: /deepseek|harness/i, capability: 'L1',
    note: 'append-only 事件链是天然实时源；当前 v0.1 有破坏性变更风险',
  },
  {
    id: 'claude-code', name: 'Claude Code', kind: 'cli', adapter: 'generic',
    apps: ['CC Switch.app'], configs: ['.claude', '.claude.json'], clis: ['claude'], bundle: /claude/i,
    capability: 'L2', note: '本地 session JSONL 可 tail，1–2s 准实时',
  },
  {
    id: 'codex-cli', name: 'Codex CLI', kind: 'cli', adapter: 'generic',
    apps: [], configs: ['.codex'], clis: ['codex'], bundle: /codex/i,
    capability: 'L2', note: '本地 session 日志可 tail',
  },
  {
    id: 'cursor', name: 'Cursor', kind: 'ide', adapter: 'generic',
    apps: ['Cursor.app'], configs: ['.cursor'], clis: ['cursor'], bundle: /cursor/i,
    capability: 'L2', note: '本地会话/扩展状态可读',
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', kind: 'cli', adapter: 'generic',
    apps: [], configs: ['.gemini'], clis: ['gemini'], bundle: /gemini/i,
    capability: 'L2', note: '本地会话日志可 tail',
  },
  {
    id: 'aider', name: 'Aider', kind: 'cli', adapter: 'generic',
    apps: [], configs: ['.aider'], clis: ['aider'], bundle: /aider/i,
    capability: 'L2', note: '本地会话日志可 tail',
  },
  {
    id: 'opencode', name: 'OpenCode', kind: 'cli', adapter: 'generic',
    apps: [], configs: ['.opencode', '.config/opencode'], clis: ['opencode'], bundle: /opencode/i,
    capability: 'L2', note: '本地会话日志可 tail',
  },
  {
    id: 'chatgpt-desktop', name: 'ChatGPT', kind: 'desktop', adapter: null,
    apps: ['ChatGPT.app'], configs: [], clis: [], bundle: /chatgpt|openai/i,
    capability: 'L3', note: '封闭桌面 GUI + 云同步，无本地可读事件源，仅发现',
  },
  {
    id: 'grok-desktop', name: 'Grok Bot', kind: 'desktop', adapter: null,
    apps: ['Grok Bot.app'], configs: [], clis: [], bundle: /grok|xai/i,
    capability: 'L3', note: '封闭桌面 GUI，仅发现',
  },
  {
    id: 'zcode', name: 'ZCode', kind: 'ide', adapter: null,
    apps: ['ZCode.app'], configs: [], clis: [], bundle: /zcode/i,
    capability: 'unknown', note: '名称可疑，需 bundle id / 配置特征二次判定',
  },
  {
    id: 'cc-switch', name: 'CC Switch', kind: 'tool', adapter: null,
    apps: ['CC Switch.app'], configs: [], clis: [], bundle: /cc.?switch/i,
    capability: 'unknown', note: 'Claude Code 供应商切换器，本身不是 agent，作为生态证据',
  },
];

/** 名称可疑、需要读 bundle id 二次判定的应用（不靠名字下结论） */
const REVIEW_APPS = [
  'MobileClaw.app', 'Marvis.app', 'SakuraCat.app', 'START.app',
  'ZCode.app', 'CC Switch.app', 'ChatGPT.app', 'Grok Bot.app',
];
const AGENTISH_BUNDLE = /(claude|copilot|gpt|agent|llm|codex|cursor|harness|assistant|\bai\b|bot|claw)/i;

function listApps() {
  const out = [];
  for (const dir of APP_DIRS) {
    try {
      for (const n of fs.readdirSync(dir)) if (n.endsWith('.app')) out.push({ dir, name: n });
    } catch { /* 目录不存在则跳过 */ }
  }
  return out;
}

function configExists(rel) {
  if (!rel || SKIP_PATTERNS.some(p => rel.toLowerCase().includes(p.toLowerCase()))) return false;
  return fs.existsSync(path.join(HOME, rel));
}

function findCli(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* 继续找 */ }
  }
  return null;
}

/** 只读取 Info.plist 中的 CFBundleIdentifier 字段，不读其它内容 */
function bundleId(appDir, appName) {
  const p = path.join(appDir, appName, 'Contents', 'Info.plist');
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const m = txt.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/i);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

function mcpManifests() {
  const found = [];
  for (const rel of ['.workbuddy/mcp.json', '.claude.json', '.cursor/mcp.json',
                     '.codex/config.toml', '.gemini/settings.json']) {
    if (configExists(rel)) found.push('~/' + rel);
  }
  return found;
}

function scan() {
  const apps = listApps();
  const appNames = new Set(apps.map(a => a.name));
  const byName = new Map(apps.map(a => [a.name, a]));
  const mcps = mcpManifests();
  const agents = [];

  for (const c of CATALOG) {
    const ev = [];
    for (const name of c.apps) {
      if (appNames.has(name)) {
        ev.push({ type: 'app', value: name });
        const bid = bundleId(byName.get(name).dir, name);
        if (bid) ev.push({ type: 'bundle', value: bid });
      }
    }
    for (const rel of c.configs) if (configExists(rel)) ev.push({ type: 'config', value: '~/' + rel });
    for (const cli of c.clis) {
      const p = findCli(cli);
      if (p) ev.push({ type: 'cli', value: p });
    }
    if (!ev.length) continue;

    if (mcps.length && (c.id === 'workbuddy' || c.id === 'cursor' || c.id === 'claude-code')) {
      ev.push({ type: 'mcp', value: mcps.join(', ') });
    }

    const types = new Set(ev.map(e => e.type));
    const confidence = types.size >= 2 ? 'confirmed' : 'probable';
    const enabled = c.capability === 'L1' || c.capability === 'L2';
    agents.push({
      id: c.id, name: c.name, kind: c.kind, adapter: c.adapter,
      evidence: ev, evidence_types: [...types], confidence,
      capability: c.capability, enabled, note: c.note,
    });
  }

  // 名称可疑但不在特征库里的应用：用 bundle id 二次判定，绝不靠名字猜
  const catalogApps = new Set(CATALOG.flatMap(c => c.apps));
  const unclassified = [];
  for (const name of REVIEW_APPS) {
    if (catalogApps.has(name) || !byName.has(name)) continue;
    const bid = bundleId(byName.get(name).dir, name);
    unclassified.push({
      name: name.replace(/\.app$/, ''),
      bundle_id: bid,
      verdict: bid && AGENTISH_BUNDLE.test(bid) ? 'probable-agent' : 'unknown',
      action: 'needs-review',
      note: '仅凭应用名无法判定，需人工确认或补充特征规则',
    });
  }

  const byCapability = {};
  for (const a of agents) byCapability[a.capability] = (byCapability[a.capability] || 0) + 1;

  return {
    schema: 'yaoflux.agents/v1',
    generated_at: new Date().toISOString(),
    platform: process.platform,
    scan_policy: {
      read_only: true,
      reads: ['app directory names', 'CFBundleIdentifier from Info.plist', 'config path existence', 'CLI executability'],
      excluded: SKIP_PATTERNS,
      note: '不读取任何会话正文；不递归进入会话/历史/日志目录',
    },
    summary: {
      total: agents.length,
      confirmed: agents.filter(a => a.confidence === 'confirmed').length,
      probable: agents.filter(a => a.confidence === 'probable').length,
      enabled: agents.filter(a => a.enabled).length,
      by_capability: byCapability,
      needs_review: unclassified.length,
    },
    agents,
    unclassified,
  };
}

const data = scan();
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log(`Agent Registry → ${OUT}`);
console.log(`识别 ${data.summary.total} 个 · 确认 ${data.summary.confirmed} · 待判定 ${data.summary.needs_review}`);
console.log('');
console.log('名称'.padEnd(22) + '能力  置信度    证据');
console.log('─'.repeat(72));
for (const a of data.agents) {
  console.log(a.name.padEnd(22) + a.capability.padEnd(10) + a.confidence.padEnd(11) + a.evidence_types.join('+'));
}
for (const u of data.unclassified) console.log(u.name.padEnd(22) + '?     needs-review  bundle=' + (u.bundle_id || 'n/a'));
