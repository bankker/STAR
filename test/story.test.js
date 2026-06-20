import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticCoef, resolveBattle, applyAffinity, affinityStage, applyChoice, newStory, buildAppraiseMessages, parseJsonLoose } from '../src/studio/story.js';

test('tacticCoef：突击克包抄、被诱敌克、平手', () => {
  assert.equal(tacticCoef('突击', '包抄'), 1.5);
  assert.equal(tacticCoef('突击', '诱敌'), 0.7);
  assert.equal(tacticCoef('突击', '突击'), 1.0);
  assert.equal(tacticCoef('包抄', '诱敌'), 1.5);
  assert.equal(tacticCoef('诱敌', '突击'), 1.5);
});

test('resolveBattle：确定性 rng 下，克制方胜、败方损失更大', () => {
  const A = { troops: 100, morale: 60, commander: { 统率: 70, 谋略: 50, 魅力: 50 }, tactic: '突击' };
  const D = { troops: 100, morale: 60, commander: { 统率: 70, 谋略: 50, 魅力: 50 }, tactic: '包抄' };
  const r = resolveBattle({ attacker: A, defender: D, terrain: '星云', rng: () => 0.5 });
  assert.equal(r.winner, 'attacker');                 // 突击克包抄
  assert.ok(r.casualties.defender > r.casualties.attacker);
  assert.ok(Number.isInteger(r.powerA) && Number.isInteger(r.powerD));
});

test('resolveBattle：可复现（同 rng 同输入 → 同结果）', () => {
  const mk = () => resolveBattle({
    attacker: { troops: 80, morale: 50, commander: { 统率: 60 }, tactic: '诱敌' },
    defender: { troops: 120, morale: 70, commander: { 统率: 80 }, tactic: '包抄' },
    terrain: '恒星风', rng: () => 0.3,
  });
  assert.deepEqual(mk(), mk());
});

test('applyAffinity 钳制 0–100；阶段划分', () => {
  assert.equal(applyAffinity(95, 10), 100);
  assert.equal(applyAffinity(5, -10), 0);
  assert.equal(affinityStage(85), '交心');
  assert.equal(affinityStage(60), '信赖');
  assert.equal(affinityStage(25), '相识');
  assert.equal(affinityStage(10), '陌生');
});

test('applyChoice 不可变地施加效果（好感/数值/资源/flag）', () => {
  const story = {
    cast: [{ artistId: 'a1', affinity: 40, stats: { 统率: 50 } }],
    player: { resources: { supply: 70, politics: 30, intel: 10 } }, flags: {},
  };
  const next = applyChoice(story, { effects: { affinity: { a1: 8 }, stat: { a1: { 统率: 3 } }, resource: { politics: 5 }, flag: { 答应林深: true } } });
  assert.equal(next.cast[0].affinity, 48);
  assert.equal(next.cast[0].stats.统率, 53);
  assert.equal(next.player.resources.politics, 35);
  assert.equal(next.flags['答应林深'], true);
  assert.equal(story.cast[0].affinity, 40);        // 原对象不变
  assert.equal(story.player.resources.politics, 30);
});

test('newStory：默认资源/回合/星域；带玩家名', () => {
  const s = newStory({ name: '杨威利', faction: '自由同盟' });
  assert.equal(s.turn, 1);
  assert.equal(s.player.faction, '自由同盟');
  assert.equal(s.player.actionPoints, 2);
  assert.equal(s.map.systems.length, 6);
  assert.match(s.name, /杨威利/);
});

test('buildAppraiseMessages：{system,messages}，要求只回 JSON', () => {
  const m = buildAppraiseMessages({ name: '林深', persona: '冷静果决' });
  assert.match(m.system, /JSON/);
  assert.equal(m.messages[0].role, 'user');
  assert.match(m.messages[0].content, /林深/);
});

test('进度：rankFor 按声望升衔；checkChapter 达成/超时；computeEnding 双线矩阵', async () => {
  const { newStory, rankFor, checkChapter, computeEnding, enemyAdvance, topAffinity } = await import('../src/studio/story.js');
  assert.equal(rankFor(0), '少尉');
  assert.equal(rankFor(75), '上尉');
  assert.equal(rankFor(500), '上将');

  const s = newStory({ name: '杨', faction: '自由同盟' });
  assert.equal(checkChapter(s).status, 'active');           // 初始进行中
  const tgt = s.map.systems.find((x) => x.id === s.chapter.targetSystemId);
  tgt.faction = '自由同盟';                                  // 夺下目标
  assert.equal(checkChapter(s).status, 'won');
  tgt.faction = '中立'; s.turn = 99;                         // 超时
  assert.equal(checkChapter(s).status, 'lost');

  s.cast = [{ artistId: 'a', affinity: 85 }];
  assert.equal(topAffinity(s), 85);
  s.chapter.status = 'won';
  assert.equal(computeEnding(s).key, '双全');               // 军事胜+交心
  s.cast[0].affinity = 10;
  assert.equal(computeEnding(s).key, '孤高');               // 军事胜+无交心
  s.chapter.status = 'lost';
  assert.equal(computeEnding(s).key, '陨落');

  const s2 = newStory({});
  const taken = enemyAdvance(s2);                            // 敌军吞并一个中立
  assert.ok(taken && s2.map.systems.some((x) => x.faction === '新帝国' && x.name === taken));
});

test('seedRoles：给艺人分派角色与阵营', async () => {
  const { seedRoles } = await import('../src/studio/story.js');
  const r = seedRoles([{ id: 'a', name: '林深' }, { id: 'b', name: '雪' }], '自由同盟');
  assert.equal(r.length, 2);
  assert.equal(r[0].artistId, 'a');
  assert.equal(r[0].faction, '自由同盟');
  assert.notEqual(r[0].role, r[1].role); // 角色不重复（池内轮换）
});

test('parseEvent：叙述+@@@+选项 解析，好感归到 focus，永远≥1选项', async () => {
  const { parseEvent } = await import('../src/studio/story.js');
  const txt = '林深：警报响起，她侧眸看你。\n「我守你侧翼。」\n@@@\n答应她 #好感+8\n严令先论胜负 #好感-3\n沉默';
  const ev = parseEvent(txt, 'art1');
  assert.equal(ev.speakerArtistId, 'art1');
  assert.equal(ev.lines.length, 2);
  assert.equal(ev.choices.length, 3);
  assert.equal(ev.choices[0].text, '答应她');
  assert.deepEqual(ev.choices[0].effects, { affinity: { art1: 8 } });
  assert.equal(ev.choices[1].effects.affinity.art1, -3);
  assert.deepEqual(ev.choices[2].effects, {});           // 无标签 → 空 effects
  // 无 @@@ / 无选项时兜底一个「继续」
  const ev2 = parseEvent('只有叙述没有选项', 'art1');
  assert.equal(ev2.choices.length, 1);
});

test('parseJsonLoose：去围栏 / 截首尾花括号 / 容错', () => {
  assert.deepEqual(parseJsonLoose('{"统率":70}'), { 统率: 70 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('好的：{"a":1,"b":2} 完成'), { a: 1, b: 2 });
  assert.equal(parseJsonLoose('不是 json'), null);
  assert.equal(parseJsonLoose(''), null);
});
