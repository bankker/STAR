# 故事模式 · 进度/养成骨架 — 实施计划

> 解决"对话空转、战役与对话脱节、数值无意义"。建立完整主轴：**打仗为目标、聊天为变强、变强为打赢、打赢推进到结局**。玩家定位＝崛起的指挥官；恋爱养成核心、银河战争为舞台；**双线结局（军事×关系）**。

## 主轴（三层）
- **推进**：章节目标 + 回合倒计时(deadline) + 敌军每回合推进(威胁时钟) + 章末决战 + 结局。
- **收集**：好感阈值解锁【羁绊技能(战役 buff)】+【个人线剧情】；军衔/声望解锁更多舰队/可带角色/高级战法。
- **提升**：事件/战役给角色经验→数值成长；给玩家声望→军衔。

## 对话↔战役循环
事件养成(好感/数值/资源) → 带更强角色上星图打战役(数值定胜负) → 胜:夺地+声望+并肩好感+推进目标／负:丢地+士气+角色负伤(危机事件) → 战果触发承接事件 → … → 决战 → 结局。

## 数值语义
统率→战力底；谋略→战法效果/解锁高级战法；魅力→好感增速/外交；政务→资源产出；忠诚→发挥&背叛。胜负→领土(资源)、士气、负伤、章节进度。

## 双线结局矩阵
军事达成 × 关系(最高好感≥交心80)：双全 / 孤高的胜利 / 败走亦相守 / 陨落。

## 数据模型增量（story）
- `chapter{ index,title,goalMode:'capture'|'defend',targetSystemId,deadlineTurn,status }`
- `player{ ...,rank,renown }`
- `cast[]{ ...,level,exp,status:'ready'|'wounded',woundedUntil,bondSkill,bondStage }`
- `endings`（章末计算）

## 分期
- **P1 主轴骨架（本轮）**：newStory 加 chapter/rank/renown；纯函数 rankFor / topAffinity / checkChapter / computeEnding / enemyAdvance（+单测）；end-turn 接入(推进+敌军+判定+结局)；battle 给声望并即时判目标；HUD 显示目标+倒计时+军衔/声望；结局界面。
- **P2 养成解锁**：好感阈值→羁绊技能(战役 buff)+个人线标记；角色经验→数值成长；议事厅展示解锁。
- **P3 战役深度**：战力纳入 统率+等级+羁绊技能+士气+战法；负方角色负伤→危机事件；声望→军衔→解锁。
- **P4 多章与结局分支**：章节链、个人线剧情事件、更丰富结局。

## 约定
错误 200+{error}；`npm test`/`npm run check`/`npm run smoke`；署名 Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>；不 push。
