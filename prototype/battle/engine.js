// 星舰炉石 · 战斗内核（确定性纯函数；浏览器与 Node 单测共用）
// 设计锚（定稿）：舰体 30 / 能量上限 10 / 起手 4 可调度一次 / 过热 1,2,3… / 站场 7（核心 4 + 召唤 3）

let _uid = 0;
const uid = (p) => `${p}_${++_uid}`;

function instantiate(cardId, cards) {
  const def = cards[cardId] || { id: cardId, name: cardId, cost: 0, type: 'spell' };
  return { instanceId: uid('c'), cardId, ...structuredClone(def) };
}

// 摸 1 张：牌库空→储备耗尽（过热，递增自伤）；手牌满 10→爆牌弃置
function drawOne(s) {
  if (s.deck.length === 0) {
    s.fatigue += 1;
    s.ship.hp -= s.fatigue;
    return;
  }
  const card = instantiate(s.deck.shift(), s.cards);
  if (s.hand.length >= 10) { s.discarded = (s.discarded || 0) + 1; return; }
  s.hand.push(card);
}

export function startTurn(state) {
  const s = structuredClone(state);
  s.turn += 1;
  s.active = 'player';
  s.energy.max = Math.min(10, s.energy.max + 1);
  s.energy.current = s.energy.max;
  s.heroPowerUsed = false;
  drawOne(s);
  applyAuras(s);
  s.board.forEach((u) => { if (u.onField) u.canAct = true; });
  return s;
}

// 伤害结算：先扣护甲，再扣血
function dealDamage(target, amount) {
  let amt = Math.max(0, amount);
  const absorbed = Math.min(target.armor || 0, amt);
  if (target.armor) target.armor -= absorbed;
  amt -= absorbed;
  target.hp -= amt;
}

function checkOutcome(s) {
  if (s.enemy.hp <= 0) { s.enemy.hp = 0; s.status = 'won'; }
  else if (s.ship.hp <= 0) { s.ship.hp = 0; s.status = 'lost'; }
}

function applyEffect(s, eff, opts = {}) {
  if (!eff) return;
  if (eff.kind === 'armor') { s.ship.armor += eff.amount; return; }
  if (eff.kind === 'heal') {
    if (eff.target === 'ship') s.ship.hp = Math.min(s.ship.maxHp, s.ship.hp + eff.amount);
    else if (eff.target === 'unit') { const u = s.board.find((x) => x.instanceId === opts.targetId && x.onField); if (u) u.hp = Math.min(u.maxHp, u.hp + eff.amount); }
    return;
  }
  if (eff.kind === 'damage') {
    if (eff.target === 'enemyFace') dealDamage(s.enemy, eff.amount);
    else if (eff.target === 'allEnemyUnits') s.enemy.board.forEach((u) => dealDamage(u, eff.amount));
    else if (eff.target === 'enemyUnit') { const u = s.enemy.board.find((x) => x.instanceId === opts.targetId); if (u) dealDamage(u, eff.amount); }
  }
}

const BOARD_CAP = 7;
const onFieldCount = (s) => s.board.filter((u) => u.onField).length;

export function canPlay(state, instanceId) {
  if (state.status !== 'active' || state.active !== 'player') return false;
  const card = state.hand.find((c) => c.instanceId === instanceId);
  if (!card) return false;
  if ((card.cost || 0) > state.energy.current) return false;
  if (card.type === 'summon' && onFieldCount(state) >= BOARD_CAP) return false;
  return true;
}

function summonUnit(s, card) {
  const def = card.unit || {};
  s.board.push({
    instanceId: uid('s'), type: 'summon', name: def.name || card.name,
    atk: def.atk ?? 0, hp: def.hp ?? 1, maxHp: def.hp ?? 1,
    keywords: [...(def.keywords || [])], onField: true, injured: false,
    canAct: (def.keywords || []).includes('突袭'),       // 突袭：当回合可动
    deathrattle: def.deathrattle || null,
  });
  if (card.battlecry) applyEffect(s, card.battlecry);     // 战吼
}

export function playCard(state, instanceId, opts = {}) {
  if (!canPlay(state, instanceId)) return state;
  const s = structuredClone(state);
  const idx = s.hand.findIndex((c) => c.instanceId === instanceId);
  const card = s.hand[idx];
  s.energy.current -= (card.cost || 0);
  s.hand.splice(idx, 1);
  if (card.type === 'summon') summonUnit(s, card);
  else applyEffect(s, card.effect, opts);
  removeDead(s);
  checkOutcome(s);
  return s;
}

// 清场：敌方单位死亡移除；我方召唤单位死亡移除；核心船员血尽=负伤退场（保留、离场）
// 亡语/退场效果：召唤单位被摧毁、核心船员负伤退场时触发
function removeDead(s) {
  s.enemy.board = s.enemy.board.filter((u) => u.hp > 0);
  for (const u of s.board) {
    if (u.onField && u.hp <= 0) {
      if (u.type === 'crew') { u.injured = true; u.onField = false; u.canAct = false; }
      else { u._dead = true; }
      if (u.deathrattle) applyEffect(s, u.deathrattle);
    }
  }
  s.board = s.board.filter((u) => !u._dead);
}

// 光环：回合开始，带治疗光环的在场单位治疗其他在场船员（封顶 maxHp）
function applyAuras(s) {
  const healers = s.board.filter((u) => u.onField && u.aura && u.aura.kind === 'heal');
  for (const h of healers) {
    for (const u of s.board) {
      if (u.onField && u !== h && u.type === 'crew') u.hp = Math.min(u.maxHp, u.hp + h.aura.amount);
    }
  }
}

export function attack(state, attackerId, targetId) {
  if (state.status !== 'active' || state.active !== 'player') return state;
  const a0 = state.board.find((u) => u.instanceId === attackerId && u.onField);
  if (!a0 || !a0.canAct || (a0.atk || 0) <= 0) return state;
  const taunts = state.enemy.board.filter((u) => (u.keywords || []).includes('嘲讽'));
  if (targetId === 'enemyFace') {
    if (taunts.length) return state;                         // 必须先打嘲讽
  } else {
    const t = state.enemy.board.find((u) => u.instanceId === targetId);
    if (!t) return state;
    if (taunts.length && !taunts.includes(t)) return state;
  }
  const s = structuredClone(state);
  const a = s.board.find((u) => u.instanceId === attackerId);
  if (targetId === 'enemyFace') {
    dealDamage(s.enemy, a.atk);
  } else {
    const t = s.enemy.board.find((u) => u.instanceId === targetId);
    dealDamage(t, a.atk);
    dealDamage(a, t.atk);                                    // 反击
  }
  a.canAct = false;
  removeDead(s);
  checkOutcome(s);
  return s;
}

// 敌方索敌：先嘲讽，再最低血船员，否则舰体
function enemyPickTarget(s) {
  const taunts = s.board.filter((u) => u.onField && (u.keywords || []).includes('嘲讽'));
  const pool = taunts.length ? taunts : s.board.filter((u) => u.onField && u.type === 'crew');
  if (!pool.length) return null;
  return pool.reduce((m, u) => (u.hp < m.hp ? u : m));
}

function enemyUnitAttacks(s, unit) {
  const t = enemyPickTarget(s);
  if (t) { dealDamage(t, unit.atk); dealDamage(unit, t.atk); }   // 单位互扣
  else dealDamage(s.ship, unit.atk);
}

function enemyFaceAttacks(s) {
  const t = enemyPickTarget(s);
  if (t) dealDamage(t, s.enemy.atk);                              // 舰炮无反击
  else dealDamage(s.ship, s.enemy.atk);
}

export function endTurn(state) {
  if (state.status !== 'active') return state;
  let s = structuredClone(state);
  s.active = 'enemy';
  for (const unit of [...s.enemy.board]) {
    if (s.status !== 'active') break;
    const live = s.enemy.board.find((u) => u.instanceId === unit.instanceId);
    if (live && live.hp > 0 && (live.atk || 0) > 0) { enemyUnitAttacks(s, live); removeDead(s); checkOutcome(s); }
  }
  if (s.status === 'active' && (s.enemy.atk || 0) > 0) { enemyFaceAttacks(s); removeDead(s); checkOutcome(s); }
  if (s.status !== 'active') return s;
  return startTurn(s);
}

export function heroPower(state) {
  if (state.status !== 'active' || state.active !== 'player') return state;
  const hp = state.heroPower;
  if (!hp || state.heroPowerUsed || (hp.cost || 0) > state.energy.current) return state;
  const s = structuredClone(state);
  s.energy.current -= hp.cost;
  s.heroPowerUsed = true;
  applyEffect(s, hp.effect);
  removeDead(s);
  checkOutcome(s);
  return s;
}

export function newBattle(cfg) {
  const cards = cfg.cards || {};
  const deck = [...(cfg.deck || [])];
  const hand = [];
  for (let i = 0; i < 4 && deck.length; i++) hand.push(instantiate(deck.shift(), cards));
  const board = (cfg.crew || []).map((c) => ({
    instanceId: uid('u'), type: 'crew', id: c.id, name: c.name,
    role: c.role || '', portraitUrl: c.portraitUrl || '',
    atk: c.atk ?? 0, hp: c.hp ?? 1, maxHp: c.hp ?? 1,
    keywords: [...(c.keywords || [])], canAct: false, injured: false, onField: true,
    aura: c.aura || null, deathrattle: c.deathrattle || null,
  }));
  const enemyBoard = (cfg.enemy?.minions || []).map((m) => ({
    instanceId: uid('e'), type: 'enemy', name: m.name,
    atk: m.atk ?? 0, hp: m.hp ?? 1, maxHp: m.hp ?? 1,
    keywords: [...(m.keywords || [])], onField: true, canAct: true,
  }));
  const s = {
    turn: 0, active: 'player', status: 'active',
    ship: { hp: cfg.ship?.hp ?? 30, maxHp: cfg.ship?.maxHp ?? cfg.ship?.hp ?? 30, armor: 0 },
    energy: { current: 0, max: 0 },
    cards, deck, hand, board,
    enemy: {
      name: cfg.enemy?.name || '敌舰', hp: cfg.enemy?.hp ?? 30,
      maxHp: cfg.enemy?.maxHp ?? cfg.enemy?.hp ?? 30,
      atk: cfg.enemy?.atk ?? 0, armor: cfg.enemy?.armor ?? 0, board: enemyBoard,
    },
    fatigue: 0, log: [],
    heroPower: cfg.heroPower || { name: '集火指令', cost: 2, effect: { kind: 'damage', amount: 1, target: 'enemyFace' } },
    heroPowerUsed: false,
  };
  return startTurn(s);
}
