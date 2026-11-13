---
name: yaoflux
description: "YAO FLUX 实时会话观象台。自动识别本机安装的所有 Agent 并生成带证据与能力分级的注册表；安装后通过 MCP / Hooks / CLI 把各 Agent 的结构化事件实时推给看板。当用户要求「识别/盘点本机 agent」「安装或启用 yaoflux」「启动 YAO FLUX 看板」「把 agent 事件上报到看板」「刷新 agent 列表」时使用。"
license: PolyForm-Noncommercial-1.0.0
metadata:
  version: 0.3.0
  author: 严过关
  scope: 个人 / 非商业演示
  compatibility: WorkBuddy 5.3+ / DeepSeek Harness v0.1+ / Codex CLI / Claude Code / 任何兼容 Agent Skills 与 MCP stdio 的客户端；需 Node.js 18+；macOS 或 Linux
---

# YAO FLUX · 本机 Agent 识别与实时观象台

## 用途

在运行时自动发现本机的 Agent 客户端（WorkBuddy、DeepSeek Harness、Claude Code、Codex CLI、桌面模型端等），按证据生成可复用的注册表，并让 YAO FLUX 页面基于这张注册表做展示与后续适配。不给平台写死清单，不靠应用名猜测。

## 包结构（标准单 Skill 布局）

本包**就是一个标准 Agent Skill**：解压 / 打开后根目录直接是 `SKILL.md`，其中含 YAML frontmatter 的 `name` 与 `description`。`.zip` 内没有额外的包装目录，可以直接上传或整个目录放进客户端的 skills 目录。

| 路径 | 说明 |
|---|---|
| `SKILL.md` | Skill 定义（YAML frontmatter + 完整指令），**唯一入口** |
| `scripts/` | MCP Server、事件网关、Hook、安装器、适配器、只读注册表探测 |
| `references/` | 证据分级、能力档与页面改造记录 |
| `assets/yaoflux.html` | 单文件看板 |
| `bin/yaoflux.mjs` | CLI 总入口 |
| `config/` | 各平台可合并的配置片段 |
| `agents.json` / `plugin.json` | 本机 Agent 注册表 / 插件兼容清单 |

包内所有相对路径都以**包根目录**为基准，不要拆散目录。`doctor` 会校验根 `SKILL.md` 的 frontmatter 合规。`install --apply` 会把整个包复制到 `~/.workbuddy/skills/yaoflux/`，那里同样以 `SKILL.md` 为入口；安装源与安装目录记录在 `~/.yaoflux/config.json` 的 `install_source` / `skill_dir`。

## 快速开始：安装后直接对接各 Agent 实时数据

> 所有命令在**包根目录**执行（含 `SKILL.md` / `plugin.json` / `bin/` / `assets/` 的那一层）。`install --apply` 会把完整包复制到 `~/.workbuddy/skills/yaoflux/`，那里同样是一个完整包根；安装源与安装目录记录在 `~/.yaoflux/config.json` 的 `install_source` / `skill_dir`。

### 三条命令完成安装

| 步骤 | 命令 | 作用 |
|---|---|---|
| 1 自检 | `node bin/yaoflux.mjs doctor` | 检查环境、资产与 MCP 协议握手 |
| 2 看计划 | `node bin/yaoflux.mjs install` | **默认 dry-run**：只输出将要写入的路径清单，不创建 / 修改 / 删除任何文件 |
| 3 确认后安装 | `node bin/yaoflux.mjs install --apply` | 复制 Skill、合并各 Agent 的 MCP / Hooks 配置；写入前自动备份 |
| 4 启动 | `node bin/yaoflux.mjs start --open` | 前台启动回环网关并打开看板 `http://127.0.0.1:8787/` |

**硬约束**：必须先跑 dry-run、把路径清单交给用户确认，再执行 `--apply`。卸载同理（`uninstall` → `uninstall --apply`），卸载不递归删除，只把安装进去的目录移到备份区。可加 `--targets workbuddy,codex` 缩小范围。

### 安装器会写哪里

| 目标 | 路径 | 动作 |
|---|---|---|
| WorkBuddy | `~/.workbuddy/skills/yaoflux/` | 复制 Skill 目录 |
| WorkBuddy | `~/.workbuddy/mcp.json` | 合并 `mcpServers.yaoflux`，保留其它 MCP 服务 |
| Codex CLI | `~/.codex/config.toml` | 追加 `[mcp_servers.yaoflux]` 托管块（带 marker，幂等） |
| Claude Code | `~/.claude/settings.json` | 追加 `PostToolUse` / `Stop` hooks，保留已有 hooks |
| 运行状态 | `~/.yaoflux/config.json` | 端口、已装目标、安装时间 |
| 备份 | `~/.yaoflux/backups/<时间戳>/` | 写入前备份所有被修改的原文件 |

未安装的客户端自动跳过。DeepSeek Harness v0.1 的插件路径随版本变化，安装器**只输出手动步骤、不写入**，见 `config/dsh-plugin.json`。

### 各 Agent 如何接上实时数据

| Agent | 通道 | 自动化程度 | 启用动作 |
|---|---|---|---|
| WorkBuddy | MCP stdio `yaoflux_emit` | 会话内主动上报 | 在「连接器 → 自定义连接」信任 `yaoflux`，重启会话 |
| Codex CLI | MCP stdio（`config.toml`） | 会话内主动上报 | 重启 Codex，`codex mcp list` 确认 |
| Claude Code | Hooks → `hook.mjs` | **运行时全自动**，模型无需配合 | 重启后工具调用 / 响应结束自动产生事件 |
| DeepSeek Harness | 插件 `skills/` + MCP | 会话内主动上报 | 手动复制插件目录并注册同一份 MCP server |
| 任意脚本 / 其它 Agent | `yaoflux emit` 或 `POST /emit` | 手动 / 脚本 | 一行命令或 HTTP 投递 |
| 封闭桌面 GUI（ChatGPT / Grok 等 L3） | 无 | 不支持 | 页面显示 `no stream`，**不伪造数据** |

### Skill 被 Agent 加载后的行为约定

启用 YAO FLUX 后，在会话关键节点调用 MCP 工具 `yaoflux_emit` 上报结构化事件：

- `agent_id` 必须是 `agents.json` 里的 id（`workbuddy` / `codex-cli` / `deepseek-harness` / `claude-code` …），页面据此分源；不确定时先调 `yaoflux_agents`。
- 建议节点：`plan`（接到任务）→ `tool_call` / `tool_result`（工具调用前后）→ `file` / `search` → `done` 或 `error`（收尾）。
- 同一 `session_id` 的事件会在 `INVESTIGATION FEED` 聚成一个话轮，并自动派生「执行推理链」；`done` / `error` 封口。
- **只传脱敏摘要与元数据**（`text` / `tool` / `file` / `task` / `tokens` / `duration_ms`），不传会话正文、密钥、个人信息；没有真实 token / 耗时数据就不要编。
- 辅助工具：`yaoflux_status` 查网关、`yaoflux_open` 拿看板地址、`yaoflux_emit_batch` 一次补齐一段链。

### 数据流

```
Agent ─┬─ MCP 工具 yaoflux_emit ─┐
       ├─ Hooks  → hook.mjs ─────┼─→ POST /emit ─→ 127.0.0.1:8787 事件网关 ─→ SSE /events ─→ 看板 FEED / STREAM
       └─ CLI    → yaoflux emit ─┘                        └─ 同时托管 GET /dashboard
```

Node 的 `BroadcastChannel` 只在同进程 worker 之间通信，**不能**用于跨 Agent 进程；所有跨进程事件一律走回环网关。MCP Server 启动时会复用已有网关，若没有则由自身内联拉起，因此多个 Agent 同时在线不会端口冲突。

### 命令速查

| 命令 | 说明 |
|---|---|
| `start [--port N] [--open]` | 前台启动网关并托管看板 |
| `status` / `watch` | 查网关状态 / 终端监听 SSE 事件流 |
| `emit '<json>'` 或 `emit --agent workbuddy --kind tool_call --text "..."` | 手动投递一条事件 |
| `install [--apply]` / `uninstall [--apply]` | 安装 / 卸载，默认 dry-run |
| `doctor` | 环境自检 + MCP 协议握手验证 |
| `mcp` | 以 stdio 模式运行 MCP Server（供各 Agent 配置引用） |

## 何时使用

- 用户询问「电脑上有哪些 agent」「识别所有 agent」「盘点一下」。
- 用户要求刷新 agent 列表、启动或重新生成 YAO FLUX 看板。
- 需要为新装的 Agent 增加适配能力时。

## 执行流程

### 1. 生成注册表

运行 `scripts/agent_registry.mjs`，输出 `agents.json`（默认写到插件根目录）：

```bash
node scripts/agent_registry.mjs
```

脚本只读探测四类证据：应用目录名与 `CFBundleIdentifier`、专属配置目录存在性、CLI 可执行性、MCP 清单存在性。**不读取任何会话正文，不递归进入 `projects` / `sessions` / `history` / `conversations` 等目录，不修改被探测文件。**

把 `summary`（总数 / 各能力档数量 / 待判定数）与 agent 清单以表格形式回报给用户。

### 2. 判定结果解释

按 `references/agent-detection.md` 解释置信度与能力档：

- `confidence: confirmed | probable` 由证据类型数量决定；名称可疑但证据不足的应用进 `unclassified`，标 `needs-review`，绝不当成已识别 agent。
- `capability: L1 | L2 | L3 | unknown` 表示「能否拿到会话事件」，与「是否识别到」是两件事。L3 只发现、不采集。

### 3. 加载适配器

用 `scripts/adapters/index.mjs` 按 `agents.json` 中每条的 `adapter` 字段动态挂载，不硬编码平台：

```js
import { loadAdapters } from './scripts/adapters/index.mjs';
const adapters = await loadAdapters('./agents.json');
```

每个适配器实现 `detect()` / `capabilities()` / `subscribe()` / `install()` 等方法，并额外导出 `transport` / `auto` / `configSnippet` / `platformIds` / `matches()`。`subscribe()` 已改为订阅回环网关的 SSE 流（见 `relay_client.mjs`），不再使用跨进程无效的 Node `BroadcastChannel`。适配器的 `install()` 只返回**安装计划**（元数据），真正执行写入的是独立的 `scripts/install.mjs`，且必须经 dry-run 确认 + `--apply`。

### 4. 展示与刷新

打开 `assets/yaoflux.html`（单文件，可直接双击）。页面内嵌了生成时的 `agents.json`，左下角 AGENT REGISTRY 面板按能力档显示每个 agent 与启用状态。

后续若注册表更新，不重新构建页面，调用：

```js
window.YaoFlux.setAgents(newRegistryJson);
```

或在页面已切到 LIVE 模式时，通过 `BroadcastChannel('haloflux-live')` 投递 `{ type: 'agents', data: ... }`。

### 5. 接入各 Agent 数据流

METHOD WORKSPACE 面板已改为 `AGENT DATA STREAM`，按来源显示实时事件。安装后的**主通道是回环事件网关**；页面内调用与 BroadcastChannel 仅用于浏览器内调试。

| 方式 | 用法 | 适用 |
|---|---|---|
| 回环网关（主通道） | MCP `yaoflux_emit` / Hooks `hook.mjs` / CLI `yaoflux emit` → `POST /emit` → SSE `/events` | 各 Agent 进程实时上报，跨进程可靠 |
| 页面内调用 | `window.YaoFlux.emitAgent('workbuddy', { kind: 'tool_call', text: '...', role: 'assistant' })` | 浏览器内调试 / 手动验证 |
| 浏览器事件通道 | `BroadcastChannel('haloflux-live')` 投递 `{ platform, agent_name, capability, kind, text, ... }` | 仅同一浏览器同源标签页之间；**不能跨 Agent 进程** |
| DEMO 模式 | 自动从注册表 `enabled` 的 agent 轮询生成模拟事件 | 演示多源效果 |

点击左下角 AGENT REGISTRY 某一行可只显示该 agent 的流（再点取消）；L3 / 未接入的 agent 显示 `no stream`，不伪造数据。也可用 `window.YaoFlux.filterAgent(id)` 直接切换。

事件统一经 `pushLive()` 分发，同时驱动 0/1 脉冲射线、卦位高亮、太极活跃度、KPI 与两个数据面板，做到「一处接入、全站响应」。

### 6. INVESTIGATION FEED 同源真实事件与 SSE 中继

`INVESTIGATION FEED` 与 `AGENT DATA STREAM` **共用同一份事件记录 `streamRows`**，不再各自造数据。所有事件在 `pushStream()` 里落成一条完整记录，两个面板同时按 `streamFilter` 过滤。

| 字段 | 含义 |
|---|---|
| `n` / `ts` | 序号、事件时间戳（FEED 显示 HH:MM:SS） |
| `agentId` / `name` / `cap` | 来源 agent、显示名、能力档（决定颜色） |
| `kind` / `role` | 真实事件类型与角色 |
| `sid` / `tokens` | 会话 ID、token 数（缺失时显示 no session / no token count） |
| `origin` | `LIVE` 外部真实事件 / `DEMO` 模拟事件 / `UI` 页面操作，FEED 用不同颜色徽标标出，**不把模拟数据伪装成真实数据** |
| `text` | 脱敏摘要，原文保留在行 title 与详情条 |

- 点击 FEED 任意行 → 底部详情条显示完整字段，再点收起；`window.YaoFlux.events()` 可导出整份事件记录。
- 无事件时两个面板都显示 `waiting for real agent events…`，**不再预填 8 行假 feed**；过滤到 L3 / 未接入 agent 时显示 `no real events from xxx`。
- 来源归属：`emitAgent()` / BroadcastChannel / SSE → `LIVE`；`demoBeat()` → `DEMO`；注册表面板点击与手动注入 → `UI`。

**真实接入（安装后默认可用）**：`scripts/event_relay.mjs` 是零依赖本地回环网关。MCP Server 在会话启动时会自动复用或内联拉起它，通常**不需要手动启动**；需要长期常驻时用 `start`。

```bash
node bin/yaoflux.mjs start --open      # 前台常驻并打开 http://127.0.0.1:8787/
node bin/yaoflux.mjs emit --agent workbuddy --kind tool_call --text "读取源码" --tool Read
curl -X POST http://127.0.0.1:8787/emit -H 'Content-Type: application/json' \
  -d '{"platform":"workbuddy","kind":"tool_call","text":"读取会话事件","session_id":"conv_01"}'
```

| 接口 | 作用 |
|---|---|
| `GET /` | 302 到 `/dashboard?relay=<origin>`，页面自动进入 LIVE 模式 |
| `GET /dashboard` | 网关直接托管单文件看板，无需单独开 HTML |
| `GET /history` | 首屏同步快照，页面打开即带上已有真实事件 |
| `GET /events?since=<seq>` | SSE 长连接，按 `seq` 去重，不重复计数 |
| `POST /emit` | 投递一条或 `{ events: [...] }` 批量（上限 50 条） |
| `GET /agents` | 返回本机 Agent 注册表 |
| `GET /health` | 连接数、接收数、重放条数、运行时长 |

带 `?relay=` 打开时页面自动切到 LIVE 并关闭 DEMO，避免真假混杂；不带参数时完全离线，不发起任何网络请求。网关只监听 `127.0.0.1`，历史仅存内存（默认 40 条），不读任何 Agent 会话文件、不上云、不落盘。

### 7. 圆盘构图档位

默认 `soft`：圆盘左侧外环出画，太极贴左边缘且完整，右侧留给射线与数据流，更接近原作「巨大仪器从左侧切入」的张力。用 URL 参数切换：

| 参数 | 圆心 / 半径 | 效果 | 代价 |
|---|---|---|---|
| `?crop=full` | `0.33W` / `min(0.43H, 0.25W)` | 圆盘完整居中（早期版本） | 偏图标化，张力弱 |
| `?crop=soft`（默认） | `0.13W` / `min(0.50H, 0.28W)` | 左侧外环出画，太极完整贴左 | 左侧卦位出画；AGENT REGISTRY 浮层移到右下 |
| `?crop=cut` | `0.10W` / `min(0.56H, 0.30W)` | 冲击更强，右侧射线更满 | 太极被切一角，八卦只剩右侧两卦 |
| `?crop=fade` | 同 full | 几何不动，画面左侧 40% 渐隐 | 偏柔，像「调暗」而非「不显示」 |

预设集中在 `CROP_PRESETS`，`resizeStage()` 按档位算 `cx / R`，`html[data-crop]` 驱动浮层位置与渐隐 CSS。参数可与 relay 并用，例如 `?crop=cut&relay=http://127.0.0.1:8787`。改构图时不要动 `BAGUA` 的先天方位数组，也不要改 `drawTaiji()` 的黑白比例。

### 8. 卦象决定的输出形态

转盘设一个固定读数位（正右方 angle 0）。`ringRot` 转动时 `activeTrigram()` 判定当前对准哪一卦，随即切换输出形式。一份 `TRIGRAM_FORMS` 同时驱动三处：外圈 0/1 脉冲密度、事件射线画法、右侧 `TRIGRAM OUTPUT` 浮层版式。

| 卦 | 形式 | 数据版式 | 射线形态 |
|---|---|---|---|
| 乾 ☰ | `OUTLINE` | 编号大纲 / 目标 | 三连长实线 |
| 巽 ☴ | `INGEST` | 路径与载入清单 | 细密斜纹 |
| 坎 ☵ | `DIAGNOSTIC` | 等级 + 异常 + 会话 | 断续闪烁 |
| 艮 ☶ | `CHECKLIST` | 勾选 / 阻断项 | 短粗硬停 |
| 坤 ☷ | `SUMMARY` | 计数条 + token + 来源分布 | 稀疏点阵 |
| 震 ☳ | `SIGNATURE` | `kind(text) → N tok` | 爆发长射线 |
| 离 ☲ | `CITATION` | 编号 / 时间 / 出处 / 引文 | 分叉双线 |
| 兑 ☱ | `DIALOGUE` | `role › text` 话轮 | 成对虚线 |

`TRIGRAM_MAP` 按卦德重新对齐：`plan→乾`、`message→兑`、`tool_call→震`、`tool_result / search→离`、`file→巽`、`error→坎`、`todo→艮`、`done→坤`。什么事件点亮哪一卦，与该卦输出形式的语义一致；`streamRows[].trigram` 保存命中的卦位。

查询接口：`window.YaoFlux.trigram()` 返回当前卦 / 形式 / 转角，`window.YaoFlux.forms()` 返回 8 项定义。要调整某种形式，只改 `TRIGRAM_FORMS` 对应项的 `render` 与 `ray`，不要动 `BAGUA` 的先天方位数组。

### 9. INVESTIGATION FEED 分源会话

FEED 与 STREAM 共用同一条真实事件总线，但做**不同聚合**：`streamRows` 供 STREAM 与 `TRIGRAM OUTPUT`（扁平事件流水），`agentThreads` 供 FEED（按 `agent + session_id` 聚成话轮）。`pushStream()` 末尾调 `ingestConversation()` 写入后者。

| 层级 | 投喂字段 | FEED 呈现 |
|---|---|---|
| L0 | 仅 `text` | 按 session 串话轮，行尾标「摘要」 |
| L1 | `content / turn / speaker` | 完整话轮 `#n speaker › 正文` |
| L2 | `thread / context` | 会话主题头 + 话轮 |

**不伪造**：无 `content` 时只用已有 `text`，绝不补写；每会话留最近 30 轮、每 agent 留最近 3 会话；L3 / 未接入 Agent 显示 `no conversation ... L3 仅发现 / 未接入`，已启用但暂无事件显示 `暂无会话事件`。

版式为 **A Tab 分源**：顶部 agent 芯片（能力档色点 + 未读数），下方当前 agent 的会话头与最近 5 条话轮，点话轮在底部详情条查看完整字段。点 AGENT REGISTRY 行时 `setStreamFilter()` 同步调 `setFeedAgent()`，两个面板一起聚焦。**卦象与 FEED 版式解绑**，只通过 `updateFeedTrigramMarks()` 刷新行尾卦标，避免换卦把对话重排成统计条。

接口：`window.YaoFlux.conversations()` 导出分源会话，`window.YaoFlux.feedAgent(id)` 直接切 tab。relay `normalize()` 白名单含 `content / turn / thread / speaker / context` 并逐项限长（`content` 240 字、`context` 最多 5 条）。完整方案与验收标准见工作区 `INVESTIGATION-FEED-分源会话方案.md`。

### 10. 当前状态：下方模块已回到默认格式版本

用户连续两次纠偏后，要求**先回到下方模块的默认格式版本**。第 20 组（跨整行 `AGENT WORKSPACE` 宽表）与第 21 组（8 格框架不变、只换 6 个模块数据源）**均已弃用并回退**；此后只追加了与下方模块无关的第 22 组（第 11 节，去除圆盘右侧横波）。当前有效补丁组 1–19 + 22。

| 位置 | 当前状态 |
|---|---|
| `INVESTIGATION FEED` | 保留第 19 组：按 agent + session 分源会话话轮（真实事件） |
| `AGENT DATA STREAM` | 保留第 15 组：按注册表 agent 分源的实时事件流 |
| 其余 6 个模块 | **完全恢复原页面默认格式**：`ADVECTION / PARTICLE SOLVER`、`SHARED SCENE / DIFFERENCE FIELD`、`SOURCE / EXTRACTION ROUTES`、`VALIDATION / SAMPLE BUFFER`、`12 AGENTS / DISPATCH`、`METHOD / REFERENCE INDEX` 的 HTML、CSS、标题、cap 文案、canvas / 表格 / 按钮，以及原版随机 / 数学演示渲染（`rState / AG / agentsTick / drawAdv / drawDiff / drawVal / drawIdx`）全部原样 |

也就是说：这 6 个模块现在是**原版演示数据**，不是实时数据。太极 / 先天八卦 / 0/1 脉冲 / 站名 `YAO FLUX` / `AGENT REGISTRY` / 统一事件总线 `pushLive()` / SSE relay 等其它已确认改造全部保留。

**未完成的需求**：把下方 6 个模块接入真实数据这一条尚未落地，两个已尝试方案均被否决。再次动手前必须先与用户确认具体形态（是原位替换数据源、还是别的形式），不要自行推断。

保留的基础设施：`event_relay.mjs` 的 `normalize()` 白名单仍含 `tool / tool_name / file / path / op / task / duration_ms`（可选透传、逐项限长），FEED / STREAM 通过 `content / turn / thread / speaker / context` 使用其中一部分；这些字段通道不会破坏当前默认格式，等下一步确认后再决定是否启用。

### 11. 去除圆盘右侧横波（默认生效）

用户用截图圈出圆盘右侧那片密集横向条纹，要求「去除掉」。逐项禁用诊断后的来源：

| 来源 | 作用 | 只停它够不够 |
|---|---|---|
| `drawStrands()` 的 5 层 `strandLayers`（含 `dyn:'bounce'` 的 v4 wave / rebound 层） | 横波主体，密集平行条纹 | 只停 bounce 层无效，其它 4 层仍画出横波 |
| `hazeEnv() > 0` 时 `drawOuterFar()` 调 `radialLines()` | 辅助密集短线 | 单独停几乎无变化 |
| `drawFlyers()` 的径向虚线 | 水平点线带 | 单独停仍有大片横波 |

第 22 组在 `drawStage()` 定义前加一个开关：默认三者全部停用，`?waves=1` 恢复原版外层射线。

```js
var OUTER_WAVES = new URLSearchParams(location.search).get('waves') === '1';
if (!OUTER_WAVES) {
  drawStrands = function () {};
  drawFlyers = function () {};
  hazeEnv = function () { return 0; };
}
```

**不动**：`flares` / `comets` / `drawLiveRays()` / `drawRing()` / `drawBagua()` / `drawTaiji()` / `laneC` / `TRIGRAM_FORMS` / 下方 8 个模块。事件到达时仍会由 `spawnLiveRay()` 与卦象形态画出少量射线，实测注入 8 条事件后 KPI、FEED、STREAM、卦位高亮全部正常。`window.YaoFlux.waves()` 返回当前开关状态。

### 12. 环外发射波射程（默认 2.2 倍，可调）

用户用截图圈出圆盘右侧那条「由断续白色短段组成、从环带边缘斜向右发射、末端渐淡」的波带，要求「发射得长一点」。诊断确认它是 `radialLines()` 驱动的 0/1 脉冲束：`?waves=1` 时还包括 haze bundle / strand 尾波 / flyer，默认态只剩 flare 根部闪光与事件射线；长度被 `L`、`f.len`、`life`、`RMAX` cull 限制在 18~485px。

第 23 组引入单一 `RAY_REACH`（默认 `2.2`，`?reach=<0.5..4>` 可调，`?reach=1` 精确回到第 22 组原长度）：

```js
var RAY_REACH = (function () {
  var v = parseFloat(new URLSearchParams(location.search).get('reach'));
  return (isFinite(v) && v >= 0.5 && v <= 4) ? v : 2.2;
})();
function reachK(w) { return 1 + (RAY_REACH - 1) * w; }
var __origRadialLines = radialLines;
radialLines = function (a0, a1, st, r0, L, seed, lo) {
  return __origRadialLines(a0, a1, st, r0, L * RAY_REACH, seed, lo);
};
```

| 层 | 权重 | 效果 |
|---|---|---|
| `radialLines()` 的 `L`（haze 束 / flare 闪光） | `RAY_REACH` 全额 | 断续波带直接变长，是红框主体 |
| `drawStrands()` 的 `L`、`newFlyer()` 的 `len` | `reachK(0.35)` | `?waves=1` 时束波与飞出线同步加长，避免喧宾夺主 |
| `spawnFlare()` 的 `life` | `reachK(0.30)` | 长波不会一闪就消失 |
| `spawnLiveRay()` 的 `sp` / `life`、`drawLiveRays()` 的 cull 半径 | `reachK(0.25/0.35/0.30)` | 事件 0/1 脉冲射线飞得更远 |

`window.YaoFlux.reach()` 返回当前倍率。**不改变第 22 组「默认关闭密集横波」的开关**，不改版式、不动下方 8 个模块、不动 `OUTER_WAVES` / `drawRing` / `drawBagua` / `drawTaiji` / KPI / FEED / STREAM。实测 `?reach=1` 与第 22 组基线逐像素等价；`?reach=2.2` 波带明显延伸到画面右侧；`?reach=3.2` 已偏密，不建议默认。

> 注意：默认态（横波已去除）下这些长波带大部分不可见，只剩事件射线。若用户截图中的「干净背景 + 几条稀疏长波带」才是目标形态，需要先确认是否要在默认态恢复一层稀疏发射束，而不是直接把 `?waves=1` 打开。

### 13. INVESTIGATION FEED 实时显示推理链（第 24 组）

用户 2026-11-11 需求：「agent和模型思考的过程在这个 INVESTIGATION FEED 模块里面实时数据显示」。三项选择经用户确认：

| 选择项 | 结论 |
|---|---|
| 数据来源 | **现有事件派生** —— 不新增任何事件字段，不改 `TRIGRAM_MAP`，不改 `event_relay.mjs` |
| 面板形态 | **挂在话轮下** —— 保留分源会话话轮，每条话轮下挂常驻展开的 THINKING 块 |
| 实时粒度 | **流式 delta** —— 链随事件逐条追加，步数实时增长，未封口时带 LIVE 游标 |

用户随后追加纠偏：「不要折叠，不要改变现有框架，采用流示」。因此**取消折叠态**：THINKING 块永远展开，改成终端 `tail -f` 式自动跟随流，点击标题只「暂停 / 恢复跟随」，不隐藏任何内容。

一条链 = 上次封口后到本次 `done` / `error` 之间的连续事件序列。`ingestConversation()` 里维护 `conv.curChain`；每条事件追加一步，`done` / `error` 封口并把链固定挂在终点话轮下；活跃链只挂在最新一条话轮下（先清旧引用再改 `open`，否则新旧话轮会挂同一条链、重复显示）。

**不伪造红线**：步骤只取事件自带的 `kind` / `text` / `tool` / `file` / `tokens` / `origin` / `ts`；`chainLabel()` 只是把 `kind` 翻译成中文标签，`pos` 只是链内位置标记，都不生成任何「模型心理活动」内容。没有事件就没有链，`window.YaoFlux.chains()` 可导出核对。

**面板高度约束与流式实现**：8 格框架下 `.fconv` 只有 ~64px 高，原 `flex-end + overflow:hidden` 会把展开的链块连同话轮压成 0 高。用户明确要求「不要折叠、不要改框架」，因此第 24 组在不改任何格子尺寸的前提下：
- THINKING 块**永远展开**，标题一行显示 `N STEPS` + `LIVE/DONE` + 最新一步 + `FOLLOW/PAUSED`；步骤区固定 2 行高（`.fst` 固定 11px 行高，`gap:1px`，窗口 `max-height:23px`），最近 8 步常驻 DOM，`overflow-y:auto` 自身滚动。
- 终端 `tail -f` 跟随：`renderFeed()` 重绘前先保存 `.fconv` 和每个 `.fsteps` 的 `scrollTop`；`feedFollow=true` 时全部滚到 `scrollHeight`，`false` 时恢复原位置。**暂停必须保留当前滚动位置**，否则重绘后跳回顶部会让 THINKING 整块消失、看起来像被折叠了。
- 仅推理链开启时给 `#feed` 加 `withchain` class：`.fconv` 改 `overflow-y:auto` / `flex-start`、子元素 `flex-shrink:0`。`?thinking=0` 时 class 不加、CSS 全部不生效，与第 23 组逐像素一致。

接口：`window.YaoFlux.thinking()` 查开关，`.chains()` 导出派生链，`.follow(v)` 暂停/恢复跟随，`?thinking=0` 回退。**不动** 8 格框架 / 模块标题 / cap 文案 / 其它 7 个模块 / STREAM / KPI / 主画布。注意：这是从事件流派生出的**执行推理链**（目标 → 工具 → 结果 → 结论），不是模型内部 CoT 原文；若要原文需另开 `thinking` 字段通道。默认 DEMO 模式下显示的是样例事件的派生链，接 `?relay=` / `emitAgent()` / BroadcastChannel 后就是真实 agent 事件。

### 14. 环外光束配色 = 截图冷青蓝单色系（第 25 组）

用户 2026-11-12 用截图指定「发出的光束按照这个模式」，随后**纠偏**：「我的意思是颜色成我截图的模样」。即**只改颜色**，不改光束形状、不新增发射层、不恢复第 22 组已去除的横波。

截图实测色阶（PNG 像素统计，R 明显低 / G 中高 / B 最高，无紫无粉）：

| 层次 | 色值 |
|---|---|
| 暗部 / 背景 | `#06131e` |
| 中间调 | `#0f2f3d` |
| 亮部 | `#2f7a8e` |
| 高亮 | `#71d1dc` |
| 冰青白尖端 | `#d8f6fb` |

单一开关 `BEAM_PALETTE`（默认 true；`?palette=0` 精确回退第 24 组原配色），只作用于主画布 canvas：

| 位置 | 原配色 | 新配色 |
|---|---|---|
| 主画布底色 / 环内遮罩 | `#08090b` / `#040506` 近黑灰 | `#06131e` / `#030c14` 深蓝黑 |
| 光束渐变 `GR.s0/s1/s2/h0/h1/h2` | 纯白 / 淡紫 / 青灰 | 冰青蓝渐变（保留原亮度层次） |
| 环外氛围渐变 `ag` | 淡紫 `rgba(190,180,240,…)` | 青蓝 `rgba(95,200,216,…)` |
| 近层短划与尖端 | 纯白 `#fff` | 冰青白 `#d8f6fb` |
| 事件 0/1 脉冲射线 | 青绿 `#98e0cf` / 粉 `#f0a6c6` | 冰青 `#71d1dc` / 亮青蓝 `#48c8d8` |

`window.YaoFlux.palette()` 查开关，`.paletteColors()` 导出色板。**不动**：CSS 变量 `--teal` / `--pink`、下方 8 个模块、8 格框架、标题与 cap 文案、太极黑白、先天八卦方位、`TRIGRAM_FORMS` 8 形态、`TRIGRAM OUTPUT` 浮层配色，以及第 22/23/24 组全部逻辑。

> 环带卦位高亮块与下方面板仍保留原青绿 / 粉配色 —— 它们不属于「发出的光束」。若要把整个画面统一成青蓝单色，需另行确认，不要擅自扩大范围。

### 15. 环外光束射程再加长（第 26 组）

用户 2026-11-12 在第 25 组配色之后追加「我希望光束发射的长一点」。第 23 组已引入 `RAY_REACH` 机制（默认 `2.2`、`?reach=1` 回退原长），**第 26 组只把默认值 `2.2 → 3.2`**，是构建脚本里一行的改动，完全可回退。不新增开关、不新增图层、不改形状。

固定随机种子 + PNG 像素测量（环外区域冷青蓝亮像素）：

| 场景 | 指标 | `reach=2.2` | `reach=3.2` | `reach=4` |
|---|---|---|---|---|
| `?waves=1` 波束态 | 亮像素 | 33,107 | **46,978** | 27,202（衰减） |
| `?waves=1` 波束态 | p95 右边界 | 1,060 | **1,120** | 1,120 |
| 默认干净态（定点 flare） | 亮像素总数 | 2,431 | 2,430（不变） | — |
| 默认干净态 | p95 右边界 | 638 | **708**（右移 70px） | — |
| 默认干净态 | 远端 x≥690 像素 | 24 | **141**（约 5.9×） | — |

要点：**总亮像素不变、远端像素显著变多**，说明效果是「同样多的光束射得更远」，而不是变亮、变密或新增发射层。`reach=4` 在波束态已开始衰减，故参数上限仍保持 4，默认取 3.2 甜点。

- 回退：`?reach=2.2` 精确回到第 25 组长度，`?reach=1` 回到第 22 组原长度；`window.YaoFlux.reach()` 查当前值。
- **曾尝试但已撤销**：加快 flare 成长速度 `t*3 → t*3*(1+0.35*(RAY_REACH-1))`，实测会让默认态光束变淡（亮像素 309 → 158），不要再加回来。
- **不动**：光束形状 / 层数、`OUTER_WAVES` 默认关闭、第 25 组冷青蓝色板、下方 8 模块与 8 格框架、标题 / cap 文案、FEED 推理链。
- 注意：默认「干净态」下环外只有稀疏的 0/1 脉冲亮点，光束本来很淡，静态截图中加长不易察觉；密集波带只在 `?waves=1` 调试态可见。**用户看到的究竟是默认态零星脉冲、`?waves=1` 波带还是事件射线，仍需确认**，不要据此擅自改亮度或线宽。

## 约束

- 只读优先。安装器默认 dry-run，`--apply` 前必须先列出具体路径并取得用户明确确认；写入前自动备份，卸载不递归删除。
- 不采集会话正文。事件默认只含 `role` / `kind` / `tokens` / 脱敏摘要，本地回环，不上云；网关只接收外部主动投递的结构化事件，不主动读取任何 Agent 日志；`hook.mjs` 绝不读取 `transcript_path` 指向的会话文件。
- 网关只监听 `127.0.0.1`，事件只存内存（默认 40 条重放），不落盘；MCP Server 的 stdout 只允许输出协议消息，日志一律走 stderr。
- 封闭 GUI / 云同步客户端（L3）没有本地事件源，显示 `no stream`，绝不生成假数据补齐。
- 派生页面沿用原作许可：保留文件头版权声明与页面内 `ORIGINAL: HALOFLUX by Ryder191` 署名，仅限非商业用途。
- 修改视觉改造细节前先读 `references/agent-detection.md`，不要破坏三层共用的圆心、相机、节拍与配色。

## 资源

- `bin/yaoflux.mjs` — CLI 总入口（start / status / emit / watch / install / uninstall / doctor / mcp）
- `scripts/mcp_server.mjs` — MCP stdio Server，暴露 5 个 `yaoflux_*` 工具，各主流 Agent 的统一接入点
- `scripts/event_relay.mjs` — 统一事件网关（SSE 下行 / POST 上行 / 托管看板 / 字段白名单）
- `scripts/hook.mjs` — 通用 stdin Hook，支持运行时自动上报，不读会话正文
- `scripts/install.mjs` — 幂等安装器（默认 dry-run，`--apply` 才写，自动备份）
- `scripts/relay_client.mjs` — Node 侧跨进程通道（POST /emit + SSE 订阅，替代无效的 BroadcastChannel）
- `scripts/adapters/` — 注册表驱动的平台适配器（workbuddy / harness / codex / claude / generic）
- `config/` — 各平台可合并的配置片段（WorkBuddy MCP、Codex TOML、Claude Hooks、DSH 手动步骤）
- `scripts/agent_registry.mjs` — 只读探测与注册表生成
- `references/agent-detection.md` — 证据分级、能力档与新增 agent 的扩展规则
- `assets/yaoflux.html` — YAO FLUX 单文件看板
- `agents.json` — 最近一次探测结果（含 adapter 路由）
