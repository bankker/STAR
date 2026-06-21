# 故事模块重构 · 「星舰炉石」单舰回合制卡牌战斗

> 完全取代旧「5轮对话→战争策略→三格血」循环。战斗内核独立好玩、与叙事解耦。
> 用户定稿战斗 spec（见会话）+ SC2 UI 设计 comps（`docs/sc2-ref/`：战斗界面/出战编成/对话界面/星图）。

## 设计锚（定稿，锁死联动，非必要不动）
舰体 30 / 能量上限 10 / 起手 4 可调度一次 / 过热自伤 1,2,3… / 站场 7（核心 4 + 召唤 3）。来自炉石同一套被验证的数值体系。

## 架构
- **战斗内核 = 确定性纯函数引擎，浏览器端运行**（`prototype/battle/`，ESM；浏览器 `<script type=module>` 加载，Node 单测共用同一文件）。出牌/瞄准零延迟 + 全可单测（无截图时的验证手段）。LLM 只做旁白。
- `engine.js`：`newBattle / startTurn / canPlay / playCard / attack / endTurn / heroPower`，不可变（structuredClone），全部接受/产出 state。
- `cards.js`：~15 张 MVP 卡 + 船员特性模板（`crewFromCast`）+ 敌人/Boss 预设（纯数据）。
- 效果系统：`damage(enemyFace/allEnemyUnits/enemyUnit)` / `armor` / `heal(ship/unit)` / `summon` + `battlecry(战吼)` + `deathrattle(亡语)`。
- 关键词：战吼 / 亡语 / 光环(回合начало治疗) / 嘲讽 / 突袭。
- 负伤≠死亡：核心船员(艺人)血尽=负伤退场(injured/离场，战后恢复，永不永久死)；召唤单位=可摧毁。
- 敌方 AI：先清嘲讽 → 集火最低血船员 → 否则打舰体；Boss 阶段转换留 P3。

## 字体/视觉（按 comps）
Oxanium（显示/拉丁数字）+ Noto Sans SC（中文）。色：青 #5fe6ff、金 #ffd27a(能量/回合)、红 #ff5a3c(敌)、紫 #c07bff(Boss)、底 #03060d。

## 四屏（按 comp 重建）
星图(run) → 对话(好感HUD) → 出战编成(选≤4船员+组牌) → 战斗界面(顶部HUD/敌方区/核心船员区/底部指挥台) → 结算 → 回星图。

## 分期
- **P0 · 战斗内核（已完成）**：引擎全部纯函数 + 25 单测（含真实卡库集成）。`prototype/battle/engine.js`+`cards.js`+`test/battle.test.js`。169/169 绿。
- **P1 · 战斗界面**：四区棋盘按 comp 渲染（Oxanium、能量水晶、手牌、敌/友区、点选出牌瞄准），接客户端引擎 → 真能打一局。换 Rajdhani→Oxanium。
- **P2 · 出战编成**：船员名单/详情/牌库预览 → 选人组牌开战。
- **P3 · 对话 + 星图 + Boss 阶段**：星图节点 + 好感HUD + Boss阶段转换，串成一局 run + LLM 旁白。删除旧 story 玩法代码。

## 接口（养成喂牌库，留待对话系统）
构筑=养成产出；招募船员→特性卡+专属法术；好感/协同以「战斗修正」接入，不改内核可玩性。
