# 跨线复用打通 + 走查打磨 设计（P3-XL）

状态：范围已与用户确认。待用户复核本 spec。
日期：2026-06-14
依赖：S3（写真画廊 type:'photo'）、S4（音乐作品库 type:'song'）、S6（短剧工坊 drama-store/compose）。

把五条生产线从「各自产出」推进到「互相喂料」：音乐工坊的歌当短剧主题曲、写真库的图当短剧定妆照。外加一次跨线走查打磨。

## 1. 目标与范围

### 功能 A — 主题曲接音乐工坊
- 短剧**每集**可**可选**挂一首主题曲（默认无）。用户从该艺人**作品库**（画廊 `type:'song'`）里**手动挑**一首；可清除。
- compose 时若该集挂了主题曲，把它作为**低音量背景 BGM 全程垫在对白下**（ffmpeg `amix`，BGM 压低音量 + 循环/截断到整集时长，对白时长为准）。未挂则维持现状（无 BGM）。
- 依赖：音乐工坊真出歌需用户在阿里云开通 fun-music-v1；功能与混音用任意 song 资产即可验证。

### 功能 B — 定妆照接写真（双向复用）
- 选角阶段，**配角与主演**都可「**从写真库选**」一张已有画廊照片（`type:'photo'`）直接当定妆照/首帧 —— 走 `addPortraitVersion` 写入现成 url，**不出图、不花钱**，并保留版本。
- 反向（配角定妆照 → 写真库）已在 S6 打通（选角出图即 `addAssets type:'photo'`），无需改动。

### C — 走查打磨
跨线一致性走查，把发现的小粗糙随这次修（见 §6）。

### 非目标
- 自动/默认主题曲（用户明确要手动可选）。
- 整剧级单一主题曲（按用户选择做**逐集**）。
- 音乐裁剪/淡入淡出编辑器（仅整段循环垫底 + 固定压低音量）。
- 跨艺人资产复用（仅限当前艺人自己的画廊）。

## 2. 数据模型变更

`drama-store.js` 的 episode 增加一个可空字段：

```jsonc
"episodes": [
  { "id":"ep_1", ..., "tier":"high|low", "themeSongUrl": null, /* 或 "/generated/xxx.mp3" */ ... }
]
```

- `createDrama` 时每集 `themeSongUrl: null`。
- 新增 store 方法 `setEpisodeTheme(id, eid, songUrl)`（找到 episode、写 themeSongUrl、原子写）。
- 配角/主演定妆照复用走**已有** `addPortraitVersion(id, castId, {url, prompt})`，无需新 store 方法。

## 3. 端点（`src/api/routes.js`）

1. `POST /api/artist/:id/drama/:did/episode/:eid/theme` body `{songUrl}`（`songUrl:null` 清除）
   - 守卫：artist+drama+ownership、episode 存在。
   - 校验：非 null 时，`songUrl` 必须是该艺人画廊里 `type==='song'` 的资产 url（用 `getGallery(id)` 校验，防任意/跨艺人引用）。
   - `setEpisodeTheme` → 返回 `{drama}`。

2. `POST /api/artist/:id/drama/:did/cast/:cid/portrait` body `{url}`
   - 守卫：artist+drama+ownership、cast 成员存在（cid 可为 `c_lead` 或配角）。
   - 校验：`url` 必须是该艺人画廊里 `type==='photo'` 的资产 url（写真与配角定妆照都是 photo）。
   - `addPortraitVersion(did, cid, {url, prompt:'写真库复用'})` → 返回 `{drama}`。

3. compose 端点（改造）— 在 concat 出 `merged.mp4`（含对白音轨）后、烧字幕前，若 `ep.themeSongUrl`：
   ```
   ffmpeg -y -i merged.mp4 -stream_loop -1 -i <bgmAbs>
     -filter_complex "[1:a]volume=0.18[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]"
     -map 0:v -map "[a]" -c:v copy -c:a aac merged_bgm.mp4
   ```
   用 `merged_bgm.mp4` 作为烧字幕输入（否则用 `merged.mp4`）。`duration=first` 让混音长度=对白视频长度，`-stream_loop -1` 循环 BGM 覆盖整集，`volume=0.18` 压低背景。BGM 缺失/读取失败则记日志并跳过混音（不毁成片）。

## 4. 前端（`prototype/`）

- **可复用画廊选择器**：一个轻量 modal，传入 `filter('song'|'photo')` 拉 `GET /gallery`、按类型筛选、网格展示、点选回调。歌显示名/时长 + 试听；图显示缩略。
- **选角阶段**：每张 cast 卡（含主演）加「从写真库选」按钮 → 打开 photo 选择器 → 选中 → `POST .../cast/:cid/portrait` → 刷新。主演卡不再是纯只读（保留「一致性包」标识，但可换）。
- **出片阶段**：每集 tier 切换旁加「主题曲」行：显示当前曲名或「无」，「选主题曲」→ song 选择器 → `POST .../episode/:eid/theme`；「清除」→ 同端点传 null。
- 复用既有设计 tokens 与画廊瓦片样式。

## 5. 测试与验收

- 单测：`drama-store` 的 `setEpisodeTheme`（设/清、未知 episode 返回 null）。
- 冒烟守卫：theme 未知艺人→not_found；theme 传非画廊歌→bad_request；cast/portrait 传非画廊图→bad_request。
- 端到端实测（本机）：
  - 放一个 song 资产（若 fun-music 未开通，用一段 TTS/任意 mp3 作 stand-in 入画廊 song），挂为 ep_1 主题曲 → 低成本 compose → ffprobe 确认成片含混音音轨（BGM + 对白），听感对白清晰、背景垫底。
  - 从写真库选一张图当配角定妆照 → 确认 portrait 版本写入且**未触发出图**（成本账本无新增 image）。
  - 主演同样可从写真库换首帧。
- 绿线门槛：`npm run check` / `npm test` / `npm run smoke` 全过。

## 6. 走查打磨清单（随本次一并修，发现即补）

- 选角阶段主演卡由纯只读改为可换（配合功能 B）。
- 画廊选择器复用，避免每处重复写筛选/渲染。
- 主题曲混音失败的健壮性（跳过而非毁片）。
- compose 临时文件命名/清理沿用 S5/S6 既有 `os.tmpdir()` 模式（混音中间产物也在 tmp）。
- 走查中发现的其它小粗糙（命名/空态/错误文案）就近修复，记入提交信息；不做无关大重构。

## 7. 任务切分（交 writing-plans 细化）
1. `drama-store` 加 `themeSongUrl` + `setEpisodeTheme` + 单测。
2. 端点 theme（含画廊校验）+ cast/:cid/portrait（含画廊校验）。
3. compose 混音改造（amix，健壮跳过）。
4. 前端可复用画廊选择器 + 选角「从写真库选」+ 出片「主题曲」。
5. 冒烟守卫 + 端到端实测（混音 + 复用零成本）+ 走查打磨收尾 + 合并。
