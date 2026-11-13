# YAO FLUX · 实时会话观象台

> YAO FLUX — a real-time observatory for your local AI agents.

自动识别本机安装的所有 Agent，生成带证据与能力分级的注册表；安装后通过 **MCP / Hooks / CLI** 把各 Agent 的结构化事件实时推送到一个单文件可视化看板。

看板保留原作的太极 / 先天八卦 / 0-1 脉冲视觉，下方固定为 4×2 共 8 个模块。`INVESTIGATION FEED` 按 Agent + session 聚合成话轮并派生执行推理链，`AGENT DATA STREAM` 显示分源事件流水；事件来源三态可见：`LIVE`（真实投递）/ `DEMO`（样例）/ `UI`（页面操作）。

> 本仓库为公开仓库，但看板衍生自 [HALOFLUX by Ryder191](https://ryder191.github.io/haloflux/lab.html)，沿用 **PolyForm Noncommercial License 1.0.0**，**仅限个人 / 非商业演示**。

## 数据流

```
Agent ─┬─ MCP 工具 yaoflux_emit ─┐
       ├─ Hooks  → hook.mjs ─────┼─→ POST /emit ─→ 127.0.0.1:8787 事件网关 ─→ SSE /events ─→ 看板 FEED / STREAM
       └─ CLI    → yaoflux emit ─┘                        └─ 同时托管 GET /dashboard
```

Node 的 `BroadcastChannel` 只在同进程 worker 之间通信，**不能**用于跨 Agent 进程；所有跨进程事件一律走本地回环网关。

## 快速开始

需要 **Node.js 18+**，macOS 或 Linux，零第三方依赖。

```bash
cd yaoflux-skill
node bin/yaoflux.mjs doctor           # 环境自检 + MCP 协议握手
node bin/yaoflux.mjs install          # 默认 dry-run，只输出将写入的路径清单
node bin/yaoflux.mjs install --apply  # 确认后才写用户目录，写入前自动备份
node bin/yaoflux.mjs start --open     # 前台启动网关并打开看板
```

打开 <http://127.0.0.1:8787/> 即可：根路径会 302 到 `/dashboard?relay=<origin>`，页面自动进入 LIVE 模式。MCP Server 在会话启动时会自动复用或内联拉起网关，**通常无需手动 `start`**；需要长期常驻时再用它。

也可以不安装，直接把整个目录放进客户端的 skills 目录，或上传 `yaoflux-skill-v0.3.0.zip`。

## 目录结构

标准单 Skill 布局：`.zip` 解压后根目录直接是 `SKILL.md`，没有包装目录。

| 路径 | 说明 |
|---|---|
| `SKILL.md` | Skill 定义，含标准 YAML frontmatter（`name` / `description`） |
| `scripts/mcp_server.mjs` | MCP stdio Server，5 个 `yaoflux_*` 工具 |
| `scripts/event_relay.mjs` | 统一事件网关：SSE 下行 / POST 上行 / 托管看板 |
| `scripts/hook.mjs` | 通用 stdin Hook，运行时自动上报 |
| `scripts/install.mjs` | 幂等安装器（默认 dry-run，`--apply` 才写） |
| `scripts/relay_client.mjs` | Node 侧跨进程通道 |
| `scripts/adapters/` | 注册表驱动的平台适配器 |
| `scripts/agent_registry.mjs` | 只读探测与注册表生成 |
| `references/` | 证据分级、能力档与页面改造记录 |
| `assets/yaoflux.html` | 单文件看板 |
| `bin/yaoflux.mjs` | CLI 总入口 |
| `config/` | 各平台可合并的配置片段 |
| `agents.json` / `plugin.json` | 本机 Agent 注册表 / 插件兼容清单 |

## 各 Agent 如何接上实时数据

| Agent | 通道 | 自动化程度 | 启用动作 |
|---|---|---|---|
| WorkBuddy | MCP stdio `yaoflux_emit` | 会话内主动上报 | 在「连接器 → 自定义连接」信任 `yaoflux`，重启会话 |
| Codex CLI | MCP stdio（`~/.codex/config.toml`） | 会话内主动上报 | 重启 Codex，`codex mcp list` 确认 |
| Claude Code | Hooks → `scripts/hook.mjs` | **运行时全自动**，模型无需配合 | 重启后工具调用 / 响应结束自动产生事件 |
| DeepSeek Harness | 插件 `skills/` + MCP | 会话内主动上报 | 见 `config/dsh-plugin.json`，v0.1 路径随版本变化，需手动 |
| 任意脚本 / 其它 Agent | `yaoflux emit` 或 `POST /emit` | 手动 / 脚本 | 一行命令或 HTTP 投递 |
| 封闭桌面 GUI（ChatGPT / Grok 等 L3） | 无 | 不支持 | 显示 `no stream`，**不伪造数据** |

Skill 被加载后，应在关键节点调用 `yaoflux_emit`：`plan` → `tool_call` / `tool_result` → `file` / `search` → `done` 或 `error`。同一 `session_id` 的事件会在 FEED 聚成一个话轮。

## MCP 工具

| 工具 | 作用 |
|---|---|
| `yaoflux_emit` | 上报一条结构化事件 |
| `yaoflux_emit_batch` | 批量上报（最多 50 条），补齐一段执行链 |
| `yaoflux_status` | 查询网关状态 |
| `yaoflux_open` | 返回看板地址 |
| `yaoflux_agents` | 列出已识别的本机 Agent，确认该填哪个 `agent_id` |

## 上报事件格式

```json
{
  "platform": "workbuddy",
  "agent_name": "WorkBuddy",
  "session_id": "conv_01",
  "role": "assistant",
  "kind": "tool_call",
  "text": "读取源码",
  "tool": "Read",
  "file": "lab.html",
  "task": "重构工作视图",
  "tokens": 128
}
```

- `platform` 必须对应 `agents.json` 里的 agent id，页面据此分源。
- `text` 是**脱敏摘要**，不要放会话正文、密钥或个人信息；可选 `content` 才用于话轮正文片段。
- 网关按白名单透传并逐项限长；没有真实 token / 耗时数据就不要编造。

## 网关 API

| 接口 | 作用 |
|---|---|
| `GET /` | 302 到 `/dashboard?relay=<origin>` |
| `GET /dashboard` | 托管单文件看板 |
| `GET /history` | 首屏同步快照（内存默认保留 40 条） |
| `GET /events?since=<seq>` | SSE 长连接，按 `seq` 去重续传 |
| `POST /emit` | 投递一条或 `{ events: [...] }` 批量 |
| `GET /agents` | 返回注册表 |
| `GET /health` | 连接数、接收数、重放条数、运行时长 |

## 命令速查

| 命令 | 说明 |
|---|---|
| `start [--port N] [--open]` | 前台启动网关并托管看板 |
| `status` / `watch` | 查状态 / 终端监听 SSE |
| `emit '<json>'` 或 `emit --agent workbuddy --kind tool_call --text "..."` | 手动投递 |
| `install [--apply]` / `uninstall [--apply]` | 安装 / 卸载，默认 dry-run |
| `doctor` | 环境自检 + MCP 握手 + SKILL.md 规范校验 |
| `mcp` | 以 stdio 模式运行 MCP Server |

## 安全边界

- 网关**只监听 127.0.0.1**，事件只存内存、不落盘、不上云。
- 不扫描磁盘、不读取任何 Agent 会话文件 / 日志 / 云同步数据；只接收外部主动投递的结构化事件。
- `hook.mjs` 绝不读取 `transcript_path` 指向的会话文件，只取 stdin 元数据（工具名 / 文件路径），任何失败都静默退出 0，不阻塞用户操作。
- 安装器默认 dry-run；`--apply` 前会先列出完整路径清单，写入前自动备份到 `~/.yaoflux/backups/<时间戳>/`，卸载不递归删除。
- L3 封闭 GUI 显示 `no stream`，绝不生成假数据补齐。

安装器会触碰的位置：`~/.workbuddy/skills/yaoflux/`、`~/.workbuddy/mcp.json`、`~/.codex/config.toml`、`~/.claude/settings.json`（仅当已安装）、`~/.yaoflux/`。未安装的客户端自动跳过。

## 验证

```bash
node bin/yaoflux.mjs doctor
node bin/yaoflux.mjs emit --agent workbuddy --kind tool_call --text "读取源码" --tool Read
node bin/yaoflux.mjs watch          # 另一个终端可见实时事件
node bin/yaoflux.mjs status
```

`doctor` 会校验 `SKILL.md` 的 YAML frontmatter、标准目录布局与 MCP 协议握手。

## 许可与署名

- 衍生页面沿用 **PolyForm Noncommercial License 1.0.0**，仅限个人 / 非商业演示，禁止任何商业用途。
- 原作：**HALOFLUX by Ryder191** — <https://ryder191.github.io/haloflux/lab.html>
- `assets/yaoflux.html` 文件头保留原许可声明，页面内显示 `ORIGINAL: HALOFLUX by Ryder191`。

---

YAO FLUX v0.3.0 · 作者 严过关
