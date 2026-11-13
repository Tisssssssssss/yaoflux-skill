# Agent 探测规则

## 证据类型

| 类型 | 来源 | 强度 |
|---|---|---|
| `app` | `/Applications/*.app`、`~/Applications/*.app` 目录名命中特征库 | 中 |
| `bundle` | 该 app 的 `Info.plist` 里 `CFBundleIdentifier` 字段 | 强 |
| `config` | 专属配置目录/文件存在，如 `~/.workbuddy`、`~/.codex` | 强 |
| `cli` | PATH 中可执行文件（用 `fs.accessSync(X_OK)` 判断，不启动进程） | 强 |
| `mcp` | MCP 清单存在，如 `~/.workbuddy/mcp.json` | 中 |

**置信度**：证据类型 ≥ 2 种 → `confirmed`；仅 1 种 → `probable`；只有可疑应用名且 bundle id 不匹配 → 进 `unclassified` / `needs-review`。

名称可疑不等于 agent。例如本机 `Marvis.app` 的 bundle id 是 `com.tencent.mac.marvis`，`START.app` 是 `com.tencent.start.mac.Start`，均无法据此判定为 Agent，因此只能列为待确认，不得计入识别数。

## 能力档：识别 ≠ 接入

| 档 | 含义 | 判定依据 | 处理 |
|---|---|---|---|
| `L1` | 真·实时 | 有 Hook / MCP / SSE / 官方事件链 | 可订阅，<100ms |
| `L2` | 准实时 | 有本地可读会话日志（JSONL） | tail 文件，1–2s |
| `L3` | 仅发现 | 封闭 GUI / 云同步 / 加密存储 | 只列出，不采集，不假装能采 |
| `unknown` | 待判定 | 证据不足或特征库未覆盖 | 标 `needs-review`，等人确认 |

当前已知：WorkBuddy 无公开全量会话 API，靠 Skill 触发注入（L1 但仅覆盖参与会话）；DeepSeek Harness 的 append-only 事件链是天然 L1 候选，但 v0.1 有破坏性变更风险；Claude Code / Codex CLI 属 L2；ChatGPT / Grok 桌面端属 L3。

## 只读红线

`agent_registry.mjs` 中 `SKIP_PATTERNS` 明确排除：

```
projects, sessions, session, history, conversations, chats, logs, shell-snapshots, todos, cache
```

- 不递归进入上述目录，不读取任何会话正文。
- 唯一读取的文件内容是 `Info.plist` 中的 `CFBundleIdentifier`。
- 唯一写入是脚本自己的 `agents.json`。
- 不移动、改名、删除任何被探测文件。

## 新增一个 Agent

在 `CATALOG` 追加一条：

```js
{
  id: 'my-agent', name: 'My Agent', kind: 'cli', adapter: 'generic',
  apps: ['My Agent.app'], configs: ['.myagent'], clis: ['myagent'],
  bundle: /myagent/i, capability: 'L2', note: '本地 session 日志可 tail'
}
```

若需要专属接入逻辑，在 `scripts/adapters/` 新增同名模块并导出四方法，注册表里把 `adapter` 指向它即可，无需改动 `SKILL.md` 或页面。

## 页面映射约定

- 页面内嵌 `agents.json`，通过 `window.YaoFlux.setAgents()` 热更新。
- 能力档映射颜色：L1 青（teal）、L2 蓝、L3 灰、unknown 暗。
- 点击某 agent 行会触发一条会话事件，并把 `AGENT DATA STREAM` 面板过滤到该 agent，用于验证「注册表 → 事件总线 → 卦位点亮 → 数据流面板」链路。
- `AGENT DATA STREAM`（原 METHOD WORKSPACE）按 `agent_id` 分源显示实时事件；DEMO 只从 `enabled` 的 agent 生成事件，L3 / 未接入的 agent 显示 `no stream`，不伪造数据。
- 外部接入统一走 `window.YaoFlux.emitAgent(id, evt)` 或 `BroadcastChannel('haloflux-live')`，事件经 `pushLive()` 一处分发、全站响应。
- `INVESTIGATION FEED` 与 `AGENT DATA STREAM` **同源不同聚合**：都来自 `pushStream()` 写入的事件总线；STREAM 用 `streamRows` 扁平事件流水，FEED 用 `agentThreads` 按 agent + session 聚话轮（见下方分源会话条目）。`window.YaoFlux.events()` 导出 `streamRows`，`window.YaoFlux.conversations()` 导出 `agentThreads`。
- `origin` 三态必须可见：`LIVE`（青，外部真实事件）、`DEMO`（粉，模拟事件）、`UI`（白，页面操作）。无事件时显示等待态，**不得预填假数据**；过滤时两个面板同步切换。
- 真实数据链路：`scripts/event_relay.mjs` 提供 `GET /history` 首屏快照、`GET /events?since=<seq>` SSE 续传、`POST /emit` 投递、`GET /health` 健康检查；页面用 `?relay=http://127.0.0.1:8787` 启用并自动关闭 DEMO。中继仅监听回环地址，事件只存内存，不读取任何 Agent 会话文件。
- 圆盘构图由 `CROP_PRESETS` + `?crop=full|soft|cut|fade` 控制，默认 `soft`（左侧外环出画、太极完整贴左、浮层让到右下）。裁切必然牺牲左侧卦位，重裁还会切到太极；改构图只动 `cx / R` 系数与 `html[data-crop]` 的 CSS，不要改 `BAGUA` 先天方位数组或 `drawTaiji()` 的黑白比例。
- `TRIGRAM_FORMS` 是「卦象 → 输出形式」的唯一定义处（8 卦 8 形态），同时驱动 `radialLines()` 密度、`drawLiveRays()` 画法与 `TRIGRAM OUTPUT` 浮层版式。`activeTrigram()` 以正右方为固定读数位，`updateRing()` 每帧检测，`onTrigramChange()` 一处切换全局。改形式只改 `render` / `ray`，勿动 `BAGUA` 方位。
- 事件 kind 经 `TRIGRAM_MAP` 按卦德映射到卦位（如 `error→坎 / DIAGNOSTIC`、`tool_call→震 / SIGNATURE`），与该卦输出形式语义一致；`streamRows[].trigram` 保存命中卦位，`window.YaoFlux.trigram()` / `.forms()` 可查询当前态。
- FEED 与 STREAM 同源不同聚合：`streamRows` → STREAM / TRIGRAM OUTPUT（扁平流水），`agentThreads` → FEED（按 `agent + session_id` 聚话轮）。改 FEED 只动 `ingestConversation()` / `renderFeed()` / `setFeedAgent()`；`feedRows()` 仍供 TRIGRAM OUTPUT 使用，不要删。`onTrigramChange()` 只刷新行尾卦标，不得重排 FEED 版式。
- 对话字段三级降级必须守住「不伪造」：无 `content` 只用 `text` 并标「摘要」；`turn` 缺省按到达顺序编号并在详情里标 `turn 推断`；L3 / 未接入 agent 显示 `no conversation`，不生成任何对话内容。
- **当前状态（2026-11-10）：下方模块已回到默认格式版本。** 第 20 组（跨整行 `AGENT WORKSPACE` 宽表）与第 21 组（8 格框架不变、只换 6 模块数据源）均被用户否决并回退；此后只追加了与下方模块无关的第 22 组（去除圆盘右侧横波）。当前有效补丁组 1–19 + 22，正式页面 SHA256 `d940bf2c0ed153783c7080d92759fb14cef6ec9831f2b31179598f68187868f0`（第 19 组基线为 `4bd8b518…`）。
- 底部 4×2 共 8 个模块全部是默认版式：`INVESTIGATION FEED`（分源会话）与 `AGENT DATA STREAM`（分源事件流）保留真实数据；其余 6 个原版演示模块（`ADVECTION / PARTICLE SOLVER`、`SHARED SCENE / DIFFERENCE FIELD`、`SOURCE / EXTRACTION ROUTES`、`VALIDATION / SAMPLE BUFFER`、`12 AGENTS / DISPATCH`、`METHOD / REFERENCE INDEX`）的 HTML / CSS / 标题 / cap 文案 / canvas / 表格 / 按钮 / 随机渲染函数全部原样恢复，属于**原版演示数据，不是实时数据**。
- `frame()` 中 `drawAdv(dt); drawDiff(); drawVal(); drawIdx(); agentsTick(dt);` 是原版调用；`rState / AG / agRows / valBuf / IDX / drawAdv / drawDiff / drawVal / drawIdx` 都是原版实现；`resizePanels()` 做 4 个 canvas 的 `fit()`，`T` 是全局节拍。**不要用真实事件改写这些函数，除非用户重新明确确认**。
- **改造边界（用户两次纠偏后的硬约束）**：底部固定 8 个模块，不合并、不删格、不新增跨整行面板；再次动工前先问清「默认格式」与「要改成什么」的差别，不要凭一句话推断版式。
- 保留的基础设施：`event_relay.mjs` 的 `normalize()` 白名单仍含 `tool / tool_name / file / path / op / task / duration_ms`（可选透传、逐项限长），`window.YaoFlux.emitAgent()` / `BroadcastChannel` / `?relay=` SSE 仍可驱动 FEED / STREAM；主画布（太极 / 八卦 / 0/1 脉冲）沿用原作数学艺术数据。
- **圆盘右侧横波默认已去除（第 22 组，2026-11-10 截图指定）**：`OUTER_WAVES` 默认 false，在 `drawStage()` 定义前把 `drawStrands()` / `drawFlyers()` 置空、`hazeEnv()` 固定返回 0；`?waves=1` 恢复原版。逐项诊断证明横波主体是 5 层 strand（只停 `dyn:'bounce'` 波层无效），haze 与 flyers 是辅助。**不要顺手停掉 `drawOuterFar/Near`、`drawLiveRays()`、`flares`、`comets`**：事件射线、卦象输出形态、环带刻度都还在用。`window.YaoFlux.waves()` 可查开关状态。
- 主画布改动仍走「构建脚本加补丁组 → 重建 → 同步 assets → 截图对照」流程；视觉开关一律做成 URL 参数并保留原版回退（已有 `?crop=`、`?waves=`、`?reach=` 先例）。
- **当前有效补丁组：1–19 + 22 + 23 + 24 + 25 + 26**（2026-11-12）。第 22 组去横波、第 23 组加长射程、第 25 组换配色、第 26 组再拉长射程都不动下方模块；第 24 组只改 `INVESTIGATION FEED` 内部渲染。正式页面 SHA256 `75372e673c62a00284433aac2482ada3dbd3a75eb59706184074c917cf9e27fb`，`assets/yaoflux.html` 同步一致（与第 25 组 `3138a1d5…` 只差一行 `RAY_REACH` 默认值）。第 25 组基线可用「去掉第 26 组」的临时构建精确复现。
- **第 25 组配色（2026-11-12 截图指定）**：用户先说「发出的光束按照这个模式」，我方误读成「改成空心小方框形状」并做了方框 Demo；用户随即纠偏「**我的意思是颜色成我截图的模样**」。教训：截图里「模式」可能指配色而非形状，动手前先分清是形态还是颜色。最终只改颜色：`BEAM_PALETTE` 默认 true，`?palette=0` 回退；`BEAM_COL` 色板 `#06131e / #0f2f3d / #2f7a8e / #71d1dc / #d8f6fb`，替换主画布底色、环内遮罩、`GR` 六组光束渐变、环外氛围渐变、白色短划/尖端、事件射线 tint。**不改光束形状、不新增发射层、不恢复第 22 组横波、不动面板与 8 格框架**。环带卦位高亮块与下方面板仍是原青绿/粉配色，属刻意保留。
- 配色相关代码集中在 `buildOuter()` 里的 `GR` 渐变（第 25 组在其末尾覆盖）、`drawStage()` 的底色 `S.fillRect` 与 `ag` 氛围渐变、`drawOuterNear()` 的 `#fff` 短划/尖端、`drawLiveRays()` 的 `f.color || tint`。面板用的是 CSS 变量 `--teal/--pink`，与主画布 canvas 是两套，不要混改。
- **第 24 组 FEED 推理链（2026-11-11）**：用户要求「agent 和模型思考的过程在 INVESTIGATION FEED 里实时显示」，经确认选「现有事件派生 + 挂在话轮下 + 流式 delta」。不新增事件字段、不改 `TRIGRAM_MAP` / `event_relay.mjs`；`conv.curChain` 按连续事件累积，`done` / `error` 封口。**封口必须先清旧引用再改 `open`**，否则新旧话轮挂同一条链重复显示。步骤只用事件自带 `kind/text/tool/file/tokens/origin/ts`，绝不生成解释性文字。
- **（2026-11-11 用户纠偏，覆盖旧版折叠说明）**用户原话「不要折叠，不要改变现有框架，采用流示」：折叠态已**完全移除**（`feedChainOpen` 已删）。THINKING 块永远展开，改成终端 `tail -f` 式自动跟随流。
- FEED 面板 `.fconv` 只有 ~64px，在不改格子尺寸的前提下的实现：`.fst` 固定 `height:11px` + `gap:1px`，`.fsteps` 窗口 `max-height:23px`（正好 2 整行，避免半行裁切）、`overflow-y:auto`、`display:flex` 且 `flex-shrink:0`（否则 8 行会被压扁而不是滚动）；最近 8 步常驻 DOM。`renderFeed()` 重绘前保存 `.fconv` 与各 `.fsteps` 的 `scrollTop`：`feedFollow=true` 全部滚到 `scrollHeight`（tail -f），`false` 恢复原位置（可向上回看历史）。**暂停时若把 `scrollTop` 重置为 0，THINKING 整块会跳出可视区，看起来像被折叠了** —— 这是实测踩过的坑。
- 仅 `FEED_THINKING` 时给 `#feed` 加 `withchain`（`overflow-y:auto` / `flex-start` / 子元素 `flex-shrink:0`），`?thinking=0` 时 class 不加、第 24 组 CSS 全部不生效，与第 23 组逐像素一致。点击 THINKING 标题只切换 `FOLLOW/PAUSED`，不折叠、不隐藏。
- `window.YaoFlux.thinking()` / `.chains()` / `.follow(v)` / `?thinking=0` 为第 24 组接口。六态 DOM 探针验收：`step2` 1 块 2 步 LIVE / `step5` 1 块 5 步 scroll 36/36 / `step8` 2 块 8 步 scroll 48/48 / `paused` PAUSED 且块仍完整可见 / `done6` 封口无 LIVE 游标 / `off` 0 块。**下方 8 模块的框架、标题、cap 文案、其它 7 个模块内容依然原样**，第 20 / 21 组的硬约束继续有效。
- **第 23 组射程（2026-11-11 截图指定）**：`RAY_REACH` 默认 `2.2`，`?reach=1` 精确回退到第 22 组原长度，`?reach=<0.5..4>` 连续可调；`reachK(w)` 给不同层分配权重。`radialLines()` 用全额倍率（haze 束 / flare 根部闪光，即红框里的断续波带），`drawStrands()` 的 `L` 与 `newFlyer()` 的 `len` 用 `reachK(0.35)`，`spawnFlare().life` 用 `reachK(0.30)`，`spawnLiveRay().sp/.life` 与 cull 半径用 `reachK(0.25/0.35/0.30)`。`window.YaoFlux.reach()` 可查。**不要改 `OUTER_WAVES` 开关**：默认仍是关闭密集横波的干净态；只有在 `?waves=1` 下才能看到成片的长波带。此处记录的默认 `2.2` 已被第 26 组提升为 `3.2`（见下条）；当时「3.2 偏密」的判断针对 `?waves=1` 波束态，与默认干净态不是同一场景。
- **第 26 组射程再加长（2026-11-12 用户「我希望光束发射的长一点」）**：**唯一改动是把 `RAY_REACH` 默认值 `2.2 → 3.2`**（构建脚本 `g26-default` 一行），机制全部沿用第 23 组。`?reach=2.2` 回退第 25 组长度，`?reach=1` 回退第 22 组原长，参数上限仍为 4。固定种子 + PNG 像素测量：`?waves=1` 下亮像素 33,107 → 46,978、p95 右边界 1,060 → 1,120，`reach=4` 已衰减到 27,202；默认干净态下亮像素总数 2,431 → 2,430（不变）、p95 右边界 638 → 708、远端 x≥690 像素 24 → 141（约 5.9×）。**总亮度不变、远端变多**，即「同样多的光束射得更远」，不是变亮、变密或新增层。曾尝试加快 flare 成长速度，实测让默认态光束变淡（309 → 158），已撤销，不要加回来。
- 默认干净态环外只有稀疏的 0/1 脉冲亮点，静态截图里加长不易察觉；密集波带只在 `?waves=1` 调试态可见。**用户所指的「光束」究竟是默认态脉冲、`?waves=1` 波带还是事件射线，尚未确认**，不要据此擅自调亮度 / 线宽 / 层数。
- 诊断经验：headless 想看动画中段的波带，用「接管 `requestAnimationFrame` → 同步快进 N 帧 → 末尾恢复原生 rAF 重新调度」的方式，避免 `--virtual-time-budget` 的 SIGTERM(137)；若只接管不恢复原生 rAF，canvas 有像素但合成器不提交，截图会是全黑。跨 `file://` 图片做像素差分必须加 `--allow-file-access-from-files`，否则 `getImageData` 静默失败、差分全黑。
- `/tmp/haloflux_lab.html` 是原页源码，可能被系统清理；缺失时重新 `curl -sL https://ryder191.github.io/haloflux/lab.html -o /tmp/haloflux_lab.html`，重新下载后先跑一次「去掉最新补丁组」的构建，核对能复现上一个已知 SHA 再继续。

## v0.2.0 封装：安装后直接对接各 Agent 实时数据（2026-11-13）

- **修正一个架构级错误**：旧适配器 `subscribe()` 用 Node 的 `BroadcastChannel`，它只在**同进程 worker 之间**通信，不同 Agent 进程 / 浏览器页面根本收不到。所有跨进程事件现在一律走 `127.0.0.1:8787` 回环网关：上报 `POST /emit`、订阅 `GET /events` SSE，统一实现在 `scripts/relay_client.mjs`。页面侧的浏览器 `BroadcastChannel('haloflux-live')` 仍保留，但只用于同源标签页调试，**不要**再当成 Agent 接入通道。
- **统一接入点 = MCP stdio Server**（`scripts/mcp_server.mjs`）：JSON-RPC 2.0、每行一条消息、stdout 只写协议消息 / 日志走 stderr。暴露 `yaoflux_emit` / `yaoflux_emit_batch` / `yaoflux_status` / `yaoflux_open` / `yaoflux_agents` 五个工具。WorkBuddy（`~/.workbuddy/mcp.json` 的 `mcpServers`）、Codex CLI（`~/.codex/config.toml` 的 `[mcp_servers.*]`）、Claude Code、DSH 都支持这种 stdio MCP，配置片段在 `config/`。
- **网关零手动启动**：MCP Server 在 `initialize` 时调用 `ensureRelay()`，先探测 8787 是否已有 YAO FLUX 网关，有就复用；没有就用 `createRelayServer()` 在本进程内联拉起。`EADDRINUSE` 视为已有实例。因此多个 Agent 同时在线不冲突、不留后台常驻进程；需要长期常驻时用 CLI `start`。`GET /` 会 302 到 `/dashboard?relay=<origin>`，页面因此无需任何改动即可进入 LIVE 模式。
- **Hooks 是唯一的「真·自动」通道**：`scripts/hook.mjs` 读 stdin 元数据（`hook_event_name` / `tool_name` / `tool_input.file_path` / `session_id`），映射到 `tool_call` / `tool_result` / `done` 后 POST。**绝不读取 `transcript_path` 指向的会话文件**，不采集工具返回内容，任何失败都静默退出 0（绝不返回非 0 阻塞用户操作）。Claude Code 的 `PostToolUse` / `Stop` 配置见 `config/claude-hooks.json`。
- **适配器现在是「元数据 + 有效 transport」**：`workbuddy`(L1, MCP, auto=false)、`harness`(L1, 插件+MCP, auto=false)、`codex`(L1, MCP, auto=false)、`claude`(L1, Hooks, **auto=true**)、`generic`(L2, CLI 兜底)。每个都导出 `id / label / capability / transport / auto / configSnippet / platformIds / matches / detect / capabilities / subscribe / install`；`subscribe()` 委托给 `relay_client.subscribeRelay()` 做 SSE 订阅。`agents.json` 里 `claude-code` 与 `codex-cli` 的 `adapter` 已从 `generic` 改为 `claude` / `codex`，`capability` 仍是原始探测分级，实际接入能力以适配器为准。
- **安装器红线**：`scripts/install.mjs` 默认 dry-run 只输出路径清单，不创建 / 修改 / 删除任何文件；只有 CLI `--apply` 才执行，且写入前把被修改的原文件备份到 `~/.yaoflux/backups/<时间戳>/`。JSON 用「合并」不覆盖，`config.toml` 用 `# >>> yaoflux (managed)` marker 保证幂等，卸载时只移除自己的键 / 块，安装进去的 Skill 目录「移动」到备份区而非递归删除。未安装的客户端自动跳过；DSH v0.1 插件路径不确定，只输出手动步骤不写入。
- **实测验收（10/10）**：`GET /` 302 带 relay 参数、`GET /dashboard` 托管 149,740 bytes 看板、三源 `POST /emit`、`GET /history` 三源快照、MCP `tools/call yaoflux_emit`、Hook 自动上报且不读会话正文、Chrome headless 打开托管看板后 DOM 命中 4 个来源的真实事件文本（LIVE 渲染成功）、`GET /health`。`doctor` 自检通过 5 个工具的 MCP 协议握手。
- **边界不变**：只回环、不上云、不落盘、不读会话正文 / 日志 / 云同步数据；L3 封闭 GUI 显示 `no stream`，不伪造数据。事件 `platform` 必须对应 `agents.json` 的 agent id，页面据此分源。

## v0.3.0 重新封装：标准单 Skill 扁平布局（2026-11-13）

- 用户连续三次强调「.zip 需要包含 SKILL.md 文件，SKILL.md 需含 YAML 格式的技能名称和描述」。复盘：v0.2.0 虽然包根有 `SKILL.md`，但 zip 里仍套了一层 `yaoflux-skill/` 目录（条目是 `yaoflux-skill/SKILL.md`），且包内还有 `skills/yaoflux/` 嵌套，平台校验按「zip 根直接含 SKILL.md」判定会失败。
- **本次改为标准单 Skill 扁平布局**：把 `skills/yaoflux/scripts/` 与 `skills/yaoflux/references/` 提升到包根，删除嵌套的 `skills/` 层与重复的 `SKILL.md`，包根现在是 `SKILL.md` + `scripts/` + `references/` + `assets/` + `bin/` + `config/` + `agents.json` + `plugin.json`。**`.zip` 从目录内部打包，第一层条目直接就是 `SKILL.md`，没有包装目录**。
- 路径常量相应调整：`event_relay.mjs` / `mcp_server.mjs` 在 `<root>/scripts`，资产与注册表用 `../assets/yaoflux.html` / `../agents.json`（上溯一级，不再是三级）；CLI import 改 `../scripts/event_relay.mjs`；适配器 `configSnippet` 改 `../../config/…`；`install.mjs` 的 MCP 入口改 `<skillDir>/scripts/mcp_server.mjs`；所有 config 片段与文档中 `<YAOFLUX_ROOT>/skills/yaoflux/scripts/` → `<YAOFLUX_ROOT>/scripts/`。
- `SKILL.md` 的 frontmatter 保持标准 YAML：`name: yaoflux` + 双引号 `description`，`compatibility` 收在 `metadata` 下。`plugin.json` 升 0.3.0，`skill_entry: ./SKILL.md` / `skill_format.layout: flat single-skill`。`doctor` 简化为「包根 SKILL.md frontmatter 合规 + 标准目录布局」两项检查，不再校验两份副本。
- **经验固化**：Skill 分发包的判定点是「.zip 解压后根目录有没有 SKILL.md」，不是「包内某处有没有」。以后打包一律 `cd <skill-dir> && zip -r ../out.zip .`，不要从父目录 `zip -r out.zip <skill-dir>`。
