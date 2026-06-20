# 故事模式（银河史诗 × 恋爱养成）MVP — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`。

**Goal:** 给应用加一个「故事」板块：以**你创建的虚拟艺人**为主演的 2D 银河史诗 × 恋爱养成互动游戏。垂直切片＝**建一局存档 → 把 2~3 个艺人选入剧本（LLM 评定数值）→ 月回合循环 → 视觉小说式事件＋选项（影响好感/数值）→ 一场轻量战法卡战役（确定性结算＋LLM 旁白）→ 结束回合 → 存档可读回**。第一人称无立绘，全 2D 回合制，无 3D、无实时。设计见 `docs/story-mode-design.md`。

**MVP 简化（诚实标注）：**
- 星域用**一个手写小星域**（6 节点，静态布局），不做程序化生成。
- 事件先做「LLM 生成 1 个当前事件 + 玩家选项」，不做完整章节节拍引擎（留 P2）。
- 战役**插画可选**：MVP 先文字旁白 + 复用艺人现有立绘，场景/战役生成图留 P2（成本/复杂度）。
- 战略层只做「派角色领军 + 资源显示」，外交/权谋/舰队编制留 P2。
- 战法环＝**3 张 RPS + 修正**（突击/包抄/诱敌），5 势环留后续。

**Architecture:** 新增 `src/studio/story.js`（纯函数：战役结算、好感、选项效果、提示词构造）+ `src/studio/story-store.js`（一局存档持久化，仿 `drama-store.js`，存 `DATA_DIR/stories`，bootstrap initStory）。端点加在 `src/api/routes.js`：建局/列表/详情/选角(LLM 评定)/事件(LLM 生成)/选择/战役/结束回合。LLM 走 `content` 能力（同步）；战役数值在后端**确定性计算**，LLM 只写旁白。前端在 `prototype/{index.html,claude.js,claude.css}` 加「故事」全画布视图（事件/星图/议事厅/战役/HUD）。**零 npm 依赖。** 复用 `execute('content', …)` 与现有成本闸门。

**通用约定：** 错误 HTTP 200 + `{error}`；测试 `npm test`；检查 `npm run check`；冒烟 `npm run smoke`；前端用 `esc()`；署名 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`；不 push。`DASHSCOPE_API_KEY`（content via qwen-plus）已就绪，可真实验收事件/评定/旁白。

---

## 文件总览
| 文件 | 职责 | 任务 |
|---|---|---|
| `src/studio/story.js` + `test/story.test.js` | 战役结算(3-RPS+修正)、好感、选项效果应用、评定/事件/旁白提示词（纯函数） | 1 |
| `src/studio/story-store.js` + `test/story-store.test.js` + `src/bootstrap.js` | 一局存档 CRUD + 选角 + 持久化 + 接线 | 2 |
| `src/api/routes.js` | 建局/列表/详情/选角(评定)/事件/选择/战役/结束回合 端点 | 3 |
| `prototype/{index.html,claude.js,claude.css}` | 「故事」全画布视图：事件/对话、星图、议事厅、战役、HUD | 4 |
| `scripts/smoke.mjs` + 端到端实测 | 故事端点冒烟守卫 + 真实跑通一局 + 合并 | 5 |

---

### Task 1: 故事纯函数（src/studio/story.js）
**Files:** Create `src/studio/story.js`, `test/story.test.js`

- [ ] **Step 1: 失败测试** — `test/story.test.js`（只测纯逻辑，确定性 rng）：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticCoef, resolveBattle, applyAffinity, affinityStage, applyChoice } from '../src/studio/story.js';

test('tacticCoef：突击克包抄、被诱敌克、平手', () => {
  assert.equal(tacticCoef('突击', '包抄'), 1.5);
  assert.equal(tacticCoef('突击', '诱敌'), 0.7);
  assert.equal(tacticCoef('突击', '突击'), 1.0);
});

test('resolveBattle：确定性 rng 下，克制方胜', () => {
  const A = { troops: 100, morale: 60, commander: { 统率: 70, 谋略: 50, 魅力: 50 }, tactic: '突击' };
  const D = { troops: 100, morale: 60, commander: { 统率: 70, 谋略: 50, 魅力: 50 }, tactic: '包抄' };
  const r = resolveBattle({ attacker: A, defender: D, terrain: '星云', rng: () => 0.5 });
  assert.equal(r.winner, 'attacker');        // 突击克包抄
  assert.ok(r.casualties.defender > r.casualties.attacker);
});

test('applyAffinity 钳制 0–100；阶段划分', () => {
  assert.equal(applyAffinity(95, 10), 100);
  assert.equal(applyAffinity(5, -10), 0);
  assert.equal(affinityStage(85), '交心');
  assert.equal(affinityStage(10), '陌生');
});

test('applyChoice 不可变地施加效果（好感/数值/资源/flag）', () => {
  const story = { cast: [{ artistId: 'a1', affinity: 40, stats: { 统率: 50 } }], player: { resources: { supply: 70, politics: 30, intel: 10 } }, flags: {} };
  const next = applyChoice(story, { effects: { affinity: { a1: 8 }, resource: { politics: 5 }, flag: { 答应林深: true } } });
  assert.equal(next.cast[0].affinity, 48);
  assert.equal(next.player.resources.politics, 35);
  assert.equal(next.flags['答应林深'], true);
  assert.equal(story.cast[0].affinity, 40); // 原对象不变
});
```

- [ ] **Step 2: 确认失败** — `npm test` → FAIL。

- [ ] **Step 3: 实现** — `src/studio/story.js`：
  - `COUNTERS = { 突击:'包抄', 包抄:'诱敌', 诱敌:'突击' }`；`TERRAIN_FAV = { 回廊要塞:'突击', 星云:'包抄', 恒星风:'诱敌' }`。
  - `tacticCoef(mine, theirs)`：克 1.5 / 被克 0.7 / 平 1.0。
  - `resolveBattle({attacker,defender,terrain,rng=Math.random})`：
    `power(s,foe) = troops × tacticCoef(s.tactic,foe) × (0.7+统率/100×0.6) × (TERRAIN_FAV==s.tactic?1.2:1) × (0.8+morale/100×0.4) × (0.9+rng()×0.2)`；
    比较得 winner；`ratio=min/max`；`casualties` 败方更高；返回 `{winner,powerA,powerD,casualties,moraleShift,territory}`（数字 `Math.round`）。
  - `applyAffinity(cur,delta)` 钳制；`affinityStage(v)`：≥80 交心 / ≥50 信赖 / ≥20 相识 / else 陌生。
  - `applyChoice(story, choice)`：深拷贝后施加 `effects.{affinity{id:Δ}, stat{id:{k:Δ}}, resource{k:Δ}, flag{k:v}}`，返回新 story。
  - 提示词构造（纯函数，给 Task 3 用）：`buildAppraiseMessages(artist)`（依人设/魅力/背景评定 统率/谋略/政务/魅力/忠诚 0–100，要求只回 JSON）；`buildEventMessages(story, focusArtist)`（当前局势+角色生成 1 个场景 + 2~3 选项，回 JSON）；`buildBattleNarration(result, ctx)`（依结算结果写旁白）。
  - 导出一个手写小星域种子 `SEED_SECTOR`（6 节点 + 航路 + 地形）与 `newStory(player)`。

- [ ] **Step 4: 通过** — `npm test` → PASS。

---

### Task 2: 存档持久化 + 选角（src/studio/story-store.js）
**Files:** Create `src/studio/story-store.js`, `test/story-store.test.js`；编辑 `src/bootstrap.js`、`src/lib/paths.js`（加 `STORIES_DIR`）

- [ ] **Step 1: 失败测试** — `test/story-store.test.js`（用临时 `DATA_DIR`，**绝不动真实 data/**）：建局→存→列→读→加艺人入局（带评定后的数值）→改→读回一致。
- [ ] **Step 2: 确认失败** → FAIL。
- [ ] **Step 3: 实现** — 仿 `drama-store.js`：`initStory(dir)`、`createStory(seed)`、`listStories()`、`getStory(id)`、`saveStory(story)`、`addCast(id, {artistId,role,faction,stats})`、`updateStory(id, patch)`。文件落 `STORIES_DIR=DATA_DIR/stories`。`paths.js` 加 `STORIES_DIR`；`bootstrap.js` `initStory(STORIES_DIR)`。
- [ ] **Step 4: 通过** → PASS。

---

### Task 3: 端点（src/api/routes.js）
**Files:** 编辑 `src/api/routes.js`

- [ ] **Step 1：建局/列表/详情** — `POST /api/stories`（body: player{name,title,pronoun,faction} → createStory(newStory(...))）；`GET /api/stories`；`GET /api/stories/:id`。
- [ ] **Step 2：选角（LLM 评定）** — `POST /api/stories/:id/cast`（body: {artistId, role, faction}）→ 取艺人档案 → `execute('content', buildAppraiseMessages(artist))` 解析 JSON 数值 → `addCast`。LLM 失败给保底默认值。
- [ ] **Step 3：事件 + 选择** — `POST /api/stories/:id/event`（body: {focusArtistId?}）→ `execute('content', buildEventMessages(...))` → 返回 `{scene, speakerArtistId, lines, choices[]}`（暂存到 story.pendingEvent）。`POST /api/stories/:id/choose`（body: {choiceIndex}）→ `applyChoice` → saveStory → 返回新状态。
- [ ] **Step 4：战役** — `POST /api/stories/:id/battle`（body: {attackerTactic, systemId}）→ 组装两军（含指挥官数值/士气/地形）→ `resolveBattle`（后端 rng）→ `execute('content', buildBattleNarration(...))` 旁白 → 施加损失/领土/并肩好感 → saveStory。
- [ ] **Step 5：结束回合** — `POST /api/stories/:id/end-turn` → turn+1、行动点重置、资源结算、AI 势力简单行动 → saveStory。
- [ ] **验证** — 各端点 `curl` 真跑（DASHSCOPE 已配），错误走 200+{error}。

---

### Task 4: 前端「故事」视图（prototype/）
**Files:** 编辑 `prototype/index.html`、`prototype/claude.js`、`prototype/claude.css`

- [ ] **入口** — 在 composer「＋ 创作」菜单或左栏加「故事」入口；进入后切到**全画布故事视图**（让出聊天框）。
- [ ] **子视图 + HUD**（对齐已通过的招牌界面草图）：
  - 顶栏 HUD：纪元/回合、补给/政治/情报、战役临近、结束回合。
  - **事件/对话**（主）：场景区（背景占位/可选生成图）+ 角色立绘（复用艺人写真）+ 对话文本 + 选项按钮（点击 → `/choose`）。
  - **星图**：SVG 6 节点图，势力着色，点节点出详情/派兵。
  - **议事厅**：艺人立绘排布 + 数值 + 好感条 + 派任务。
  - **战役**：两军数值块 + 3 张战法卡（选一张 → `/battle`）+ 结算条 + 旁白。
  - **档案**：角色个人线/好感阶段。
- [ ] **接线** — 复用 `api()`、`esc()`；建局/选角/事件/选择/战役/结束回合 全走新端点；状态本地缓存 + 每步刷新。
- [ ] **验证** — `preview_eval` 跑通：建局→加艺人→出事件→选项→战役→结束回合，DOM 状态正确。

---

### Task 5: 冒烟 + 端到端 + 合并
**Files:** 编辑 `scripts/smoke.mjs`

- [ ] 冒烟覆盖故事端点存在性（建局→详情→结束回合）。
- [ ] **端到端实测**（隔离临时 DATA_DIR）：真实建一局 → 选 2 个艺人（LLM 评定出数值）→ 触发 1 事件、选 1 项（好感变化）→ 跑 1 场战役（克制方胜 + 旁白）→ 结束回合 → 重启读回存档一致。
- [ ] `npm run check` + `npm test` 全绿；走查打磨；提交（不 push）。

---

## 验收标准（MVP Done）
1. 能建一局、把艺人选入剧本并自动得到数值；存档落 `DATA_DIR/stories` 可读回。
2. 月回合循环跑得通：事件→选项→好感/数值变化→战役→结束回合。
3. 战役 3-RPS 克制 + 修正生效，旁白由 LLM 生成，数值确定性可复现（单测覆盖）。
4. 前端故事视图能完整玩通一条最短线，UI 对齐设计草图。
5. 全部单测 + 冒烟通过；不破坏现有写真/视频/音乐/访谈/短剧。
