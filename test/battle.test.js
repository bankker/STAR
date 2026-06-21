import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBattle, startTurn, canPlay, playCard, attack, endTurn, heroPower } from '../prototype/battle/engine.js';
import { CARDS as LIB, starterDeck, crewFromCast, ENEMIES } from '../prototype/battle/cards.js';

const startTurnTo = (s, turn) => { while (s.turn < turn) s = startTurn(s); return s; };

// ── 测试夹具：确定性 rng + 简单卡库/船员/敌人 ──
const seqRng = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const CARDS = {
  齐射: { id: '齐射', name: '主炮齐射', cost: 3, type: 'spell', effect: { kind: 'damage', amount: 4, target: 'enemyFace' } },
  护盾: { id: '护盾', name: '能量护盾', cost: 2, type: 'spell', effect: { kind: 'armor', amount: 4 } },
  脉冲: { id: '脉冲', name: '脉冲炮', cost: 1, type: 'spell', effect: { kind: 'damage', amount: 3, target: 'enemyFace' } },
  标记弹: { id: '标记弹', name: '标记弹', cost: 1, type: 'spell', effect: { kind: 'mark', target: 'enemyFace' } },
  连携突击: { id: '连携突击', name: '连携突击', cost: 2, type: 'spell', effect: { kind: 'damage', target: 'enemyFace', amount: 1, combo: 4, comboAt: 2 } },
  无人机: { id: '无人机', name: '无人机', cost: 1, type: 'summon', unit: { name: '无人机', atk: 1, hp: 2, keywords: ['嘲讽'] } },
  突击机: { id: '突击机', name: '突击机', cost: 2, type: 'summon', unit: { name: '突击机', atk: 3, hp: 1, keywords: ['突袭'] } },
  炮手: { id: '炮手', name: '炮手无人机', cost: 2, type: 'summon', unit: { name: '炮手', atk: 1, hp: 3 }, battlecry: { kind: 'damage', amount: 2, target: 'enemyFace' } },
  自爆机: { id: '自爆机', name: '自爆无人机', cost: 1, type: 'summon', unit: { name: '自爆机', atk: 1, hp: 1, keywords: ['突袭', '亡语'], deathrattle: { kind: 'damage', amount: 3, target: 'enemyFace' } } },
};
const crewAura = (name, amount) => ({ id: name, name, atk: 0, hp: 4, keywords: ['光环'], aura: { kind: 'heal', amount } });
CARDS.维修 = { id: '维修', name: '紧急维修', cost: 1, type: 'spell', effect: { kind: 'heal', target: 'ship', amount: 5 } };
CARDS.群射 = { id: '群射', name: '导弹群射', cost: 3, type: 'spell', effect: { kind: 'damage', target: 'allEnemyUnits', amount: 2 } };
CARDS.定点 = { id: '定点', name: '定点打击', cost: 2, type: 'spell', effect: { kind: 'damage', target: 'enemyUnit', amount: 4 } };
const deckOf = (n, id) => Array.from({ length: n }, () => id);
const crew = (name, o = {}) => ({ id: name, name, atk: o.atk ?? 2, hp: o.hp ?? 4, keywords: o.keywords || [] });
const enemyOf = (hp, o = {}) => ({ name: o.name || '海盗战舰', hp, atk: o.atk ?? 3, minions: o.minions || [] });
const baseCfg = (o = {}) => ({
  cards: CARDS,
  crew: o.crew || [crew('林'), crew('雪')],
  deck: o.deck || deckOf(20, '齐射'),
  enemy: o.enemy || enemyOf(20),
  rng: o.rng || seqRng([0.5]),
  maxSlots: o.maxSlots,
  terrain: o.terrain,
  relics: o.relics,
});

test('newBattle: 舰体30/能量1·1/核心船员在场/起手手牌/回合1/active', () => {
  const s = newBattle(baseCfg());
  assert.equal(s.turn, 1);
  assert.equal(s.status, 'active');
  assert.equal(s.ship.hp, 30);
  assert.equal(s.ship.maxHp, 30);
  assert.equal(s.energy.max, 1);          // 回合1：上限 0→1
  assert.equal(s.energy.current, 1);      // 回满
  assert.equal(s.board.filter((u) => u.type === 'crew').length, 2); // 船员开局即在战位
  assert.equal(s.hand.length, 5);         // 起手 4 + 回合1摸 1
  assert.equal(s.deck.length, 15);        // 20 - 4 - 1
  assert.equal(s.enemy.hp, 20);
  assert.equal(s.fatigue, 0);
});

test('playCard: 能量不足时不可出牌，状态不变', () => {
  const s = newBattle(baseCfg({ deck: ['齐射', ...deckOf(19, '齐射')] }));
  const card = s.hand[0];                  // 齐射 cost3，回合1能量仅 1
  assert.equal(canPlay(s, card.instanceId), false);
  const s2 = playCard(s, card.instanceId);
  assert.equal(s2.enemy.hp, s.enemy.hp);
  assert.equal(s2.hand.length, s.hand.length);
  assert.equal(s2.energy.current, 1);
});

test('playCard: 脉冲(1费)对敌舰-3、能量-1、离手、原state不变', () => {
  const s = newBattle(baseCfg({ deck: ['脉冲', ...deckOf(19, '齐射')], enemy: enemyOf(20) }));
  const card = s.hand[0];
  assert.equal(card.cardId, '脉冲');
  assert.equal(canPlay(s, card.instanceId), true);
  const s2 = playCard(s, card.instanceId);
  assert.equal(s2.enemy.hp, 17);
  assert.equal(s2.energy.current, 0);
  assert.equal(s2.hand.some((c) => c.instanceId === card.instanceId), false);
  assert.equal(s.enemy.hp, 20);            // 不可变
});

test('playCard: 敌舰血归零 → status=won', () => {
  const s = newBattle(baseCfg({ deck: ['脉冲', ...deckOf(19, '齐射')], enemy: enemyOf(3) }));
  const s2 = playCard(s, s.hand[0].instanceId);
  assert.equal(s2.enemy.hp, 0);
  assert.equal(s2.status, 'won');
});

test('playCard: 护盾(2费)给舰体加护甲', () => {
  let s = newBattle(baseCfg({ deck: ['护盾', ...deckOf(19, '齐射')] }));
  s = startTurnTo(s, 2);                    // 升到回合2，能量 2
  const shield = s.hand.find((c) => c.cardId === '护盾');
  const s2 = playCard(s, shield.instanceId);
  assert.equal(s2.ship.armor, 4);
  assert.equal(s2.energy.current, 0);
});

test('attack: 船员攻击敌舰 → 敌-atk、本回合该单位不可再动', () => {
  const s = newBattle(baseCfg({ crew: [crew('林', { atk: 2, hp: 4 })], enemy: enemyOf(20) }));
  const u = s.board[0];
  assert.equal(u.canAct, true);
  const s2 = attack(s, u.instanceId, 'enemyFace');
  assert.equal(s2.enemy.hp, 18);
  assert.equal(s2.board[0].canAct, false);
});

test('attack: 已行动单位不能再次攻击', () => {
  const s = newBattle(baseCfg({ crew: [crew('林', { atk: 2 })], enemy: enemyOf(20) }));
  const u = s.board[0];
  const s3 = attack(attack(s, u.instanceId, 'enemyFace'), u.instanceId, 'enemyFace');
  assert.equal(s3.enemy.hp, 18);
});

test('attack: 攻击敌方单位 → 互扣，死亡单位移除，不碰脸', () => {
  const s = newBattle(baseCfg({ crew: [crew('林', { atk: 3, hp: 4 })], enemy: enemyOf(20, { minions: [{ name: '僚机', atk: 1, hp: 2 }] }) }));
  const s2 = attack(s, s.board[0].instanceId, s.enemy.board[0].instanceId);
  assert.equal(s2.enemy.board.length, 0);   // 僚机 2hp 受 3 → 摧毁
  assert.equal(s2.board[0].hp, 3);          // 林 4hp 受 1 反击 → 3
  assert.equal(s2.enemy.hp, 20);
});

test('attack: 敌方嘲讽时打脸非法、不消耗行动', () => {
  const s = newBattle(baseCfg({ crew: [crew('林', { atk: 3, hp: 4 })], enemy: enemyOf(20, { minions: [{ name: '护盾僚机', atk: 1, hp: 3, keywords: ['嘲讽'] }] }) }));
  const s2 = attack(s, s.board[0].instanceId, 'enemyFace');
  assert.equal(s2.enemy.hp, 20);
  assert.equal(s2.board[0].canAct, true);
});

test('attack: 船员血归零=负伤退场(injured/离场)；召唤单位=摧毁', () => {
  const s = newBattle(baseCfg({ crew: [crew('林', { atk: 1, hp: 2 })], enemy: enemyOf(20, { minions: [{ name: '重炮', atk: 5, hp: 5 }] }) }));
  const s2 = attack(s, s.board[0].instanceId, s.enemy.board[0].instanceId);
  const linq = s2.board.find((x) => x.id === '林');
  assert.ok(linq, '负伤船员仍保留在 board（送维修舱），不删除');
  assert.equal(linq.injured, true);
  assert.equal(linq.onField, false);
});

test('endTurn: 敌方单位集火最低血船员，随后回到玩家回合(能量+1)', () => {
  const s = newBattle(baseCfg({
    crew: [crew('林', { atk: 1, hp: 5 }), crew('雪', { atk: 1, hp: 2 })],
    enemy: enemyOf(20, { atk: 0, minions: [{ name: '僚机', atk: 2, hp: 3 }] }),
  }));
  const s2 = endTurn(s);
  assert.equal(s2.board.find((u) => u.id === '雪').injured, true);  // 2hp 受 2 → 负伤
  assert.equal(s2.board.find((u) => u.id === '林').hp, 5);          // 未被打
  assert.equal(s2.turn, 2);
  assert.equal(s2.energy.max, 2);
  assert.equal(s2.active, 'player');
});

test('endTurn: 无船员在场时敌方火力打在舰体', () => {
  const s = newBattle(baseCfg({ crew: [], enemy: enemyOf(20, { atk: 4, minions: [] }) }));
  const s2 = endTurn(s);
  assert.equal(s2.ship.hp, 26);
});

test('endTurn: 我方嘲讽单位强制吸引敌方火力', () => {
  const s = newBattle(baseCfg({
    crew: [crew('盾', { atk: 0, hp: 6, keywords: ['嘲讽'] }), crew('雪', { atk: 1, hp: 2 })],
    enemy: enemyOf(20, { atk: 0, minions: [{ name: '僚机', atk: 2, hp: 3 }] }),
  }));
  const s2 = endTurn(s);
  assert.equal(s2.board.find((u) => u.id === '盾').hp, 4);          // 嘲讽吃伤 6-2
  assert.equal(s2.board.find((u) => u.id === '雪').hp, 2);          // 雪 安全
});

test('summon: 召唤单位入场(type=summon, onField)', () => {
  const s = newBattle(baseCfg({ deck: ['无人机', ...deckOf(19, '齐射')], crew: [crew('林')] }));
  const card = s.hand.find((c) => c.cardId === '无人机');
  const s2 = playCard(s, card.instanceId);
  const drone = s2.board.find((u) => u.type === 'summon');
  assert.equal(drone.name, '无人机');
  assert.equal(drone.onField, true);
  assert.equal(drone.canAct, false);                  // 无突袭：当回合不可动
});

test('summon 突袭: 当回合即可行动并攻击', () => {
  let s = newBattle(baseCfg({ deck: ['突击机', ...deckOf(19, '齐射')], crew: [], enemy: enemyOf(20) }));
  s = startTurnTo(s, 2);
  let s2 = playCard(s, s.hand.find((c) => c.cardId === '突击机').instanceId);
  const u = s2.board.find((x) => x.type === 'summon');
  assert.equal(u.canAct, true);
  s2 = attack(s2, u.instanceId, 'enemyFace');
  assert.equal(s2.enemy.hp, 17);                      // 突袭当回合 3 伤
});

test('战吼: 召唤带战吼单位入场即触发', () => {
  let s = newBattle(baseCfg({ deck: ['炮手', ...deckOf(19, '齐射')], crew: [], enemy: enemyOf(20) }));
  s = startTurnTo(s, 2);
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '炮手').instanceId);
  assert.equal(s2.enemy.hp, 18);                      // 战吼 2 伤
});

test('站场上限 7：满场不能再召唤', () => {
  const crew7 = Array.from({ length: 7 }, (_, i) => crew('c' + i));
  let s = newBattle(baseCfg({ deck: ['无人机', ...deckOf(19, '齐射')], crew: crew7 }));
  s = startTurnTo(s, 2);
  const card = s.hand.find((c) => c.cardId === '无人机');
  assert.equal(canPlay(s, card.instanceId), false);
  assert.equal(playCard(s, card.instanceId).board.filter((u) => u.onField).length, 7);
});

test('亡语: 召唤单位死亡触发(对敌脸+3)', () => {
  let s = newBattle(baseCfg({ deck: ['自爆机', ...deckOf(19, '齐射')], crew: [], enemy: enemyOf(20, { minions: [{ name: '僚机', atk: 2, hp: 3 }] }) }));
  s = startTurnTo(s, 2);
  let s2 = playCard(s, s.hand.find((c) => c.cardId === '自爆机').instanceId);
  const u = s2.board.find((x) => x.type === 'summon');
  s2 = attack(s2, u.instanceId, s2.enemy.board[0].instanceId);   // 互扣 → 自爆机死
  assert.equal(s2.board.some((x) => x.type === 'summon'), false);
  assert.equal(s2.enemy.hp, 17);                                 // 亡语 3 伤脸
});

test('光环: 回合开始治疗其他在场船员（不含自己，封顶 maxHp）', () => {
  let s = newBattle(baseCfg({ crew: [crewAura('医', 2), crew('林', { hp: 5 })], enemy: enemyOf(20, { atk: 0 }) }));
  s.board.find((u) => u.id === '林').hp = 2;
  const s2 = startTurn(s);
  assert.equal(s2.board.find((u) => u.id === '林').hp, 4);
  assert.equal(s2.board.find((u) => u.id === '医').hp, 4);        // 自己不被自己治
});

test('储备耗尽: 牌库抽空后摸牌递增自伤 1,2…', () => {
  let s = newBattle(baseCfg({ deck: deckOf(5, '齐射'), crew: [], enemy: enemyOf(20, { atk: 0 }) }));
  assert.equal(s.deck.length, 0);
  assert.equal(s.ship.hp, 30);
  s = endTurn(s);
  assert.equal(s.fatigue, 1);
  assert.equal(s.ship.hp, 29);
  s = endTurn(s);
  assert.equal(s.fatigue, 2);
  assert.equal(s.ship.hp, 27);
});

test('舰长指令: 花2能量对敌脸1伤、每回合限一次', () => {
  let s = newBattle(baseCfg({ crew: [], enemy: enemyOf(20) }));
  s = startTurnTo(s, 2);
  const s2 = heroPower(s);
  assert.equal(s2.enemy.hp, 19);
  assert.equal(s2.energy.current, 0);
  assert.equal(heroPower(s2).enemy.hp, 19);                       // 已用+能量不足 → 不变
});

test('法术 维修: 治疗舰体（封顶 maxHp）', () => {
  let s = newBattle(baseCfg({ deck: ['维修', ...deckOf(19, '齐射')], crew: [] }));
  s.ship.hp = 20;
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '维修').instanceId);
  assert.equal(s2.ship.hp, 25);
});

test('法术 群射: 对所有敌方单位造成伤害并清场', () => {
  let s = newBattle(baseCfg({ deck: ['群射', ...deckOf(19, '齐射')], crew: [], enemy: enemyOf(20, { minions: [{ name: 'a', atk: 1, hp: 2 }, { name: 'b', atk: 1, hp: 1 }, { name: 'c', atk: 1, hp: 3 }] }) }));
  s = startTurnTo(s, 3);
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '群射').instanceId);
  assert.equal(s2.enemy.board.length, 1);                         // 2,1 死，3→1 存活
  assert.equal(s2.enemy.board[0].hp, 1);
});

test('法术 定点: 指定敌方单位造成伤害', () => {
  let s = newBattle(baseCfg({ deck: ['定点', ...deckOf(19, '齐射')], crew: [], enemy: enemyOf(20, { minions: [{ name: '重炮', atk: 5, hp: 4 }] }) }));
  s = startTurnTo(s, 2);
  const foe = s.enemy.board[0].instanceId;
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '定点').instanceId, { targetId: foe });
  assert.equal(s2.enemy.board.length, 0);                         // 4hp 受 4 → 死
});

test('关键词 标记(§6)：标记敌舰后对其伤害 +2', () => {
  let s = newBattle(baseCfg({ deck: ['标记弹', '脉冲', ...deckOf(18, '齐射')], crew: [], enemy: enemyOf(20) }));
  s = startTurnTo(s, 2);
  s = playCard(s, s.hand.find((c) => c.cardId === '标记弹').instanceId);
  assert.equal(s.enemy.marked, true);
  assert.equal(s.enemy.hp, 20);                       // 标记本身不造成伤害
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '脉冲').instanceId);  // 脉冲3 +2(标记)
  assert.equal(s2.enemy.hp, 15);
});

test('关键词 连携(§6)：本回合出第 2 张时连携牌额外伤害', () => {
  let s = newBattle(baseCfg({ deck: ['脉冲', '连携突击', ...deckOf(18, '齐射')], crew: [], enemy: enemyOf(20) }));
  s = startTurnTo(s, 3);
  s = playCard(s, s.hand.find((c) => c.cardId === '脉冲').instanceId);         // 第1张：-3 → 17
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '连携突击').instanceId); // 第2张：连携 1+4=5 → 12
  assert.equal(s2.enemy.hp, 12);
});

test('遗物 弹头涂层(§8)：所有伤害牌 +1', () => {
  const s = newBattle(baseCfg({ deck: ['脉冲', ...deckOf(19, '齐射')], crew: [], enemy: enemyOf(20), relics: [{ kind: 'atkDmg', amount: 1 }] }));
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '脉冲').instanceId);   // 脉冲3 + 遗物1 = 4
  assert.equal(s2.enemy.hp, 16);
});

test('遗物 过载电容(§8)：回合1起始能量 +1', () => {
  const s = newBattle(baseCfg({ crew: [], relics: [{ kind: 'startEnergy', amount: 1 }] }));
  assert.equal(s.energy.current, 2);                // 回合1 max1 + 遗物1
  assert.equal(s.energy.max, 1);
});

test('遗物 自动装填(§8)：每回合多摸 1 张', () => {
  const s = newBattle(baseCfg({ deck: deckOf(20, '齐射'), crew: [], relics: [{ kind: 'extraDraw', amount: 1 }] }));
  assert.equal(s.hand.length, 6);                   // 起手4 + 回合1摸(1+1)
});

test('遗物 紧固装甲(§8)：开局舰体 +3 护甲', () => {
  const s = newBattle(baseCfg({ crew: [], relics: [{ kind: 'startArmor', amount: 3 }] }));
  assert.equal(s.ship.armor, 3);
});

test('地形 星云(§4.2)：护甲/护盾效果失效', () => {
  let s = newBattle(baseCfg({ deck: ['护盾', ...deckOf(19, '齐射')], crew: [], terrain: 'nebula' }));
  s = startTurnTo(s, 2);
  const s2 = playCard(s, s.hand.find((c) => c.cardId === '护盾').instanceId);
  assert.equal(s2.ship.armor, 0);                   // 星云下护盾无效
});

test('地形 引力井(§4.2)：每回合 +1 可用能量（max 不变）', () => {
  const s = newBattle(baseCfg({ crew: [], terrain: 'gravity' }));
  assert.equal(s.energy.max, 1);
  assert.equal(s.energy.current, 2);                // 回合1：max1 + 引力1
});

test('地形 恒星风(§4.2)：敌方攻击随机目标（rng 决定，非最低血）', () => {
  const mk = () => newBattle(baseCfg({ crew: [crew('A', { hp: 9 }), crew('B', { hp: 9 })], enemy: enemyOf(20, { atk: 3, minions: [] }), terrain: 'solarwind' }));
  const low = endTurn(mk(), () => 0.0);             // 随机→第 1 个
  const high = endTurn(mk(), () => 0.99);           // 随机→最后一个
  const hp = (st, id) => st.board.find((u) => u.id === id).hp;
  assert.notDeepEqual([hp(low, 'A'), hp(low, 'B')], [hp(high, 'A'), hp(high, 'B')]);
});

test('意图预告(§9.1)：newBattle 后 enemy.intent 反映下回合总伤害', () => {
  const s = newBattle(baseCfg({ crew: [crew('林', { hp: 9 })], enemy: enemyOf(20, { atk: 3, minions: [{ name: 'a', atk: 2, hp: 3 }, { name: 'b', atk: 4, hp: 3 }] }) }));
  assert.equal(s.intent.type, 'attack');
  assert.equal(s.intent.value, 3 + 2 + 4);          // 舰炮3 + 僚机2 + 僚机4 = 9
});

test('意图预告：玩家打掉敌方单位后，意图随之更新（出手后重算）', () => {
  let s = newBattle(baseCfg({ crew: [crew('林', { atk: 3, hp: 9 })], enemy: enemyOf(20, { atk: 0, minions: [{ name: 'a', atk: 2, hp: 2 }] }) }));
  assert.equal(s.intent.value, 2);
  s = attack(s, s.board[0].instanceId, s.enemy.board[0].instanceId);  // 林3 杀僚机(hp2)
  assert.equal(s.enemy.board.length, 0);
  assert.equal(s.intent.value, 0);                  // 无单位 + 舰炮0 → 0
  assert.equal(s.intent.type, 'idle');
});

test('站场上限可成长(§9.2)：maxSlots 默认 4，可配置至 6；锚不变', () => {
  const a = newBattle(baseCfg({ crew: [crew('林')] }));
  assert.equal(a.maxSlots, 4);
  assert.equal(a.ship.maxHp, 30);                   // 平衡锚不变
  const b = newBattle(baseCfg({ crew: [crew('林')], maxSlots: 6 }));
  assert.equal(b.maxSlots, 6);
});

test('集成: 真实卡库 + 艺人船员开战，可出牌、可结束回合', () => {
  const s = newBattle({
    cards: LIB, deck: starterDeck(),
    crew: crewFromCast([{ id: 'a', name: '林' }, { id: 'b', name: '雪' }]),
    enemy: ENEMIES.海盗前锋, rng: seqRng([0.4]),
  });
  assert.equal(s.status, 'active');
  assert.ok(s.hand.length >= 4);
  assert.equal(s.board.filter((u) => u.type === 'crew').length, 2);
  assert.equal(s.board[0].role, '参谋长');                        // 角色轮换分派
  const playable = s.hand.find((c) => canPlay(s, c.instanceId));
  assert.ok(playable, '起手至少一张可出');
  const s2 = playCard(s, playable.instanceId);
  assert.notEqual(s2, s);
  const s3 = endTurn(s2);
  assert.ok(s3.turn >= 2 || s3.status !== 'active');
});

// ── §ch2 新地形：离子风暴（每回合无视护甲掉血，不致死）──
test('地形·离子风暴：回合1不掉血，之后每回合开始无视护甲掉 2', () => {
  let s = newBattle(baseCfg({ terrain: 'ionstorm', enemy: enemyOf(40, { atk: 0 }) }));
  assert.equal(s.ship.hp, 30);
  s = endTurn(s); assert.equal(s.ship.hp, 28);
  s = endTurn(s); assert.equal(s.ship.hp, 26);
});
test('离子风暴不致死：回合开始至少保留 1 点舰体', () => {
  let s = newBattle(baseCfg({ terrain: 'ionstorm', enemy: enemyOf(40, { atk: 0 }) }));
  s.ship.hp = 1;
  s = startTurn(s);
  assert.equal(s.ship.hp, 1);
  assert.equal(s.status, 'active');
});
// ── §ch2 新流派：力场过载（伤害 = base + 当前护甲）──
CARDS.过载 = { id: '过载', name: '力场过载', cost: 3, type: 'spell', effect: { kind: 'armorStrike', target: 'enemyFace', amount: 1 } };
test('力场过载（护盾流）：对敌伤害 = base + 当前舰体护甲', () => {
  let s = newBattle(baseCfg({ deck: deckOf(20, '过载'), enemy: enemyOf(40, { atk: 0 }) }));
  s = startTurnTo(s, 3);
  s.ship.armor = 5;
  const c = s.hand.find((x) => x.cardId === '过载');
  const before = s.enemy.hp;
  s = playCard(s, c.instanceId);
  assert.equal(before - s.enemy.hp, 6);   // 1 + 5
});
test('力场过载无护甲时仅造成 base', () => {
  let s = newBattle(baseCfg({ deck: deckOf(20, '过载'), enemy: enemyOf(40, { atk: 0 }) }));
  s = startTurnTo(s, 3);
  s.ship.armor = 0;
  const c = s.hand.find((x) => x.cardId === '过载');
  const before = s.enemy.hp;
  s = playCard(s, c.instanceId);
  assert.equal(before - s.enemy.hp, 1);   // 1 + 0
});
