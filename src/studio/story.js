// 故事模式纯函数：战法克制结算、好感、选项效果、提示词构造、初始星域。零依赖、确定性。
// 设计见 docs/story-mode-design.md。数值在这里确定性计算，LLM 只负责文采。

// ── 战法克制（3 张 RPS）──────────────────────────────────────────────
export const TACTICS = ['突击', '包抄', '诱敌'];
const COUNTERS = { 突击: '包抄', 包抄: '诱敌', 诱敌: '突击' }; // key 克 value
const TERRAIN_FAV = { 回廊要塞: '突击', 星云: '包抄', 恒星风: '诱敌' };

export function tacticCoef(mine, theirs) {
  if (COUNTERS[mine] === theirs) return 1.5;   // 我克对方
  if (COUNTERS[theirs] === mine) return 0.7;   // 被对方克
  return 1.0;                                   // 平手/同卡
}

// attacker/defender: { troops, morale, commander:{统率,谋略,魅力}, tactic }
export function resolveBattle({ attacker, defender, terrain, rng = Math.random }) {
  const power = (s, foeTactic) =>
    s.troops
    * tacticCoef(s.tactic, foeTactic)
    * (0.7 + (s.commander?.统率 ?? 50) / 100 * 0.6)            // 统率抬战力底
    * (TERRAIN_FAV[terrain] === s.tactic ? 1.2 : 1.0)         // 地形契合
    * (0.8 + (s.morale ?? 50) / 100 * 0.4)                    // 士气
    * (0.9 + rng() * 0.2);                                    // 受控随机 ±10%
  const pa = power(attacker, defender.tactic);
  const pd = power(defender, attacker.tactic);
  const winner = pa >= pd ? 'attacker' : 'defender';
  const decisiveness = 1 - Math.min(pa, pd) / Math.max(pa, pd); // 0 势均 → 1 碾压
  const loserLoss = Math.round((0.25 + decisiveness * 0.45) * 100);  // 25%~70%
  const winnerLoss = Math.round((0.05 + decisiveness * 0.15) * 100); // 5%~20%
  const casualties = winner === 'attacker'
    ? { attacker: winnerLoss, defender: loserLoss }
    : { attacker: loserLoss, defender: winnerLoss };
  return {
    winner,
    powerA: Math.round(pa), powerD: Math.round(pd),
    casualties,
    moraleShift: { winner: Math.round(5 + decisiveness * 15), loser: -Math.round(10 + decisiveness * 20) },
    territory: winner, // 胜方夺取该星系
  };
}

// ── 好感 ────────────────────────────────────────────────────────────
export function applyAffinity(cur, delta) { return Math.max(0, Math.min(100, (cur || 0) + delta)); }
export function affinityStage(v) { return v >= 80 ? '交心' : v >= 50 ? '信赖' : v >= 20 ? '相识' : '陌生'; }

// ── 选项效果（不可变地施加到一局存档）────────────────────────────────
export function applyChoice(story, choice) {
  const next = structuredClone(story);
  const e = (choice && choice.effects) || {};
  if (e.affinity) for (const [id, d] of Object.entries(e.affinity)) {
    const c = next.cast?.find((x) => x.artistId === id);
    if (c) c.affinity = applyAffinity(c.affinity, d);
  }
  if (e.stat) for (const [id, kv] of Object.entries(e.stat)) {
    const c = next.cast?.find((x) => x.artistId === id);
    if (c) { c.stats = c.stats || {}; for (const [k, d] of Object.entries(kv)) c.stats[k] = (c.stats[k] || 0) + d; }
  }
  if (e.resource && next.player?.resources) for (const [k, d] of Object.entries(e.resource)) {
    next.player.resources[k] = (next.player.resources[k] || 0) + d;
  }
  if (e.flag) { next.flags = next.flags || {}; Object.assign(next.flags, e.flag); }
  return next;
}

// ── 初始星域 + 建局 ─────────────────────────────────────────────────
export const SEED_SECTOR = {
  systems: [
    { id: 's1', name: '海尼森', faction: '自由同盟', terrain: '回廊要塞' },
    { id: 's2', name: '伊谢尔伦', faction: '中立', terrain: '回廊要塞' },
    { id: 's3', name: '亚姆立札', faction: '自由同盟', terrain: '星云' },
    { id: 's4', name: '奥丁', faction: '新帝国', terrain: '恒星风' },
    { id: 's5', name: '费沙', faction: '中立', terrain: '星云' },
    { id: 's6', name: '范佛利特', faction: '新帝国', terrain: '恒星风' },
  ],
  lanes: [['s1', 's3'], ['s3', 's2'], ['s2', 's5'], ['s5', 's4'], ['s4', 's6'], ['s3', 's5']],
};
export function newStory(player = {}) {
  return {
    name: player.name ? `${player.name}的星海` : '新的星海',
    turn: 1, era: '帝国历 487',
    player: {
      name: player.name || '指挥官', title: player.title || '', pronoun: player.pronoun || '',
      faction: player.faction || '自由同盟', actionPoints: 2,
      resources: { supply: 70, politics: 30, intel: 10 },
    },
    map: structuredClone(SEED_SECTOR),
    env: { name: '旗舰指挥舱', image: '' }, // 当前所在环境；仅"跃迁"改变，事件不改
    envImages: {}, // 去过的地点→插画缓存（回访不重绘）
    cast: [], fleets: [], log: [], flags: {}, pendingEvent: null,
  };
}

// ── 从 LLM 文本里稳健地抠出 JSON（去围栏、截首尾花括号）────────────────
export function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return null; }
}

// ── 提示词构造（给端点调 execute('content', { system, messages })）──────
export function buildAppraiseMessages(artist) {
  const system = '你是一款银河史诗策略游戏的设定师。根据角色资料，评定 Ta 的五项数值（0-100 整数）：统率、谋略、政务、魅力、忠诚。'
    + '只输出 JSON，例如 {"统率":70,"谋略":55,"政务":40,"魅力":80,"忠诚":60}，不要任何多余文字。';
  const profile = [
    artist?.name && `姓名：${artist.name}`,
    artist?.persona && `人设：${artist.persona}`,
    artist?.positioning && `定位：${artist.positioning}`,
    artist?.coreAppeal && `核心魅力：${artist.coreAppeal}`,
    artist?.backstory && `背景：${artist.backstory}`,
  ].filter(Boolean).join('\n');
  return { system, messages: [{ role: 'user', content: profile || '一位神秘角色' }] };
}

export function buildEventMessages(story, focusArtistId) {
  const system = '你是「银河史诗×恋爱养成」互动游戏的编剧。世界观：新帝国 vs 自由同盟，中立费沙。'
    + '玩家是第一人称、不露脸的指挥官。全程 SFW 情感向。节奏明快：scene 一句话，lines 1-3 句每句≤40字，choices 文案≤20字。生成"当前回合的一个场景"，'
    + '只输出 JSON：{"scene":"场景一句话","speakerArtistId":"角色ID","lines":["台词1","台词2"],'
    + '"choices":[{"text":"选项文案","effects":{"affinity":{"角色ID":8},"resource":{"politics":5},"flag":{"名":true}}}]}。'
    + '2-3 个选项，effects 字段可缺省。';
  const roster = (story.cast || []).map((c) => `${c.name || c.artistId}(ID=${c.artistId},好感${c.affinity ?? 0},${c.role || ''})`).join('、') || '（暂无角色）';
  const beat = story.lastBeat ? `承接上一幕：场景「${story.lastBeat.scene || ''}」，玩家选择了「${story.lastBeat.choice || ''}」。请自然延续这一选择推进剧情，而非另起无关事件。` : '开局序章，请引入世界与在场角色。';
  const ctx = `回合 ${story.turn}，玩家阵营 ${story.player?.faction}。所有对话与事件都发生在【当前所在：${story.env?.name || '旗舰指挥舱'}】之内，不要描写离开或转移到别的地点（地点转移由玩家在星图上跃迁决定）。在场角色：${roster}。${beat}`
    + (focusArtistId ? `请聚焦角色 ID=${focusArtistId}。` : '');
  return { system, messages: [{ role: 'user', content: ctx }] };
}

export function buildBattleNarration(result, ctx = {}) {
  const system = '你是银河战争的战地记者，用 2-4 句富张力的中文旁白描写这场会战，要画面与情绪，不要罗列数字。';
  const u = `星域：${ctx.system || '未知星域'}，地形：${ctx.terrain || '—'}。我方战法：${ctx.myTactic}，敌方战法：${ctx.foeTactic}。`
    + `结果：${result.winner === 'attacker' ? '我军取胜' : '我军失利'}。`;
  return { system, messages: [{ role: 'user', content: u }] };
}

// ── 开局自动选角：把现有艺人分派角色（纯函数）────────────────────────
const ROLE_POOL = ['副官', '参谋长', '舰队司令', '情报官', '军医', '盟友'];
export function seedRoles(artists, playerFaction) {
  return (artists || []).map((a, i) => ({
    artistId: a.id, name: a.name,
    role: ROLE_POOL[i % ROLE_POOL.length],
    faction: playerFaction || '自由同盟',
  }));
}

// ── 环境/战役图像提示词（文生图 16:9 背景）────────────────────────────
// 注意：画"环境"而非具体剧情，且不含人物（角色立绘另行叠加），以便同环境内复用、不必每事件重绘。
export function buildSceneImagePrompt(location) {
  const base = String(location || '星舰舰桥').slice(0, 60);
  return `${base}，科幻太空歌剧风格的环境场景插画，电影级光影氛围，宽幅构图，空镜无人物，无文字，高质量数字绘画`;
}
export function buildBattleImagePrompt(ctx = {}) {
  return `星海舰队大会战，${ctx.terrain || '星云'}星域，宏大的太空战列舰交火，激光火炮与爆炸光芒，电影级科幻概念插画，2D数字绘画，史诗氛围，无文字`;
}
