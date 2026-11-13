#!/usr/bin/env node
/**
 * YAO FLUX · 幂等安装器
 *
 * 设计红线：
 *   - 默认 **dry-run**，只输出完整计划，绝不写任何文件；
 *     只有调用方显式传 apply:true（CLI 的 --apply）才真正执行。
 *   - 所有将被修改的用户配置文件都会先备份到 ~/.yaoflux/backups/<时间戳>/。
 *   - 合并而非覆盖：mcp.json / settings.json 只增删自己的键，保留其它配置。
 *   - 卸载不做递归删除，把安装进去的 Skill 目录「移动」到备份区，可随时还原。
 *   - 不读、不写任何会话 / 历史 / 日志目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MANAGED = 'yaoflux (managed)';
const TOM_BEGIN = '# >>> ' + MANAGED;
const TOM_END = '# <<< ' + MANAGED;

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readJSON(p, fallback) {
  if (!exists(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }               // null = 文件存在但不可解析，必须跳过而不是覆盖
}
function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function q(p) { return JSON.stringify(p); }

/** 各平台的安装目标定义；detect 为只读存在性检查 */
function targets(home) {
  return {
    workbuddy: {
      label: 'WorkBuddy',
      detect: () => exists(path.join(home, '.workbuddy')),
      skillDir: path.join(home, '.workbuddy', 'skills', 'yaoflux'),
      configFile: path.join(home, '.workbuddy', 'mcp.json'),
      transport: 'MCP stdio',
      postInstall: '在 WorkBuddy「连接器 → 自定义连接」中信任 yaoflux，然后重启会话；之后可让 Skill 调用 yaoflux_emit 上报事件。',
    },
    codex: {
      label: 'Codex CLI',
      detect: () => exists(path.join(home, '.codex', 'config.toml')),
      configFile: path.join(home, '.codex', 'config.toml'),
      transport: 'MCP stdio',
      postInstall: '重启 Codex，执行 codex mcp list 确认 yaoflux 已加载。',
    },
    claude: {
      label: 'Claude Code',
      detect: () => exists(path.join(home, '.claude', 'settings.json')),
      configFile: path.join(home, '.claude', 'settings.json'),
      transport: 'Hooks（自动上报，无需模型配合）',
      postInstall: '重启 Claude Code 后，工具调用 / 响应结束会自动产生事件。',
    },
    dsh: {
      label: 'DeepSeek Harness',
      manual: true,
      detect: () => exists('/Applications/DeepSeek Harness.app'),
      transport: '插件 skills/ 目录 + MCP（路径随版本变化，不自动写入）',
      postInstall: '把本包整体复制到 Harness 的 plugins/ 目录，并在其 MCP 配置里注册 mcp_server.mjs（与 WorkBuddy 同一份命令）。',
    },
  };
}

function buildPlan(ctx) {
  const { home, root, scripts, nodeBin, uninstall } = ctx;
  const steps = [];
  const add = (kind, target, detail, run) => steps.push({ kind, target, detail, run });
  const cfg = path.join(home, '.yaoflux', 'config.json');

  if (!uninstall) {
    add('mkdir', path.join(home, '.yaoflux'), '运行状态目录', () => fs.mkdirSync(path.join(home, '.yaoflux'), { recursive: true }));

    for (const t of ctx.active) {
      if (t.key === 'dsh') {
        add('manual', '(无自动写入)', 'DeepSeek Harness：' + t.def.postInstall);
        continue;
      }
      if (t.key === 'workbuddy') {
        add('copy', t.def.skillDir, '复制完整 Skill 包（根 SKILL.md / bin / assets / config / agents.json / scripts/）', () => {
          fs.mkdirSync(path.dirname(t.def.skillDir), { recursive: true });
          // 复制整个包（扁平单 Skill 结构）：这样安装后根 SKILL.md 生效，
          // 且文档里以包根为基准的所有相对路径（bin/、config/、assets/）依然有效。
          fs.cpSync(root, t.def.skillDir, {
            recursive: true,
            filter: src => !/(^|\/)(\.DS_Store|node_modules|backups)(\/|$)/.test(src),
          });
        });
        add('merge-json', t.def.configFile, '合并 mcpServers.yaoflux（保留其它 MCP 服务）', () => {
          const j = readJSON(t.def.configFile, { mcpServers: {} });
          if (j === null) throw new Error('mcp.json 不是合法 JSON，已跳过，避免覆盖原有配置');
          j.mcpServers = j.mcpServers || {};
          j.mcpServers.yaoflux = {
            command: nodeBin,
            args: [path.join(t.def.skillDir, 'scripts', 'mcp_server.mjs')],
            env: { YAOFLUX_PORT: String(ctx.port) },
          };
          writeJSON(t.def.configFile, j);
        });
      }
      if (t.key === 'codex') {
        add('merge-toml', t.def.configFile, '追加 [mcp_servers.yaoflux] 托管块（幂等）', () => {
          let src = exists(t.def.configFile) ? fs.readFileSync(t.def.configFile, 'utf8') : '';
          if (src.includes(TOM_BEGIN)) return;                 // 已装过，跳过
          const block = [
            '', TOM_BEGIN,
            '[mcp_servers.yaoflux]',
            'command = ' + q(nodeBin),
            'args = [' + q(path.join(scripts, 'mcp_server.mjs')) + ']',
            'startup_timeout_sec = 30',
            TOM_END, '',
          ].join('\n');
          fs.writeFileSync(t.def.configFile, src.replace(/\s*$/, '') + '\n' + block, 'utf8');
        });
      }
      if (t.key === 'claude') {
        add('merge-json', t.def.configFile, '追加 PostToolUse / Stop hooks（保留已有 hooks）', () => {
          const j = readJSON(t.def.configFile, {});
          if (j === null) throw new Error('settings.json 不是合法 JSON，已跳过');
          j.hooks = j.hooks || {};
          const entry = { type: 'command', command: q(nodeBin) + ' ' + q(path.join(scripts, 'hook.mjs')) };
          const ours = e => Array.isArray(e?.hooks) && e.hooks.some(h => h.command?.includes('hook.mjs'));
          for (const ev of ['PostToolUse', 'Stop']) {
            j.hooks[ev] = (Array.isArray(j.hooks[ev]) ? j.hooks[ev] : []).filter(e => !ours(e));
            j.hooks[ev].push({ hooks: [entry], description: MANAGED });
          }
          writeJSON(t.def.configFile, j);
        });
      }
    }
    add('write-json', cfg, '写入安装状态（端口 / 已装目标 / 时间）', () => writeJSON(cfg, {
      version: '0.2.0', port: ctx.port, installed_at: new Date().toISOString(),
      targets: ctx.active.map(t => t.key),
      install_source: root,
      skill_dir: path.join(home, '.workbuddy', 'skills', 'yaoflux'),
      mcp_entry: path.join(scripts, 'mcp_server.mjs'),
      dashboard: 'http://127.0.0.1:' + ctx.port + '/',
    }));
  } else {
    for (const t of ctx.active) {
      if (t.key === 'dsh') { add('manual', '(无自动写入)', 'DeepSeek Harness 需手动移除插件目录'); continue; }
      if (t.key === 'workbuddy') {
        add('remove', t.def.skillDir, '把 Skill 目录移动到备份区（不删除）', () => moveToBackup(t.def.skillDir, ctx));
        add('merge-json', t.def.configFile, '移除 mcpServers.yaoflux', () => {
          const j = readJSON(t.def.configFile, {});
          if (j && j.mcpServers) { delete j.mcpServers.yaoflux; writeJSON(t.def.configFile, j); }
        });
      }
      if (t.key === 'codex') {
        add('merge-toml', t.def.configFile, '移除托管 TOML 块', () => {
          if (!exists(t.def.configFile)) return;
          const src = fs.readFileSync(t.def.configFile, 'utf8');
          const re = new RegExp('\\n?' + TOM_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + TOM_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n?', 'g');
          fs.writeFileSync(t.def.configFile, src.replace(re, '\n'), 'utf8');
        });
      }
      if (t.key === 'claude') {
        add('merge-json', t.def.configFile, '移除 yaoflux hooks', () => {
          const j = readJSON(t.def.configFile, {});
          if (!j || !j.hooks) return;
          for (const ev of ['PostToolUse', 'Stop']) {
            if (Array.isArray(j.hooks[ev])) j.hooks[ev] = j.hooks[ev].filter(e => e.description !== MANAGED);
          }
          writeJSON(t.def.configFile, j);
        });
      }
    }
    add('write-json', cfg, '清除安装状态', () => { if (exists(cfg)) fs.writeFileSync(cfg, JSON.stringify({ version: '0.2.0', uninstalled_at: new Date().toISOString() }, null, 2) + '\n'); });
  }
  return steps;
}

function moveToBackup(src, ctx) {
  if (!exists(src)) return;
  const dst = path.join(ctx.backupDir, path.basename(src) + '-removed');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(src, dst); }
  catch { /* 跨设备失败时保留原目录，不强行删除 */ }
}

function backupModified(steps, ctx) {
  const files = new Set();
  for (const s of steps) {
    if (['merge-json', 'merge-toml', 'write-json'].includes(s.kind) && exists(s.target)) files.add(s.target);
  }
  if (!files.size) return [];
  fs.mkdirSync(ctx.backupDir, { recursive: true });
  const made = [];
  for (const f of files) {
    const rel = f.replace(ctx.home, '').replace(/^\//, '').replace(/\//g, '__');
    const dst = path.join(ctx.backupDir, rel);
    fs.copyFileSync(f, dst);
    made.push(dst);
  }
  return made;
}

/**
 * @param {{root:string, apply?:boolean, uninstall?:boolean, targets?:string|boolean}} opts
 */
export async function runInstall(opts = {}) {
  const home = os.homedir();
  const root = opts.root;
  const scripts = path.join(root, 'scripts');
  const port = Number(process.env.YAOFLUX_PORT || 8787);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ctx = {
    home, root, scripts, port,
    nodeBin: process.execPath,
    backupDir: path.join(home, '.yaoflux', 'backups', stamp + (opts.uninstall ? '-uninstall' : '-install')),
    active: [],
  };

  const defs = targets(home);
  const filter = typeof opts.targets === 'string'
    ? opts.targets.split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const skipped = [];
  for (const [key, def] of Object.entries(defs)) {
    if (filter && !filter.includes(key)) continue;
    if (!def.detect()) { skipped.push(def.label); continue; }
    ctx.active.push({ key, def });
  }

  const steps = buildPlan(ctx);
  const verb = opts.uninstall ? '卸载' : '安装';
  console.log('\n=== YAO FLUX ' + verb + '计划 ' + (opts.apply ? '[APPLY]' : '[DRY-RUN · 不写入任何文件]') + ' ===');
  console.log('包目录   ' + root);
  console.log('Node     ' + ctx.nodeBin);
  console.log('网关端口 ' + port + ' (127.0.0.1)');
  console.log('已检测   ' + (ctx.active.map(t => t.def.label + ' [' + t.def.transport + ']').join('、') || '无'));
  if (skipped.length) console.log('未安装   ' + skipped.join('、') + '（跳过，不创建配置）');
  console.log('\n将执行 ' + steps.length + ' 步：');
  steps.forEach((s, i) => console.log('  ' + String(i + 1).padStart(2) + '. [' + s.kind + '] ' + s.target + '\n      ' + s.detail));

  if (!opts.apply) {
    console.log('\n以上仅为计划，未创建 / 修改 / 删除任何文件。');
    console.log('确认无误后执行： node bin/yaoflux.mjs ' + (opts.uninstall ? 'uninstall' : 'install') + ' --apply');
    return { applied: false, steps: steps.length };
  }

  const backups = backupModified(steps, ctx);
  if (backups.length) {
    console.log('\n已备份 ' + backups.length + ' 个原文件到 ' + ctx.backupDir);
    backups.forEach(b => console.log('  ' + b));
  }

  let ok = 0, failed = 0;
  for (const s of steps) {
    if (!s.run) { ok++; continue; }              // manual 步骤只提示
    try { s.run(); ok++; }
    catch (err) { failed++; console.error('  FAILED [' + s.kind + '] ' + s.target + ' → ' + err.message); }
  }
  console.log('\n' + verb + '完成：成功 ' + ok + '，失败 ' + failed + (backups.length ? '，备份见 ' + ctx.backupDir : ''));
  if (!opts.uninstall) {
    console.log('\n下一步：');
    for (const t of ctx.active) console.log('  · ' + t.def.label + '：' + t.def.postInstall);
    console.log('  · 启动网关并打开看板： node bin/yaoflux.mjs start --open');
    console.log('  · 自检：               node bin/yaoflux.mjs doctor');
    console.log('  · 直接打开看板：       http://127.0.0.1:' + port + '/');
  }
  if (failed) process.exitCode = 1;
  return { applied: true, steps: steps.length, ok, failed, backups };
}
