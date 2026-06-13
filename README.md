# AI Star Studio v3

玩家经营 AI 娱乐公司，艺人的歌曲、写真、视频、访谈、短剧由真实 AI 云端生产。

M1 能力网关设计文档：[docs/superpowers/specs/2026-06-13-m1-capability-gateway-design.md](docs/superpowers/specs/2026-06-13-m1-capability-gateway-design.md)

---

## 运行要求

- Node.js ≥ 18（无需安装任何额外依赖，无 GPU 要求）
- 操作系统：Windows 10/11、macOS 13+
- 磁盘：约 50 MB（不含生成产物）

---

## 快速开始

```bash
# 1. 复制示例环境文件（也可跳过此步，先零 key 启动）
cp .env.example .env

# 2. 启动服务器（Windows 双击 start_all.bat 效果相同）
npm run dev

# 3. 浏览器打开工作台
#    http://127.0.0.1:3100
```

零 key 启动时服务器正常运行，所有能力端点返回结构化的 `unconfigured` 错误，不会崩溃。  
API key 可在服务器启动后通过工作台「设置」页在线录入，无需重启。

---

## M1 工作台能做什么

| 功能 | 说明 |
|------|------|
| 六能力卡 | 聊天 / 图像 / 视频 / 音乐 / 配音（TTS）/ 转写（ASR）——每张卡对应一个真实 AI 端点 |
| Provider 健康面板 | 实时显示六个平台的在线 / 故障 / 未接入三态，支持手动刷新 |
| 生成任务列表 | 视频与音乐为异步 job，列表展示进度、当前状态与成本 |
| 本周 AI 成本账本 | 自动聚合最近 7 天的调用成本，超预算阈值（$1.6/$2.0）时高亮提示 |
| 设置页 | 路由热改（切换 provider/model 无需重启）+ API key 录入（仅存服务端 .env） |

---

## 能力路由配置

路由由 `config/ai-providers.json` 驱动，每个能力一个条目：

```json
{
  "chat": { "provider": "anthropic", "model": "claude-sonnet-4-6" },
  "image": {
    "provider": "gemini", "model": "gemini-3-pro-image",
    "fallback": [{ "provider": "openrouter", "model": "google/gemini-3-pro-image" }]
  }
}
```

字段说明：

- `provider`：首选 Provider ID（须已在 `src/providers/index.js` 注册）
- `model`：传给 Provider 的模型标识
- `fallback`（可选）：有序降级链，主链全部 retriable 失败时依次尝试
- `params`（可选）：透传给 `invoke` 的附加参数（如 temperature、aspect 等）

顶层 `providers.<id>` 可追加 `{ proxy, timeoutMs }` 覆盖单平台网络配置；`costs` 节可覆盖默认单价。

### 当前默认路由

| 能力 | 首选 Provider | 降级 |
|------|--------------|------|
| chat | anthropic（Claude） | — |
| content | anthropic（Claude） | openrouter |
| world | dashscope（Qwen） | — |
| plan | dashscope（Qwen） | — |
| image | gemini | openrouter |
| video | kling | — |
| music | suno | — |
| tts | dashscope | — |
| asr | dashscope | — |

修改 `config/ai-providers.json` 后重启生效；也可在工作台「设置」页实时修改（调用 `PUT /api/config`）。

---

## 命令

| 命令 | 作用 |
|------|------|
| `npm run dev` / `npm start` | 启动服务器（默认端口 3100，可用 `PORT=xxxx` 覆盖） |
| `npm run check` | 语法门禁——检查所有 .js 文件可解析（CI 必跑） |
| `npm test` | 单元测试（`node --test test/*.test.js`），当前 49 项 |
| `npm run smoke` | 端到端冒烟测试（OR-3 发布门槛），需在无正在运行的 3199 端口时执行 |

---

## 目录结构

| 路径 | 说明 |
|------|------|
| `server.js` | HTTP 服务器入口，路由注册与静态文件服务 |
| `src/bootstrap.js` | 应用启动序列——注册 Provider、加载配置、初始化账本与 job 队列 |
| `src/gateway/` | 网关核心：gateway.js（路由执行）、registry.js（注册表）、health.js（健康探测）、jobs.js（异步 job 队列）、ledger.js（用量账本）、costs.js（成本估算）、errors.js（GatewayError） |
| `src/providers/` | 六个平台适配器：anthropic / dashscope / gemini / openrouter / kling / suno + index.js |
| `src/lib/` | 工具层：env.js（.env 读写）、files.js（safeJoin 路径保护）、http-fetch.js（HTTP 客户端，支持 proxy）、paths.js（全局路径常量） |
| `src/api/routes.js` | 所有 HTTP 端点的处理逻辑 |
| `config/` | `ai-providers.json`——路由与成本覆盖配置 |
| `prototype/` | 前端工作台（纯静态 HTML/CSS/JS，无构建步骤） |
| `test/` | 单元测试（Node.js 内置 `node:test`） |
| `scripts/` | 工具脚本：check.mjs（语法检查）、smoke.mjs（冒烟测试） |
| `logs/` | `ai-usage.jsonl`——运行时调用记录（gitignored） |
| `data/` | `jobs.json`——job 持久化（gitignored） |

---

## 新增一个 Provider

新增平台 = 新增一个适配器文件，零业务代码改动（设计原则 GW-2）。

适配器需实现以下五个要素：

```js
export default {
  id: 'myprovider',                   // 唯一标识，与 config 路由中的 provider 字段对应
  label: '平台显示名',
  capabilities: ['chat', 'content'],  // 该平台支持的能力列表
  envKeys: ['MYPROVIDER_API_KEY'],    // 需要的环境变量名
  isConfigured: (env) => Boolean(env.MYPROVIDER_API_KEY),

  // 健康探测（轻量请求，5 秒内返回）
  async probe(ctx) {
    await ctx.fetchJson('https://api.myprovider.com/ping', { headers: { ... } });
    return { ok: true };
  },

  // 能力调用
  async invoke(capability, request, ctx) {
    // request 包含 messages / prompt / text / audio 等，由能力类型决定
    // ctx.env 访问环境变量；ctx.fetchJson / ctx.fetchBuffer 发 HTTP
    return { text: '...', usage: { inputTokens: 0, outputTokens: 0 } };
  },
};
```

然后在 `src/providers/index.js` 的 `ADAPTERS` 数组中加入该适配器，在 `config/ai-providers.json` 的相应能力条目中引用 `"provider": "myprovider"` 即可。

---

## 安全与成本

- **Key 安全**：API key 仅存于服务端 `.env`（已 gitignore），不入版本库，不经由任何端点回显完整值（`/api/config/keys` 只返回末四位 tail）。
- **媒体成本确认闸门**：视频、音乐提交前必须附带 `confirm: true`，否则返回 `confirm_required` 并附成本预估，防止误触高额生成。
- **文本周成本红线**：账本端点 `/api/usage` 在周文本成本达 $1.6 时返回 `textWarn: true`（上限 $2），供前端显示警告。
- **全量调用日志**：每次 AI 调用均追加至 `logs/ai-usage.jsonl`，包含时间戳、能力、provider、token 用量与成本。
- **路径穿越保护**：静态文件服务通过 `safeJoin` 阻止 `../` 路径穿越攻击，越界请求返回 404。
