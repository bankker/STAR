// 星舰炉石 · MVP 卡库与预设（纯数据；引擎与 UI 共用）
// 仅用引擎已实现的效果：damage(enemyFace/allEnemyUnits/enemyUnit) / armor / heal(ship/unit) / summon + 战吼 + 亡语

export const CARDS = {
  // —— 武器（攻击）——
  脉冲炮: { id: '脉冲炮', name: '脉冲炮', cost: 1, type: 'spell', cat: '攻击', text: '对敌舰造成 3 点伤害', effect: { kind: 'damage', target: 'enemyFace', amount: 3 } },
  主炮齐射: { id: '主炮齐射', name: '主炮齐射', cost: 3, type: 'spell', cat: '攻击', text: '对敌舰造成 5 点伤害', effect: { kind: 'damage', target: 'enemyFace', amount: 5 } },
  过载脉冲: { id: '过载脉冲', name: '过载主炮', cost: 5, type: 'spell', cat: '攻击', text: '对敌舰造成 8 点伤害', effect: { kind: 'damage', target: 'enemyFace', amount: 8 } },
  定点打击: { id: '定点打击', name: '定点打击', cost: 2, type: 'spell', cat: '攻击', text: '对一个敌方单位造成 5 点伤害', needsTarget: 'enemyUnit', effect: { kind: 'damage', target: 'enemyUnit', amount: 5 } },
  导弹群射: { id: '导弹群射', name: '导弹群射', cost: 4, type: 'spell', cat: '攻击', text: '对所有敌方单位造成 3 点伤害', effect: { kind: 'damage', target: 'allEnemyUnits', amount: 3 } },
  // —— 标记集火流（§6）——
  标记弹: { id: '标记弹', name: '标记弹', cost: 1, type: 'spell', cat: '调度', text: '标记敌舰：此后对其伤害 +2（标记集火流）', needsTarget: null, effect: { kind: 'mark', target: 'enemyFace' } },
  // —— 连携爆发流（§6）——
  连携突击: { id: '连携突击', name: '连携突击', cost: 2, type: 'spell', cat: '攻击', text: '造成 1 点伤害；若本回合已出过牌则改为 5 点（连携流）', effect: { kind: 'damage', target: 'enemyFace', amount: 1, combo: 4, comboAt: 2 } },
  // —— 护盾过载流（§ch2）——
  力场过载: { id: '力场过载', name: '力场过载', cost: 3, type: 'spell', cat: '攻击', text: '对敌舰造成 1 + 当前护甲 点伤害（护盾流：先叠甲再轰）', effect: { kind: 'armorStrike', target: 'enemyFace', amount: 1 } },
  反应装甲: { id: '反应装甲', name: '反应装甲', cost: 1, type: 'spell', cat: '防御', text: '获得 3 点护甲', effect: { kind: 'armor', amount: 3 } },
  // —— 防御 ——
  装甲展开: { id: '装甲展开', name: '装甲展开', cost: 1, type: 'spell', cat: '防御', text: '获得 2 点护甲', effect: { kind: 'armor', amount: 2 } },
  能量护盾: { id: '能量护盾', name: '能量护盾', cost: 2, type: 'spell', cat: '防御', text: '获得 4 点护甲', effect: { kind: 'armor', amount: 4 } },
  // —— 维护 ——
  紧急维修: { id: '紧急维修', name: '紧急维修', cost: 2, type: 'spell', cat: '维护', text: '治疗舰体 5 点', effect: { kind: 'heal', target: 'ship', amount: 5 } },
  // —— 战术/调度（召唤）——
  防卫无人机: { id: '防卫无人机', name: '防卫无人机', cost: 2, type: 'summon', cat: '调度', text: '召唤 1/3 嘲讽无人机', unit: { name: '防卫无人机', atk: 1, hp: 3, keywords: ['嘲讽'] } },
  突击僚机: { id: '突击僚机', name: '突击僚机', cost: 3, type: 'summon', cat: '调度', text: '召唤 4/2 突袭僚机', unit: { name: '突击僚机', atk: 4, hp: 2, keywords: ['突袭'] } },
  自爆无人机: { id: '自爆无人机', name: '自爆无人机', cost: 1, type: 'summon', cat: '调度', text: '突袭；亡语：对敌舰造成 3 点伤害', unit: { name: '自爆无人机', atk: 1, hp: 1, keywords: ['突袭', '亡语'], deathrattle: { kind: 'damage', target: 'enemyFace', amount: 3 } } },
  炮手无人机: { id: '炮手无人机', name: '炮手无人机', cost: 2, type: 'summon', cat: '调度', text: '战吼：对敌舰造成 2 点伤害', unit: { name: '炮手无人机', atk: 2, hp: 2 }, battlecry: { kind: 'damage', target: 'enemyFace', amount: 2 } },
};

// 起始牌库（~15 张，含复本）—— 攻防奶调均衡
export function starterDeck() {
  return [
    '脉冲炮', '脉冲炮', '主炮齐射', '主炮齐射', '过载脉冲',
    '定点打击', '导弹群射',
    '装甲展开', '能量护盾', '紧急维修',
    '防卫无人机', '防卫无人机', '突击僚机', '自爆无人机', '炮手无人机',
    '标记弹', '连携突击',
    '反应装甲', '力场过载',
  ];
}

// 核心船员特性模板（按角色给关键词/光环；A 类命名角色 = 玩家艺人）
export const CREW_TRAITS = {
  参谋长: { atk: 2, hp: 5, keywords: ['光环'], aura: { kind: 'heal', amount: 1 }, blurb: '光环：每回合治疗其他船员 1 点' },
  舰队长: { atk: 4, hp: 4, keywords: [], blurb: '高火力突击核心' },
  工程主管: { atk: 1, hp: 7, keywords: ['嘲讽'], blurb: '嘲讽：替船员挡下敌方火力' },
  情报官: { atk: 3, hp: 4, keywords: [], blurb: '均衡输出' },
};
export const CREW_ROLES = Object.keys(CREW_TRAITS);

// 把艺人映射为核心船员（轮换分派角色特性）
export function crewFromCast(cast) {
  return (cast || []).slice(0, 4).map((a, i) => {
    const role = CREW_ROLES[i % CREW_ROLES.length];
    const t = CREW_TRAITS[role];
    return { id: a.id || a.artistId || ('c' + i), name: a.name || ('船员' + (i + 1)), role, portraitUrl: a.portraitUrl || '', ...structuredClone(t) };
  });
}

// 敌人预设
export const ENEMIES = {
  海盗前锋: { name: '海盗前锋', hp: 24, atk: 2, minions: [{ name: '劫掠机', atk: 2, hp: 2 }] },
  帝国巡防舰: { name: '帝国巡防舰', hp: 30, atk: 3, minions: [{ name: '护卫机', atk: 1, hp: 3, keywords: ['嘲讽'] }] },
  帝国旗舰_BOSS: { name: '帝国旗舰「列日」', hp: 60, atk: 4, isBoss: true, minions: [{ name: '炮塔', atk: 3, hp: 4, keywords: ['嘲讽'] }, { name: '截击机', atk: 2, hp: 2 }] },
};
