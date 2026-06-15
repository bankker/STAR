# AI Star Studio v3 — 虚拟艺人专业创作工作室

先用对话访谈「捏」出一个虚拟艺人，再用**专业制片级**的工作流为 ta 持续产出作品：陪伴对话、写真/视频、音乐、访谈成片、对口型深度访谈、竖屏短剧。所有内容由真实云端 AI 生成，不是占位素材。

> 注：这是一款**纯创作工具**（非经营模拟游戏）。早期 PRD 里的资金/行动点/世界引擎等经营玩法已全部移除。

---

## 1. 运行要求

- **Node.js ≥ 18**（零 npm 依赖，无需 `npm install`，无 GPU 要求）
- **ffmpeg**（**视频/访谈/短剧成片必需**，纯 CPU）：
  - Windows：`winget install Gyan.FFmpeg`（程序会自动从 PATH / winget 安装目录探测）
  - macOS：`brew install ffmpeg`
  - 不装 ffmpeg 时纯文本/出图能力照常用，但任何成片端点会返回「未检测到 ffmpeg」
- 操作系统：Windows 10/11、macOS 13+
- 一个或多个 AI 平台的 API key（见 §3）

---

## 2. 快速开始

```bash
# 启动服务器（默认端口 3100，可用 PORT=xxxx 覆盖）
npm run dev

# 浏览器打开工作台
#   http://localhost:3100
```

- **零 key 也能启动**：服务器正常运行，未配置的能力返回结构化 `unconfigured` 错误，不崩溃。
- API key 在工作台「**设置**」页在线录入即可（写入服务端 `.env`，**无需重启**，永不回显完整 key）。
- **深度访谈的麦克风录音需要 `localhost` 或 HTTPS** —— 用 `http://localhost:3100` 浏览器才会弹麦克风授权。

---

## 3. 配置 API Key 与区域说明

在「设置」页录入你拥有的平台 key。本项目实测的**区域可用**组合（作者所在区经 OpenRouter 对 Anthropic/Google 部分模型地理封锁）：

| 用途 | 实际走的 Provider / 模型 | 说明 |
|---|---|---|
| 文本（chat/content/提纲/剧本） | **DeepSeek**（经 OpenRouter）兜底 | Claude 首选但该区被封时自动降级到 DeepSeek，中文创作好 |
| 出图（写真/分镜/形象） | **通义万相** `wan2.2-t2i-flash`（DashScope） | 区域内实测可出图 |
| 锁脸（短剧跨镜一致） | **通义万相** `wanx2.1-imageedit`（图像参考） | 探针验证在区可用 |
| 图生视频 | **通义万相** `wan2.2-i2v-flash` | 以写真为首帧，竖屏 |
| 配音 TTS | **通义千问** `qwen-tts` | 多音色 |
| 语音转写 ASR | **通义千问** `qwen3-asr-flash` | 接受 base64 音频 |
| 对口型说话头 | **通义万相** `liveportrait` | 照片+音频→唇形同步视频 |
| 音乐 | **通义** `fun-music-v1` | ⚠️ 需在阿里云百炼模型广场**账户侧开通**才能真出歌（否则 403） |

**只配一个 `DASHSCOPE_API_KEY`（阿里云百炼）即可解锁绝大多数能力**（出图/视频/配音/转写/对口型/锁脸）；文本另配 `OPENROUTER_API_KEY` 走 DeepSeek。

> 路由可在「设置」页或 `config/ai-providers.json` 改（热生效）。每个能力支持 `fallback` 降级链。

---

## 4. 工作台与生产线

左侧导航在同一页面内切换（单页应用）。需先**选/建一个艺人**，各生产线都挂在艺人下。

### 4.1 艺人创设（S1）
对话式访谈「捏人」→ AI 生成完整艺人档案（人设/声线/视觉/性格）→ 出定妆照集（**一致性参考包**，后续所有作品复用同一张脸/声线）。

### 4.2 对话陪伴（E1）
Character.AI 级 in-character 对话室：永不出戏、近期原文 + 滚动摘要长期记忆、情绪/亲密度演化、逐字流式。

### 4.3 写真 / 视频（E2）
- **写真**：锁脸文生图，落入画廊资产库（可收藏/删除）。
- **视频**：以写真为首帧的图生视频（竖屏），走异步 job 队列 + 成本闸门，成片自动入画廊。

### 4.4 音乐工坊（E3）
两段式：先生成**可编辑作曲蓝图**（确认前可改/重抽）→ 渲染成曲入作品库。作品可当短剧主题曲（见 §4.8）。

### 4.5 访谈成片（E4）
AI 写好双方逐字稿 → 逐句 TTS → ffmpeg 拼接静帧成片 + 字幕。脚本化、快速。

### 4.6 🎙️ 深度访谈（S7，真人语音 + 对口型）
真人嘉宾的**实时**访谈，完整管线：
1. **加嘉宾**（商业精英）：填姓名/头衔/公司/人设，形象**上传真照**或 **AI 生成**。
2. **AI 提纲**：针对嘉宾背景生成专业访谈大纲（开场白 + 问题）。
3. **实时访谈室**：艺人 TTS 念出问题 → 你点 🎤 用**电脑麦克风录音回答** → 自动转写（ffmpeg 转码 + ASR）→ AI 顺着你的回答**追问**，循环到结束。
4. **整理双方文字记录**。
5. **语音对谈记录**：双方用干净 AI 音色重新配音，拼成一段音频。
6. **对口型影像**：逐轮用 `liveportrait` 把照片+该轮音频合成**带唇形的说话头**（主持用艺人脸、嘉宾用嘉宾脸），拼接成访谈影像。
> 出对口型影像前，主持人(艺人)与嘉宾都要先有一张形象照；该步有成本确认闸门。

### 4.7 🎞️ 短剧工坊（E5）
多集竖屏短剧，7 阶段管线：立项 → AI 剧本(选角+分集+场景) → 选角定妆 → 分镜(可单格重抽/版本回退) → 出片 → 成片 → 连播合集。
- **两档出片**：高质量（逐镜真实万相 i2v）/ 低成本（ffmpeg 静帧 Ken-Burns 运镜）。
- **真·跨镜锁脸**（万相图像参考）、多角色配音、分镜/定妆照版本管理、批量成本闸门。

### 4.8 跨线复用
- **主题曲接音乐工坊**：短剧每集可挂一首作品库的歌，成片时作为低音量背景 BGM 垫在对白下。
- **定妆照接写真库**：短剧配角/主演、访谈嘉宾的形象都可**从写真库挑现成图**复用（不重复出图、零成本）。

### 4.9 系统页
能力健康面板（在线/故障/未接入三态）、本周 AI 成本账本、设置（路由热改 + key 录入）、设计系统预览。

---

## 5. 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` / `npm start` | 启动服务器（默认 3100，`PORT=xxxx` 覆盖） |
| `npm run check` | 语法门禁——检查所有 .js/.mjs 可解析（当前 60 项，CI 必跑） |
| `npm test` | 单元测试（`node --test`，当前 113 项） |
| `npm run smoke` | 端到端冒烟（发布门槛，当前 44 项，会真打文本/出图等已配置能力） |

---

## 6. 架构概览

「零构建多模块」：Node 原生 http + 静态前端 + 分层后端。

```
浏览器（prototype/ 静态前端）
        │  fetch / SSE
        ▼
server.js ──→ src/api/routes.js（所有 HTTP 端点）
                    │
        ┌───────────┼─────────────────────┐
        ▼           ▼                     ▼
  src/studio/   src/gateway/          src/lib/
  业务编排       能力网关               工具层
  ·artists      ·gateway(路由执行)     ·ffmpeg(转码/拼接/字幕)
  ·companion    ·registry(注册表)      ·files(落盘/dataUrl/路径保护)
  ·assets(画廊) ·jobs(异步队列)        ·env / paths / http-fetch
  ·music        ·health(三态探测)
  ·drama(短剧)  ·ledger(用量账本)
  ·guests       ·costs(成本估算)
  ·interview2          │
  ·session-store       ▼
                src/providers/（适配器，一平台一文件）
                anthropic·dashscope·gemini·openrouter·kling·suno
```

**能力网关（GW）**：所有 AI 调用按「能力」路由（`chat/content/image/video/music/tts/asr/lipsync/...`），每个能力独立配置 provider+model+降级链；新增平台 = 加一个适配器文件，零业务改动。重媒体（视频/音乐/对口型）走统一异步 job 队列（提交即返回 jobId、阶段进度、持久化、重启恢复）。

### 目录结构
| 路径 | 说明 |
|---|---|
| `server.js` | HTTP 入口、路由注册、静态文件服务 |
| `src/bootstrap.js` | 启动序列：注册 Provider、加载配置、初始化账本/job/各 store |
| `src/api/routes.js` | 所有端点处理逻辑 |
| `src/gateway/` | 网关核心（gateway/registry/jobs/health/ledger/costs/errors） |
| `src/providers/` | 平台适配器 + index.js |
| `src/studio/` | 业务编排：artists/companion/assets/music/drama/drama-store/guests/session-store/interview2/... |
| `src/lib/` | 工具：ffmpeg/files/env/paths/http-fetch |
| `config/ai-providers.json` | 路由与成本配置（热生效） |
| `prototype/` | 前端工作台（纯静态，无构建） |
| `prototype/generated/` | 生成的图片/音频/视频产物（gitignored） |
| `test/` · `scripts/` | 单测 · check/smoke 脚本 |
| `data/` · `logs/` | job/艺人/会话持久化 · 用量日志（gitignored） |
| `docs/superpowers/` | 各里程碑的设计 spec 与实现计划 |

---

## 7. 新增一个 Provider

新增平台 = 新增一个适配器文件，零业务代码改动：

```js
const adapter = {
  id: 'myprovider',
  label: '平台显示名',
  capabilities: ['chat', 'image'],     // 支持的能力
  envKeys: ['MYPROVIDER_API_KEY'],
  isConfigured: (env) => Boolean(env.MYPROVIDER_API_KEY),
  async probe(ctx) { /* 轻量健康探测，5s 内 */ return { ok: true }; },
  async invoke(capability, request, ctx) {
    // request 含 messages/prompt/text/audio/imageRef 等（按能力）
    // ctx.env 读环境变量；ctx.fetchJson/fetchBuffer 发 HTTP；ctx.saveFile 落盘
    return { text: '...', usage: { inputTokens: 0, outputTokens: 0 } };
  },
};
export default adapter;
```

在 `src/providers/index.js` 注册，在 `config/ai-providers.json` 对应能力引用 `"provider": "myprovider"` 即可。

---

## 8. 安全与成本

- **Key 安全**：仅存服务端 `.env`（gitignored），不入库、不回显完整值（`/api/config/keys` 只返回末四位）。**绝不代用户在任何输入框填 key**。
- **成本闸门**：视频/音乐/对口型/短剧出片等高额生成提交前需 `confirm: true`，否则返回 `confirm_required` + 成本预估。
- **文本周成本红线**：`/api/usage` 在周文本成本达 $1.6 时 `textWarn: true`（上限 $2）。
- **路径穿越保护**：静态服务经 `safeJoin` 拦截 `../`；上传/录音落盘用服务端随机文件名。
- **内容安全**：全部 SFW；不生成真实公众人物（上传照片由用户负责合规）。
- **全量调用日志**：每次 AI 调用追加 `logs/ai-usage.jsonl`（时间/能力/provider/token/成本）。

---

## 9. 里程碑（均已交付并合并）

M1 能力网关 → S1 艺人创设 → S2 对话室 → P1 设计对齐 → P2 写真 → P2b 视频 → S4 音乐 → S5 访谈 → S6 短剧 → 跨线复用 → S7 深度访谈。

各里程碑的设计 spec 与实现计划见 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`。
```
基线：check 60 · test 113 · smoke 44 全绿
```
