# M1 设计：AI Star Studio v3 平台地基（能力网关 + 全云端）

- 日期：2026-06-13
- 状态：已批准（用户确认：全新重写、完整 M1、技术路线 A）
- 上游规格：[ai-star-studio-prd-v3.md](../../ai-star-studio-prd-v3.md) 第 2/3/5/7/8 节与第 9 节 M1
- 仓库：`F:\projects\Starstudio`（全新仓库；v2 代码不迁移，仅规格继承）

## 0. 范围声明

M1 交付「AI 平台地基 + 验证工作台」，不含游戏玩法界面（公司/艺人/通告等属 M2/M3）。
验收基准：在一台无 GPU 的普通电脑上，双击 `start_all.bat` 后 3 秒内打开工作台；
配好 key 的能力可在工作台产出真实媒体产物；未配 key 的 Provider 显示「未接入」而非报错。

## 1. 技术形态与目录（路线 A：零构建多模块）

- Node ≥18 原生 `http`，端口 3100，**零 npm dependencies**（内置 fetch；代理走自实现 CONNECT 隧道）。
- 前端为静态 `prototype/`，无打包构建。
- ESM 模块（`"type": "module"`）。

```
Starstudio/
├── start_all.bat              # 启动服务器 + 打开浏览器（OR-1）
├── package.json               # scripts: dev / start / check / smoke / test
├── .env.example / .env        # 全部 Provider key，仅服务端（GW-5、NFR-4）
├── server.js                  # 薄入口：路由表 + 静态文件服务，业务在 src/
├── config/
│   └── ai-providers.json      # capability → provider/model/params/fallback（GW-3）
├── src/
│   ├── gateway/
│   │   ├── gateway.js         # 能力路由解析、跨平台降级链、调用编排（GW-1/GW-4）
│   │   ├── registry.js        # Provider 注册表、配置校验
│   │   ├── jobs.js            # 统一异步 job 队列（GW-6）
│   │   ├── ledger.js          # 用量与成本账本（GW-7）
│   │   ├── costs.js           # 单价表与成本估算（CL-6）
│   │   └── errors.js          # GatewayError 与错误归一化
│   ├── providers/             # 一平台一适配器文件（GW-2）
│   │   ├── anthropic.js
│   │   ├── gemini.js
│   │   ├── dashscope.js
│   │   ├── suno.js
│   │   ├── kling.js
│   │   └── openrouter.js
│   └── lib/
│       ├── http-fetch.js      # 超时/重试/可选 per-provider CONNECT 代理（OR-2）
│       └── files.js           # generated/ 落盘、路径穿越防护（NFR-4）
├── prototype/
│   ├── index.html / app.js / styles.css   # M1 工作台
│   └── generated/             # 媒体产物（gitignore）
├── data/jobs.json             # job 持久化（gitignore）
├── logs/                      # ai-usage.jsonl + 错误日志（gitignore，NFR-3）
├── scripts/smoke.mjs          # OR-3 冒烟
├── test/                      # node:test 纯逻辑单测
└── docs/                      # v3 规格 + 本设计 + 后续实施计划
```

## 2. 能力清单与 M1 适配器范围

M1 注册能力：`chat / content / world / plan / image / video / music / tts / asr`。
`drama-script / storyboard` 预留枚举（M2 注册即可用，网关不需改动）。

首批 6 个适配器（覆盖规格 §2.3 推荐默认路由的首选 + 兜底）：

| 适配器 | 能力 | 形态 |
|---|---|---|
| anthropic | chat / content（预留 drama-script） | 同步 Messages API |
| gemini | 文本 + image（预留 Veo video） | 同步 |
| dashscope | world / plan 文本 + tts（CosyVoice）+ asr（qwen-asr） | 同步为主 |
| suno | music | 提交 + 轮询 |
| kling | video（图生视频、竖屏） | JWT 签名 + 提交 + 轮询 |
| openrouter | chat/content/world/plan + image + video 兜底 | 同步 / 轮询 |

火山 / MiniMax / ElevenLabs / Fal / OpenAI 等备选适配器不进 M1；
GW-2 的验收方式即「新增平台 = 新增一个 `src/providers/*.js` 文件 + 配置，零业务代码改动」。

默认路由（`config/ai-providers.json` 初始值，规格 §2.3）：

```json
{
  "chat":    { "provider": "anthropic",  "model": "claude-sonnet-4-6" },
  "content": { "provider": "anthropic",  "model": "claude-sonnet-4-6",
               "fallback": [{ "provider": "openrouter", "model": "anthropic/claude-sonnet-4-6" }] },
  "world":   { "provider": "dashscope",  "model": "qwen-flash" },
  "plan":    { "provider": "dashscope",  "model": "qwen-flash" },
  "image":   { "provider": "gemini",     "model": "gemini-3-pro-image",
               "fallback": [{ "provider": "openrouter", "model": "google/gemini-3-pro-image-preview" }] },
  "video":   { "provider": "kling",      "model": "kling-v3-std",
               "fallback": [{ "provider": "openrouter", "model": "kwaivgi/kling-v3.0-std" }] },
  "music":   { "provider": "suno",       "model": "v5" },
  "tts":     { "provider": "dashscope",  "model": "cosyvoice-v3" },
  "asr":     { "provider": "dashscope",  "model": "qwen3-asr-flash" }
}
```

（模型 ID 在实施时以各平台现行 API 文档校准；此处为路由结构示例。）

## 3. 适配器协议（GW-2）

每个适配器默认导出：

```js
export default {
  id: 'kling',
  label: 'Kling 官方',
  capabilities: ['video'],
  envKeys: ['KLING_ACCESS_KEY', 'KLING_SECRET_KEY'],
  isConfigured(env) {},                  // envKeys 是否齐备
  async probe(ctx) {},                   // 轻量健康探测 → { ok, latencyMs, detail }
  async invoke(capability, request, ctx) {}, // 归一化请求 → 归一化结果
};
```

- `ctx` 由网关注入：`{ env, fetch(带该 provider 的代理/超时配置), onProgress(stage, pct), signal, logger }`。
- 异步平台（suno/kling）在 `invoke` 内部完成 提交→轮询→下载落盘，经 `onProgress` 汇报阶段；
  对网关而言 invoke 始终是一个 Promise，同步/轮询差异被适配器吸收（GW-6 的「无论底层平台是同步还是轮询式」）。
- 归一化请求/响应（节选）：
  - 文本类：`{ messages, system?, maxTokens?, json? }` → `{ text, usage:{inputTokens,outputTokens} }`
  - image：`{ prompt, refImages?[], aspect? }` → `{ files:[{url,path}], usage:{images} }`
  - video：`{ prompt, imageRef?, aspect:'9:16', durationSec }` → `{ files:[{url,path}], usage:{seconds} }`
  - music：`{ title, stylePrompt, lyrics?, vocalGender?, quality:'draft'|'release' }` → `{ files:[{url,path}], durationSec }`
  - tts：`{ text, voice, format? }` → `{ files:[{url,path}] }`；asr：`{ audio(dataUrl|path) }` → `{ text }`
- 错误统一抛 `GatewayError { code: 'auth'|'quota'|'safety'|'timeout'|'network'|'bad_request'|'provider_error'|'unconfigured', providerId, retriable, hint, cause }`。
  `auth/bad_request/safety/unconfigured` 不降级；`quota/timeout/network/provider_error` 触发降级链。
  API 层另有 `confirm_required`（见 §6 成本闸门），不属于 GatewayError。

## 4. 网关核心（gateway.js）

- `resolveRoute(capability)`：读配置缓存 → `[primary, ...fallback]`；过滤掉未配置 key 的 provider（若全部未配置，返回结构化「未接入」错误，HTTP 200 + `{ error: { code: 'unconfigured' } }`，绝不 500）。
- `execute(capability, request)`：逐个尝试链上 provider；仅 retriable 错误降级（GW-4）；
  每次尝试（无论成败）写账本（GW-7）；全链失败返回聚合错误：每环节 `providerId + code + hint`（AI-4）。
- 重媒体能力（video/music）不直接 execute，由 `jobs.submit` 包装执行（见 §5）。
- 配置热加载：`PUT /api/config` 写盘并刷新内存缓存，立即生效（GW-3 加分项）。

## 5. 异步 job 队列（GW-6）

- `submit(capability, request, { confirm, estimate }) → { jobId }`。
- job 结构：`{ id, capability, providerChain, stage, progress, status:'queued'|'running'|'done'|'failed'|'interrupted', result?, error?, costEstimate, costActual, createdAt, updatedAt }`。
- 持久化 `data/jobs.json`（写盘节流 ≤1 次/秒）；重启恢复：`running` 的 job 若适配器暴露 `resume(taskRef)` 则续轮询，否则置 `interrupted` 可一键重试。
- 并发上限默认 2（env 可调），超出排队，防止刷爆平台配额。
- `GET /api/jobs`、`GET /api/jobs/:id` 供前端 2s 轮询（SSE 留 M4）。

## 6. 成本闸门、账本、健康面板

### 成本（CL-6 / AI-3）
- `costs.js`：每 provider/model 单价表（常量 + `config` 可覆盖），按 usage 维度（tokens/张/秒/首）估算。
- `POST /api/estimate { capability, request }` → `{ estimatedUsd, breakdown }`。
- 重媒体 `submit` 必须带 `confirm: true`，否则返回 `{ error: { code: 'confirm_required', estimate } }`。

### 账本（GW-7 / NFR-3）
- `logs/ai-usage.jsonl` 逐行追加：
  `{ ts, capability, provider, model, jobId?, durationMs, usage, estUsd, ok, errorCode? }`。
- `GET /api/usage?period=week` → 按能力/Provider 聚合 + 文本类周累计；
  文本周成本 ≥ $1.6（红线 $2 的 80%）时 UI 预警。
- 失败调用同时落 `logs/ai-errors.jsonl`（含 requestId、provider 原始错误摘要）。

### 健康面板（CL-5 / NFR-2）
- `GET /api/health`：每 provider `{ state: 'online'|'error'|'unconfigured', latencyMs, lastCheck, capabilities }`。
- 服务端启动即探测一次，之后每 60s 后台刷新缓存；探测并行、单 provider 超时 5s；
  接口即时返回缓存 + `?refresh=1` 强制重探，满足「10s 内反映状态」。
- probe 取各平台最轻量的鉴权调用（如模型列表/余额接口），不产生生成费用。

## 7. HTTP API（M1 端点清单）

| 端点 | 说明 |
|---|---|
| `POST /api/ai/chat` `/content` `/world` `/plan` | 同步文本（M1 一次性返回；流式留 M4） |
| `POST /api/ai/image` | 同步图像（NFR-1：≤60s） |
| `POST /api/ai/video` `/music` | 提交 job（需 confirm） |
| `POST /api/ai/tts` `/asr` | 同步；tts 文本 >1000 字符时拒绝并提示走 job（M1 工作台限制在 1000 字内） |
| `GET /api/health` | 三态健康（§6） |
| `GET /api/jobs` `GET /api/jobs/:id` | job 查询 |
| `POST /api/estimate` | 成本预估 |
| `GET /api/usage` | 账本聚合 |
| `GET /api/config` `PUT /api/config` | 路由配置读写（热生效；不含 key） |
| `GET /api/config/keys` `POST /api/config/keys` | key 状态（仅已配/未配 + 尾 4 位）与后台录入 |

- key 录入：`POST /api/config/keys` 服务端写入 `.env`；响应与 GET 均**永不回显完整 key**。
- 静态服务：`prototype/` 与 `generated/`；全部响应 `Cache-Control: no-store`；路径穿越防护（NFR-4）。
- 请求体上限：普通 1MB，含媒体 dataUrl 的（asr/图生视频参考图）32MB。

## 8. M1 工作台前端（prototype/）

单页静态应用（原生 JS，无框架）：

1. **健康面板**（顶部常驻）：每 Provider 三态徽标 + 延迟 + 手动刷新。
2. **能力测试台**（卡片）：聊天、图像（prompt + 可选参考图）、音乐（蓝图表单）、
   视频（参考图 + prompt + 竖屏 9:16）、TTS / ASR。每张卡显示当前路由的 provider/model。
3. **生成确认**：重媒体卡片提交前弹出成本预估确认（CL-6）。
4. **job 列表**：阶段、进度条、产物内联预览/播放、失败原因 + 重试。
5. **成本面板**：本周用量聚合、文本红线预警。
6. **设置页**：路由配置编辑（下拉选 provider/model + fallback 排序，PUT 热生效）；
   key 录入（输入即提交，显示尾 4 位）。

## 9. 验证策略（OR-3）

- `npm run check`：`node --check` 全部 js/mjs。
- `npm run test`：`node --test` 纯逻辑单测——costs 估算、config 校验、错误归一化、
  路由解析/降级链选择、job 状态机（适配器网络层 mock）。
- `npm run smoke`：拉起服务器 → `/api/health`、`/api/config`、全部文本端点、estimate、usage →
  未配 key 的能力必须返回结构化「未接入」（绝不 500）→ 已配 key 的 provider 做真实连通探测。
- 手动验收：配 key 后工作台逐能力出真实产物；`start_all.bat` 双击 3 秒可玩。

## 10. 安全与日志（NFR-3 / NFR-4）

- key 仅存服务端 `.env`，`.gitignore` 排除 `.env / logs / data / prototype/generated`。
- 浏览器可见错误 = 用户可读消息 + 错误码；完整细节（provider 原始响应、requestId）仅入 logs/。
- 代理：仅当某 provider 配置了 `proxy` 字段时，该 provider 的请求走 CONNECT 隧道（OR-2）。

## 11. 实施顺序（供 writing-plans 展开）

1. 仓库骨架：package.json、server.js 路由壳、静态服务、start_all.bat、check/smoke 脚手架。
2. 网关核心：errors → registry/config 校验 → gateway 路由与降级链（含单测）。
3. 账本与成本：ledger、costs、estimate/usage 端点（含单测）。
4. 文本适配器：anthropic → dashscope → openrouter；文本四端点贯通 + smoke。
5. 健康面板：probe 协议、/api/health、前端健康组件。
6. 图像：gemini image + openrouter 兜底，工作台图像卡。
7. job 队列：jobs.js 状态机 + 持久化恢复（含单测）。
8. 重媒体适配器:suno（music）、kling（video）+ 工作台对应卡片与确认弹窗。
9. tts/asr（dashscope）。
10. 设置页（路由编辑 + key 后台录入）。
11. 全量 smoke + 手动验收 + README。
