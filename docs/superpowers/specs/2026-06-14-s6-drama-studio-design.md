# S6 短剧工坊设计（E5 · 最后一条生产线）

状态：已批准范围「完整选角版」，待用户复核本 spec。
日期：2026-06-14
依赖：S1（艺人 + 一致性参考包）、S3（万相文生图 image）、S5（ffmpeg + compose SSE 脊柱）。

## 1. 目标与范围

为艺人产出**一集竖屏短剧（9:16，约 60–120s）**，主演为该艺人，含 **AI 生成的配角**（人设 + 定妆照 + 独立配音音色），端到端在本机可验收。

管线（5 个用户可见阶段）：

```
立项  →  剧本     →  选角(定妆)        →  分镜          →  成片
题材/  分场景结构化   AI 生成配角人设+    每场景一张 9:16   逐场景: 静帧 Ken-Burns
时长/  JSON(可编辑)   定妆照(成本闸门)    分镜图(成本闸门,  + 多角色台词 TTS
主演                                    可单格重抽)       + 字幕 → concat → 单集 MP4 → 入画廊
```

### 范围内（MVP）
- 单集、5–8 场景。
- 主演 = 当前艺人（用其一致性参考包的外观/声线描述）。
- 配角：AI 从剧本生成 0–3 个，每个有人设（名字/角色/外观/声线性别）+ 一张定妆照。
- 渲染档：**低成本静帧 + ffmpeg `zoompan`（Ken-Burns 运镜）+ 配音 + 字幕**。这是 S5 compose 脊柱的多场景扩展，已验证、便宜、本机可跑。
- 多角色配音：每个角色（含旁白）映射一个 qwen-tts 音色。
- 成本闸门：选角出图、分镜出图两处批量预估 + confirm。
- 短剧项目持久化，断点续作（可改剧本/重抽分镜后再成片）。

### 非目标（fast-follow，不在本里程碑）
- **高质量档**（每镜真实万相 i2v 片段，走 job 队列）：同一管线上的渲染开关，骨架验收后再加。
- **多集连播**与整剧批量成本闸门。
- **像素级锁脸**（见 §3）。
- 任何经营/发行/世界引擎反馈（产品早已砍掉经营模拟）。
- 配角同框多脸像素级一致。

## 2. 数据模型

短剧项目一文件一项目，存于 `data/dramas/<dramaId>.json`（沿用 `assets.js` 的 per-file + 原子 tmp→rename 风格）。`listDramas(artistId)` 扫描目录按 artistId 过滤。

```jsonc
{
  "id": "dr_<ts>_<rand>",
  "artistId": "art_...",
  "schemaVersion": 1,
  "createdAt": "...", "updatedAt": "...",
  "status": "drafting | cast_ready | storyboard_ready | composing | done",
  "brief": { "theme": "题材一句话", "logline": "一句梗概", "durationSec": 90 },
  "cast": [
    { "id":"c_lead", "name":"艺人名", "role":"主演", "isLead":true,
      "appearance":"外观描述", "voice":"Cherry", "portraitUrl":"/generated/..." },
    { "id":"c_1", "name":"...", "role":"反派", "isLead":false,
      "appearance":"...", "voice":"Ethan", "portraitUrl":"/generated/..." }
  ],
  "scenes": [
    { "id":"s_1", "index":1, "setting":"场景设定/镜头描述",
      "action":"动作/情绪", "lines":[ {"characterId":"c_lead","text":"台词","emotion":"冷峻"} ],
      "frameUrl":"/generated/...", "frameStatus":"empty|ready" }
  ],
  "episodeUrl": null, "durationSec": null
}
```

主演 `c_lead` 的 portraitUrl 直接取艺人一致性包首图（不重复出图）；只有非主演配角需要新生成定妆照。

## 3. 一致性策略（如实）

**当前 t2i 适配器（`dashscope.invokeImage`）只发 `{prompt}`，忽略 `refImages`** —— 即 S3 写真今天的「锁脸」本质是**把统一外观描述写进提示词**，不是像素级图像参考。S6 沿用同一现实：

- 主演外观描述来自艺人档案（`visualIdentity` / `appearance`），注入每张含主演的分镜图提示词。
- 配角外观描述由剧本生成阶段产出（写入 `cast[].appearance`），先生成定妆照锚定该描述，再注入其出镜场景的分镜图提示词。
- 同框多角色：分镜图提示词描述全部出镜角色的外观，但**不承诺像素级同脸**。这是低成本档的已知局限，spec 明示。
- 像素级锁脸（refImage / 万相图像参考模型）= fast-follow，需扩 t2i 适配器，不在 MVP。

## 4. 模块与端点

### 4.1 纯函数 `src/studio/drama.js`
- `buildScriptMessages(artist, brief)` → 让 content 模型产出 `{cast, scenes}` 结构化 JSON（主演已知，只生成配角；场景含 setting/action/lines）。
- `extractScript(text)` → 解析 + 校验 `{cast[], scenes[]}`（容错围栏、取首个 `{...}`、字段裁剪、上限）。
- `buildCastPortraitPrompt(artist, castMember)` → 配角定妆照提示词（9:16 半身、人设外观、SFW）。
- `buildScenePrompt(artist, scene, cast)` → 场景分镜图提示词（出镜角色外观 + setting + action，竖屏电影感）。
- `assignVoices(cast, artist)` → 角色→qwen-tts 音色映射（主演按性别 Cherry/Ethan；配角按性别在 {Cherry,Ethan,Chelsie,Serena} 轮转去重；旁白固定一个）。已验证音色：Cherry/Ethan/Chelsie（S5 用过），其余实现时对 qwen-tts 音色表校准。
- 上限常量：配角 ≤3、场景 ≤8、单场景台词 ≤6 行、单行 ≤200 字（成本/时长护栏）。

### 4.2 持久化 `src/studio/drama-store.js`
`initDrama(dir)` / `createDrama(artistId, brief, parsed)` / `getDrama(id)` / `listDramas(artistId)` / `updateDrama(id, patch)` / `updateScene(id, sceneId, patch)`。原子写，`SAFE_ID` 校验，沿用 assets.js 风格。`paths.js` 加 `DRAMA_DIR`，`bootstrap.js` 调 `initDrama`。

### 4.3 端点（`src/api/routes.js`）
- `POST /api/artist/:id/drama/script` — content 出 `{cast,scenes}` → createDrama → 返回项目。
- `GET  /api/artist/:id/dramas` / `GET /api/artist/:id/drama/:did` — 列表 / 详情。
- `PUT  /api/artist/:id/drama/:did` — 保存编辑后的 brief/cast/scenes（成片前可改）。
- `POST /api/artist/:id/drama/:did/cast`（SSE 或同步批量）— 估算 N 配角出图成本；`confirm!==true` 回 `confirm_required`+estimate；确认后逐个生成配角定妆照、写回 cast、入画廊 `type:'photo'`（标 source 短剧选角）。主演不出图。
- `POST /api/artist/:id/drama/:did/storyboard`（SSE）— 估算 M 场景出图成本 + 成本闸门；确认后逐场景生成分镜图、写回 `scenes[].frameUrl`、SSE 进度。
- `POST /api/artist/:id/drama/:did/scene/:sid/reframe` — 单格重抽该场景分镜图（成本=1 张，确认后直接出）。
- `POST /api/artist/:id/drama/:did/compose`（SSE，脊柱来自 S5 compose）— 守卫：drama 存在、ffmpeg 可用、每场景有 frameUrl、台词非空、上限校验。流程：
  1. 逐场景逐行 `execute('tts',{text, voice=该角色音色})` → 落盘 → `probeDurationSec`，同时按全集累计时间收集所有行用于一份整集 srt。
  2. 每场景：`zoompan` Ken-Burns 把该场景分镜图渲成与该场景音频（该场景各行 concat）等长的静帧视频片段（720x1280，libx264，yuv420p）。
  3. ffmpeg concat 各场景片段（重编码，参照 S5 PCM→mp3 教训：必要处重编码而非 `-c copy`）→ 整集无字幕视频。
  4. 用 `buildSrt`（全集累计时间）生成一份整集 srt，`subtitles` 滤镜一次性烧录进整集视频 → 单集 MP4（与 S5「最后一次性烧字幕」一致，避免逐段时间偏移）。
  5. `addAssets(type:'drama', url, durationSec, title=brief.logline)`；`updateDrama(status:'done', episodeUrl, durationSec)`。
  6. 临时文件用 `os.tmpdir()`；ffmpeg stderr 不泄漏给客户端（沿用 S5 加固）。

成本闸门统一走 `/api/estimate` 风格：image 能力按张估，confirm 模式与现有 `handleMediaSubmit` 一致的 `confirm_required` 协议（这里是同进程批量，沿用同样的返回结构）。

## 5. 前端（`prototype/`）

短剧工坊视图，对齐设计 brief：左侧 stepper（立项→剧本→选角→分镜→成片），主区随阶段切换：
- 立项：题材/时长/梗概表单。
- 剧本：cast 卡片 + scenes 列表（可编辑文本，保存走 PUT）。
- 选角：配角卡片（定妆照缩略 + 重抽），主演卡片只读引用一致性包；批量出图前弹成本预估确认。
- 分镜：场景分镜图网格，单格「重抽」按钮；批量出图前成本预估确认。
- 成片：SSE 进度（配音 x/N → 场景片段 → 拼接 → 完成），完成后竖屏播放器 + 入画廊提示。
画廊新增 `type:'drama'` 瓦片（竖屏视频缩略，复用视频瓦片样式）。

## 6. 测试与验收

- 单测：`drama.js` 纯函数（extractScript 容错/上限、assignVoices 去重、prompt 构造）。
- 冒烟新增守卫：script 未知艺人→not_found；compose 无场景/无 frame→bad_request；storyboard 未确认→confirm_required。
- 端到端实测（本机，真实能力）：跑一集小短剧（主演 + 1 配角，3–4 场景），产出真实单集 MP4，确认入画廊、断点续作（改一行台词后重成片）可用。
- 绿线门槛：`npm run check` / `npm test` / `npm run smoke` 全过。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 配角同框不同脸（无像素锁脸） | spec 明示为低成本档局限；分镜尽量单角色主体、同框用文字描述；fast-follow 接图像参考。 |
| 批量出图慢（M 场景 × 轮询） | SSE 实时进度；场景 ≤8 上限；失败单格可重抽不重跑整批。 |
| compose 长耗时（多场景 TTS+ffmpeg） | SSE 心跳 + 阶段进度；ffmpeg 超时参数；台词/场景上限护栏。 |
| ffmpeg concat 容器/编码坑 | 复用 S5 教训：跨片段拼接处重编码而非 `-c copy`。 |
| 成本失控 | 两处批量成本闸门 + 全程上限常量（配角/场景/台词）。 |

## 8. 任务切分（交 writing-plans 细化）
1. `drama.js` 纯函数 + 单测。
2. `drama-store.js` 持久化 + paths/bootstrap 接线。
3. 端点：script / 列表详情 / PUT 编辑。
4. 端点：cast 选角出图（成本闸门）。
5. 端点：storyboard 分镜出图（成本闸门）+ scene reframe。
6. 端点：compose 成片 SSE（脊柱）+ 入画廊。
7. 前端短剧工坊视图 + 画廊 drama 瓦片。
8. 冒烟守卫 + 端到端实测 + 验收合并。
