# S6 短剧工坊设计（E5 · 最后一条生产线 · 专业成品）

状态：范围 = 完整选角 + 专业成品（非 MVP）。待用户复核本 spec。
日期：2026-06-14
依赖：S1（艺人 + 一致性参考包）、S3（万相 image t2i）、P2b（万相 i2v 已验证）、S5（ffmpeg + compose SSE 脊柱 + job 队列）。
对标 v3 五大横切专业标准：PS-1 一致性参考包 / PS-2 分阶段可控 / PS-3 资产版本管理 / PS-4 质量档位+成本闸门 / PS-5 异步进度。

## 1. 目标与范围（专业成品）

专业级竖屏短剧工坊：以艺人为主演，AI 生成配角，产出**多集**竖屏短剧，逐集完整管线 + 多集**连播合集**。

完整管线（每集）：

```
立项 → 分集剧本 → 选角定妆 → 分镜(版本) → 出片 → 配音+字幕 → 单集成片
                                          ├ 高质量: 逐镜真实万相 i2v 片段(job 队列, 默认)
                                          └ 低成本: 分镜图静帧 Ken-Burns 运镜
多集 → 连播合集(ffmpeg concat + 集间卡)
```

### 范围内
- **多集短剧项目**：一个 drama 项目含 `episodes[]`，每集独立成片；可只做 1 集，也可连载。
- **主演** = 当前艺人（一致性参考包外观/声线）。**配角** AI 生成（人设 + 定妆照 + 独立音色），单集 ≤4 角色（含主演）。
- **两档出片（PS-4）**：
  - 高质量（默认）：每场景分镜图 → 万相 i2v 竖屏片段（走 M1 job 队列），承接首帧人物形象。
  - 低成本：每场景分镜图 → ffmpeg `zoompan` Ken-Burns 静帧片段。视频用量降 ~80%。
- **一致性（PS-1，尽力真锁脸）**：
  - i2v 以该场景分镜图为首帧 → 片段内人物形象锁定（已验证能力）。
  - 跨镜锁脸：**升级 t2i 走万相图像参考**，主演锚定一致性包定妆照、配角锚定其定妆照。**此能力在区可用性未验证 → 实现首任务做探针**；不可用则降级为「统一外观描述注入」并在 UI/日志标注。
- **资产版本管理（PS-3）**：分镜单格重抽、配角定妆照重抽均保留历史版本数组 + 当前版本指针，可回退。
- **多角色配音**：每角色（含旁白）映射独立 qwen-tts 音色。
- **成本闸门（PS-4）**：选角出图、分镜出图、每集出片（按档计 i2v 用量）三处批量预估 + confirm；连播免费（纯 ffmpeg）。
- **异步进度（PS-5）**：i2v 片段走 job 队列（jobId/阶段/持久化/重启恢复）；成片编排走 SSE 聚合各 job + ffmpeg 阶段。
- **断点续作（DR-5）**：项目全状态持久化，剧本/选角/分镜/已成片各集均可中断后续作。

### 非目标
- 真实公众人物 / 非 SFW（AI-6 红线）。
- 任何经营 / 发行 / 世界引擎反馈（产品已砍经营模拟）。
- 实时协作 / 多用户。
- 自训练音色克隆（用 qwen-tts 现成音色库）。

## 2. 数据模型

一项目一文件 `data/dramas/<dramaId>.json`（沿用 `assets.js` per-file + 原子 tmp→rename + `SAFE_ID`）。`listDramas(artistId)` 扫描目录过滤。

```jsonc
{
  "id": "dr_<ts>_<rand>", "artistId": "art_...", "schemaVersion": 1,
  "createdAt": "...", "updatedAt": "...",
  "title": "剧名", "theme": "题材", "logline": "一句梗概",
  "status": "drafting | cast_ready | episode_in_progress | done",
  "consistencyMode": "image_ref | description",   // 由探针结果决定
  "cast": [
    { "id":"c_lead", "name":"艺人名", "role":"主演", "isLead":true, "appearance":"外观描述",
      "voice":"Cherry",
      "portrait": { "current": 0, "versions": [ {"url":"/generated/...","prompt":"...","createdAt":"..."} ] } },
    { "id":"c_1", "name":"...", "role":"反派", "isLead":false, "appearance":"...", "voice":"Ethan",
      "portrait": { "current": 0, "versions": [ ... ] } }
  ],
  "episodes": [
    { "id":"ep_1", "index":1, "title":"第一集", "durationSec": null, "episodeUrl": null,
      "tier": "high | low",
      "scenes": [
        { "id":"s_1", "index":1, "setting":"镜头/场景", "action":"动作/情绪",
          "characterIds":["c_lead"],
          "lines":[ {"characterId":"c_lead","text":"台词","emotion":"冷峻"} ],
          "frame": { "current":0, "versions":[ {"url":"/generated/...","prompt":"...","createdAt":"..."} ] },
          "clip": { "url": null, "jobId": null, "status": "none|queued|running|ready|failed" } }
      ] }
  ],
  "collectionUrl": null   // 连播合集
}
```

主演 `c_lead.portrait` 直接引用艺人一致性包首图（不重复出图）。

## 3. 一致性策略（PS-1，如实 + 探针决定）

**现状**：`dashscope.invokeImage` 当前只发 `{prompt}`、忽略 `refImages` → S3 写真今天的一致性是「外观描述注入」级。

**成品目标**：跨镜真锁脸。**实现首任务做能力探针**——确认万相在该区是否有可用的「图像参考 / 图生图保人物」模型（候选：wanx 图像编辑 / 参考生图 / 通用图像参考类）。
- 探针成功 → 升级 `invokeImage`：带 refImages 时切到图像参考模型，`consistencyMode='image_ref'`；主演/配角的定妆照作为参考锁脸。
- 探针失败（在区不可用 / 权限不足）→ `consistencyMode='description'`，沿用描述注入，UI 明示「当前为描述级一致性」。
- 无论哪种：**高质量 i2v 片段内一致性已由首帧保证**（P2b 验证过）；探针只影响跨镜分镜图的锁脸强度。

探针结论（2026-06-14）：image_ref，工作模型=wanx2.1-imageedit（function:description_edit），端点=/api/v1/services/aigc/image2image/image-synthesis（异步提交→轮询 TASKS/{id}→SUCCEEDED 返图，base_image_url 接受 base64 dataUrl）。`invokeImage` 带 refImages 时切此模型保人物锁脸，consistencyMode='image_ref'。

## 4. 模块与端点

### 4.1 纯函数 `src/studio/drama.js`
- `buildScriptMessages(artist, brief)` → content 产出 `{cast, episodes:[{scenes}]}`（主演已知只生成配角；场景含 setting/action/characterIds/lines/emotion）。
- `extractScript(text)` → 解析 + 校验 + 上限裁剪（配角 ≤3、单集场景 ≤8、单场景台词 ≤6、单行 ≤200 字）。
- `buildCastPortraitPrompt(artist, castMember)` / `buildScenePrompt(artist, scene, cast, consistencyMode)` → 出图提示词（含出镜角色外观，竖屏电影感，SFW）。
- `buildI2vPrompt(scene)` → i2v 运镜/动作提示词。
- `assignVoices(cast, artist)` → 角色→qwen-tts 音色（主演按性别 Cherry/Ethan；配角去重轮转 {Cherry,Ethan,Chelsie,Serena}；旁白固定）。已验证音色 Cherry/Ethan/Chelsie；其余实现时对音色表校准。
- `estimateEpisodeCost(episode, tier)` → 按档估算（高质量= M 镜 i2v；低成本=0 视频）。

### 4.2 持久化 `src/studio/drama-store.js`
`initDrama(dir)` / `createDrama` / `getDrama` / `listDramas(artistId)` / `updateDrama` / `updateCast` / `updateScene` / `addFrameVersion` / `setFrameCurrent` / `addPortraitVersion`。原子写。`paths.js` 加 `DRAMA_DIR`，`bootstrap.js` 调 `initDrama`。

### 4.3 适配器升级 `src/providers/dashscope.js`
- `invokeImage` 支持 refImages：探针确定的图像参考模型；无 refImages 时维持现有 t2i 行为（向后兼容 S3）。
- 配置 `config/ai-providers.json` 视探针结果增减 image 参考模型项。

### 4.4 端点（`src/api/routes.js`）
- `POST /api/artist/:id/drama/script` — 出 `{cast,episodes}` → createDrama → 返回项目。
- `GET  /api/artist/:id/dramas` · `GET /api/artist/:id/drama/:did` — 列表 / 详情。
- `PUT  /api/artist/:id/drama/:did` — 保存编辑后的 brief/cast/episodes（出片前可改）。
- `POST /api/artist/:id/drama/:did/cast`（SSE）— 成本闸门 → 逐配角生成定妆照（写入 portrait.versions）、入画廊 `type:'photo'`。主演不出图。
- `POST /api/artist/:id/drama/:did/episode/:eid/storyboard`（SSE）— 成本闸门 → 逐场景出分镜图（写入 frame.versions）。
- `POST /api/artist/:id/drama/:did/episode/:eid/scene/:sid/reframe` — 单格重抽（追加 frame 版本，可回退）。
- `POST /api/artist/:id/drama/:did/episode/:eid/compose`（SSE，脊柱来自 S5）— 守卫（drama/episode 存在、ffmpeg 可用、每场景有 frame、台词非空、上限）。流程：
  1. **高质量档**：逐场景以分镜图为首帧 `submitJob('video', {imageRef, prompt})` → 轮询 job 进度（SSE 转发）→ 收齐各场景片段。**低成本档**：逐场景 `zoompan` Ken-Burns 渲静帧片段。
  2. 逐场景逐行 `execute('tts',{text, voice})` → 落盘 → `probeDurationSec`，按全集累计时间收集整集 srt。
  3. 把每场景视频片段对齐该场景配音时长（高质量 i2v 片段定长，配音不足补静帧/超出截断到镜时长；低成本片段直接等长渲染）。
  4. ffmpeg concat 各场景片段 + 对应音轨（必要处重编码，参照 S5 PCM→mp3 教训）→ 整集无字幕视频。
  5. 用 `buildSrt`（全集累计时间）一次性 `subtitles` 烧录 → 单集 MP4。
  6. `addAssets(type:'drama', url, durationSec, title)`；`updateDrama` 写 episode.episodeUrl/durationSec/status。
  7. 临时文件 `os.tmpdir()`；ffmpeg stderr 不泄漏客户端（S5 加固）。
- `POST /api/artist/:id/drama/:did/collection` — ffmpeg concat 全部已成片集 → 连播合集 `collectionUrl`，入画廊 `type:'drama'`。

成本闸门沿用现有 `confirm_required`+estimate 协议（同进程批量，返回结构一致）。

## 5. 前端（`prototype/`）

短剧工坊视图，对齐设计 brief（7 阶段 stepper：立项→剧本→选角→分镜→出片档位→成片→连播）：
- 立项：剧名/题材/梗概/集数表单。
- 剧本：cast 卡片 + 分集 scenes 列表（可编辑，保存走 PUT）。
- 选角：配角卡片（定妆照 + 重抽 + 版本切换），主演只读引用一致性包；批量出图成本预估确认；若 `consistencyMode='description'` 顶部提示一致性档位。
- 分镜：按集场景分镜图网格，单格「重抽」+ 版本切换；批量成本预估确认。
- 出片：每集选档位（高质量/低成本）+ 整集成本预估；SSE 进度（高质量含各镜 i2v job 进度聚合）。
- 成片：竖屏播放器 + 入画廊；多集列表 + 「生成连播合集」。
画廊新增 `type:'drama'` 瓦片（竖屏视频，复用视频瓦片样式）。

## 6. 测试与验收

- 单测：`drama.js`（extractScript 容错/上限、assignVoices 去重、estimateEpisodeCost 两档、prompt 构造）；`drama-store.js`（版本增改、current 指针、listDramas 过滤）。
- 冒烟新增守卫：script 未知艺人→not_found；storyboard 未确认→confirm_required；compose 无场景/无 frame→bad_request；collection 无已成片集→bad_request。
- 端到端实测（本机真实能力，控成本的小规模验证）：
  - 高质量档：1 集 × 主演+1 配角 × 3 场景 → 真实逐镜 i2v（3 job）→ 真实单集 MP4，入画廊。
  - 低成本档：同剧本走静帧 Ken-Burns，产出单集 MP4。
  - 连播：2 集 concat 出合集。
  - 断点续作：改一行台词后重成片可用；分镜单格重抽 + 版本回退可用。
  - 一致性探针结论记录（image_ref 或 description）。
- 绿线门槛：`npm run check` / `npm test` / `npm run smoke` 全过。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 跨镜真锁脸依赖万相图像参考模型，在区可用性未验证 | 实现首任务探针；不可用则降级描述级并明示；i2v 片段内一致性已验证兜底。 |
| 高质量逐镜 i2v 慢 + 真金白银（$0.3–1.5/镜） | 走 job 队列异步 + SSE 进度；出片前整集成本闸门；验收用小规模真跑（3 镜）。 |
| 多 job 编排失败/部分成功 | 单镜 job 失败可单独重试（复用 retryJob）；compose 聚合等待并报告失败镜，不毁整集。 |
| ffmpeg concat（i2v 片段异源参数）容器/编码坑 | 拼接处统一重编码到固定规格（720x1280/yuv420p/aac）。 |
| 配角同框多脸一致难 | 分镜尽量单主体；同框文字描述；image_ref 模式下逐角色锚定主体。 |
| 成本失控 | 三处批量成本闸门 + 上限常量（配角/场景/台词/集数）。 |

## 8. 任务切分（交 writing-plans 细化）
1. **一致性能力探针** + `invokeImage` refImages 升级（决定 `consistencyMode`）。
2. `drama.js` 纯函数 + 单测。
3. `drama-store.js`（多集 + 版本）+ paths/bootstrap 接线 + 单测。
4. 端点：script / 列表详情 / PUT 编辑。
5. 端点：cast 选角出图（成本闸门 + 版本）。
6. 端点：storyboard 分镜出图（成本闸门 + 版本）+ scene reframe。
7. 端点：compose 成片 SSE（两档：i2v job 编排 / Ken-Burns）+ 入画廊。
8. 端点：collection 连播合集。
9. 前端短剧工坊视图（多集 / 档位 / 版本 / 成本闸门 / SSE / 连播）+ 画廊 drama 瓦片。
10. 冒烟守卫 + 端到端实测（两档 + 连播 + 续作）+ 验收合并。
