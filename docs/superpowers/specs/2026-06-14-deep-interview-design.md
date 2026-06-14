# 深度访谈（实时录音 + 对口型影像）设计 — S7

状态：范围与节奏（一份 spec / 分两阶段）已与用户确认。能力探针已通过。待用户复核本 spec。
日期：2026-06-14
依赖：S1（艺人=主持人）、S3（写真出图，嘉宾 AI 形象）、S5（访谈拼接脊柱）、能力网关 + job 队列 + ffmpeg。

把访谈从 S5 的「AI 脚本静帧」升级为**真人嘉宾实时语音问答 + 对口型成片**。

## 0. 探针已验证事实（2026-06-14，本机 DASHSCOPE_KEY 在区）
- **ASR**：`qwen3-asr-flash` 真实转写中文，**接受 base64 dataUrl**（也接受公网 URL），现有 `invokeAsr` 适配器可用，无需账户开通/图床。
- **对口型**：DashScope **`liveportrait`**（端点 `…/aigc/image2video/video-synthesis`，async 提交+轮询 `tasks/{id}`，`input:{image_url, audio_url}`）端到端产出真实唇形同步 MP4，**接受 base64**（本机照片+音频直接传，无需公网托管/账户开通）。EMO 路径被账户 async 限制挡住、videoretalk 不适用 → **统一用 liveportrait**。

## 1. 目标与范围

主持人=当前艺人；嘉宾=用户添加的「商业精英」。一场访谈：选嘉宾 → AI 高质量提纲 → **实时逐轮**（艺人 TTS 提问 → 浏览器麦克风录音 → ffmpeg 转码 → ASR 转写 → AI 追问）→ 双方文字记录 → AI 语音对谈记录 → 对口型访谈影像。

**两阶段实现（一份 spec）：**
- **Phase A 互动访谈核心**：嘉宾实体（上传/AI 形象 + 音色）、AI 提纲、实时录音/ASR/追问循环、双方文字记录。独立验收：真跑完一场语音问答、出文字稿。
- **Phase B 成片**：AI 语音对谈记录（双方 TTS 重配音拼接）、对口型访谈影像（liveportrait 逐轮说话头 + 拼接，成本闸门 + job 异步）、入画廊。

### 非目标
- 真实公众人物 / 非 SFW（AI-6 红线）：上传照片由用户负责合规，AI 形象一律虚拟。
- 多人（>1 嘉宾）同场、实时视频通话。
- 嘉宾真实声音克隆（嘉宾用 qwen-tts 现成音色）。
- EMO/情绪夸张数字人（用 liveportrait 标准唇形）。

## 2. 新能力：`lipsync`

网关新增能力 `lipsync`（image+audio→对口型视频）：
- `config/ai-providers.json` 加 `"lipsync": { "provider": "dashscope", "model": "liveportrait" }`。
- `registry.js` CAPABILITIES 加 `'lipsync'`；`dashscope.js` capabilities 加 `'lipsync'` + `invokeLipsync(request, ctx)`：async 提交 `image2video/video-synthesis`（`input:{image_url: request.imageRef, audio_url: request.audioRef}`，二者均 base64 dataUrl）→ 复用 i2v 同款轮询（`tasks/{id}`，VID_POLL/MAX）→ 下载 mp4。
- `costs.js` 加 `lipsync` 估算：`dashscope:liveportrait` 按 `perSecond`（接入时校准，暂 0.15/s）× `durationSec`。
- `lipsync` 走 M1 job 队列（异步 + 进度 + 重启恢复），与 i2v 一致。

## 3. 音频管线：mic → ASR

- 浏览器 `MediaRecorder` 产出 webm/opus；上传 base64 → 服务端 ffmpeg 转码为 wav（16k mono）→ base64 → `execute('asr',{audio})`。
- `src/lib/ffmpeg.js` 加 `transcodeToWav(srcAbs, destAbs)`：`runFfmpeg(['-y','-i',src,'-ar','16000','-ac','1',dest])`（ffmpeg gyan 构建支持 opus 解码）。
- ASR 端点已存在（`/api/ai/asr`）；深度访谈的 answer 端点内部：落盘 webm → 转 wav → 读 base64 → ASR → 得文字。

## 4. 数据模型

### 4.1 嘉宾 `src/studio/guests.js`（per-file `data/guests/<id>.json`，mirror drama-store）
```jsonc
{ "id":"gst_<ts>_<rand>", "artistId":"art_...", "schemaVersion":1, "createdAt","updatedAt",
  "name":"嘉宾名", "title":"头衔", "company":"公司", "persona":"人设/背景一段", "voice":"Ethan",
  "portrait": { "current":0, "versions":[ {"url":"/generated/...","prompt":"","createdAt":""} ] } }
```
方法：`initGuests/createGuest/getGuest/listGuests(artistId)/updateGuest/addGuestPortrait(id,{url,prompt})/deleteGuest`。形象两路：AI 出图（execute('image')）或上传（前端转 base64 → 落盘 → addGuestPortrait）。

### 4.2 访谈会话 `src/studio/session-store.js`（per-file `data/interviews/<id>.json`）
```jsonc
{ "id":"itv_<ts>_<rand>", "artistId":"art_...", "guestId":"gst_...", "schemaVersion":1,
  "createdAt","updatedAt", "status":"outlining|interviewing|done",
  "outline": { "opening":"开场白", "questions":["问题1", ...] },
  "cursor": 0,                       // 已问到第几个 outline 问题
  "turns": [ {"id","speaker":"host|guest","text":"","audioUrl":null,"lipsyncUrl":null} ],
  "recordUrl": null,                 // Phase B：AI 语音对谈记录
  "videoUrl": null }                 // Phase B：对口型访谈影像
```
方法：`initSessions/createSession/getSession/listSessions(artistId)/appendTurn(id,turn)/updateSession(id,patch)/setTurnMedia(id,turnId,patch)`。

## 5. 纯函数 `src/studio/interview2.js`
- `buildOutlineMessages(artist, guest)` → content 产出 `{opening, questions:[6-10 个]}`，对标专业财经访谈（贴合嘉宾头衔/公司/人设，有深度、有钩子，SFW）。
- `extractOutline(text)` → 解析 + 上限裁剪（questions ≤10）。
- `buildNextQuestionMessages(artist, guest, outline, turns)` → 让主持人「顺着上一条回答追问 或 推进到下一个大纲问题」，输出一句口语化提问；传入已问 cursor 与最近若干轮。
- `assignGuestVoice(guest)` → 按性别给 qwen-tts 音色（与艺人音色避免雷同；主持固定用艺人音色）。
- 上限常量：`MAX_QUESTIONS=10`、`MAX_TURNS=24`、`MAX_ANSWER_SEC=120`。

## 6. 端点（`src/api/routes.js`）

### Phase A
- 嘉宾 CRUD：`POST/GET /api/artist/:id/guests`、`GET/PUT/DELETE /api/artist/:id/guest/:gid`。
- 嘉宾形象：`POST /api/artist/:id/guest/:gid/portrait`（body `{mode:'ai'|'upload', prompt?, dataUrl?}`：ai→execute('image')；upload→落盘 dataUrl）→ addGuestPortrait，入画廊 `type:'photo'`。
- 建会话：`POST /api/artist/:id/interview2` body `{guestId}` → content 生成 outline → createSession（status outlining→interviewing）→ 返回 session。
- 提问（主持轮）：`POST /api/artist/:id/interview2/:sid/ask` → `buildNextQuestionMessages` 出下一问（首轮=opening）→ `execute('tts',{text,voice=艺人音色})` 落盘 → appendTurn(host, text, audioUrl) → 推进 cursor → 返回 `{turn}`（前端播放该音频）。
- 回答（嘉宾轮）：`POST /api/artist/:id/interview2/:sid/answer` body `{audio: <base64 webm/wav>}` → 落盘 → transcodeToWav → ASR 转写 → appendTurn(guest, text, 转写所用 wav 的 url) → 返回 `{turn}`。守卫 MAX_TURNS。
- 结束：`POST /api/artist/:id/interview2/:sid/end` → status='done'。
- 详情/列表：`GET /api/artist/:id/interviews`、`GET /api/artist/:id/interview2/:sid`。

### Phase B
- 语音对谈记录：`POST /api/artist/:id/interview2/:sid/record` → 逐轮 `execute('tts',{text, voice= host?艺人音色 : 嘉宾音色})` → 落盘各轮 audioUrl（写回 turn）→ ffmpeg concat（libmp3lame 重编码，S5 教训）→ 整篇 mp3 → `recordUrl`，入画廊 `type:'interview'`（音频）。SSE 进度。
- 对口型影像：`POST /api/artist/:id/interview2/:sid/video`（SSE）— 成本闸门（整场 = turns 数 × liveportrait 单价，confirm）。逐轮：取该轮 audio（Phase B record 的 TTS 产物）+ 说话人照片（host=艺人定妆照首图，guest=嘉宾 portrait 当前版本）→ base64 → `submitJob('lipsync',{imageRef,audioRef,durationSec})`（不带 artistId 防污染画廊）→ waitJob → 得对口型片段，写回 turn.lipsyncUrl → ffmpeg concat 全轮（统一重编码 720x1280/yuv420p/aac）→ `videoUrl`，入画廊 `type:'interview'`。临时文件 os.tmpdir，stderr 不外泄（S5/S6 加固）。依赖：需先有 record（各轮 TTS 音频）。

## 7. 前端（`prototype/`）

新「深度访谈」视图（左导航新增；或在访谈成片旁并列）：
- **嘉宾管理**：嘉宾卡列表 + 新建（姓名/头衔/公司/人设）+ 形象（AI 出图 或 上传图片）。
- **提纲**：建会话后展示开场白 + 问题清单（只读，可重生成）。
- **实时访谈室**（核心）：
  - 「开始/下一问」→ 调 ask → 自动播放主持 TTS 音频；展示问题文字。
  - 🎤「回答」按钮：`getUserMedia` + `MediaRecorder` 录音；再点停止 → 上传 base64 → answer → 转写文字落入记录面板。
  - 记录面板：双方轮次气泡（主持/嘉宾不同色），实时增长。
  - 「结束访谈」。
  - 录音权限失败/不支持的兜底提示。
- **成片**（Phase B）：「生成语音对谈记录」→ 播放器；「生成对口型影像」→ 成本确认 + SSE 进度 + 竖屏播放器 + 入画廊。
- 复用设计 tokens；画廊 `type:'interview'` 瓦片已存在（S5）。

## 8. 测试与验收
- 单测：`guests`（CRUD/版本）、`session-store`（appendTurn/cursor/setTurnMedia）、`interview2`（extractOutline 上限、next-question 构造、assignGuestVoice）。
- 冒烟守卫：建会话未知艺人→not_found；ask/answer 未知会话→not_found；video 无 record→bad_request；超 MAX_TURNS→bad_request。
- 端到端实测（本机真实）：
  - Phase A：建嘉宾（AI 形象）→ 建会话出提纲 → ask（真 TTS 出题）→ 用一段真实音频走 answer（真 ASR 转写）→ 跑 2-3 轮 → 文字记录正确成型。
  - Phase B：record（双方重配音 mp3 真出）→ video（≥2 轮 liveportrait 真对口型片段 + 拼接，ffprobe 确认音视频流）→ 入画廊；肉眼确认唇形对得上（探针注记的最终质量确认）。
- 绿线门槛：`npm run check` / `npm test` / `npm run smoke` 全过。

## 9. 风险与缓解
| 风险 | 缓解 |
|---|---|
| liveportrait 慢 + 花钱（逐轮） | job 队列异步 + SSE；video 前整场成本闸门；MAX_TURNS 封顶；验收用 2-3 轮小规模真跑。 |
| 浏览器麦克风权限/格式差异 | getUserMedia 失败兜底提示；统一上传 webm→服务端 ffmpeg 转 wav→ASR（不依赖浏览器出 wav）。 |
| ASR 误识别长答 | MAX_ANSWER_SEC 限长；转写文字可在记录面板编辑（PUT 修正）后再成片。 |
| liveportrait 对非正脸/AI 图效果差 | 嘉宾/艺人用正脸半身定妆照；探针已确认 base64 正脸可出片；质量在 Phase B 验收时肉眼确认。 |
| 实时录音音质影响 ASR | 仅用真实录音做「转写取词」；最终语音/影像统一用干净 AI 音色（record 的 TTS 产物）。 |
| 成本失控 | video 成本闸门 + MAX_TURNS/MAX_QUESTIONS 上限。 |

## 10. 任务切分（交 writing-plans 细化）
**Phase A**
1. 能力 `lipsync` 适配器 + 配置 + 估算 + 注册（先接好，Phase B 用）。
2. `guests.js` store + 单测；`session-store.js` + 单测；接线 paths/bootstrap。
3. `interview2.js` 纯函数 + 单测。
4. `ffmpeg.transcodeToWav` + 端点：嘉宾 CRUD + 形象（AI/上传）。
5. 端点：建会话(出提纲) + ask(TTS 出题) + answer(录音→转码→ASR) + end + 列表/详情。
6. 前端：嘉宾管理 + 提纲 + 实时访谈室（麦克风录音 + 记录面板）。
7. Phase A 冒烟守卫 + 端到端（真语音问答出文字稿）。

**Phase B**
8. 端点：record（双方重配音 concat）SSE。
9. 端点：video（逐轮 liveportrait job + 拼接）SSE + 成本闸门。
10. 前端：成片区（记录播放 + 对口型影像 + 成本确认 + SSE）。
11. Phase B 冒烟守卫 + 端到端（record + 对口型 video 真出）+ 验收合并。
