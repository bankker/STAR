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
      faction: player.faction || '自由同盟', actionPoints: 2, rank: '少尉', renown: 0,
      resources: { supply: 70, politics: 30, intel: 10 },
    },
    map: structuredClone(SEED_SECTOR),
    // 第一章：限定回合内夺取伊谢尔伦要塞(s2)；双线结局看是否有同伴交心
    chapter: { index: 1, title: '第一章 · 回廊烽火', goalMode: 'capture', targetSystemId: 's2',
      goalDesc: '夺取伊谢尔伦要塞', deadlineTurn: 8, status: 'active' },
    endings: null,
    env: { name: '旗舰指挥舱', image: '' }, // 当前所在环境；仅"跃迁"改变，事件不改
    envImages: {}, // 去过的地点→插画缓存（回访不重绘）
    cast: [], fleets: [], log: [], flags: {}, pendingEvent: null,
  };
}

// ── 进度/养成（纯函数）────────────────────────────────────────────────
export const RANKS = [
  { renown: 0, name: '少尉' }, { renown: 30, name: '中尉' }, { renown: 70, name: '上尉' },
  { renown: 130, name: '少将' }, { renown: 220, name: '中将' }, { renown: 340, name: '上将' },
];
export function rankFor(renown) { let r = RANKS[0]; for (const x of RANKS) if ((renown || 0) >= x.renown) r = x; return r.name; }
export function topAffinity(story) { return (story.cast || []).reduce((m, c) => Math.max(m, c.affinity || 0), 0); }

// 判定章节状态：达成/失败/进行中
export function checkChapter(story) {
  const ch = story.chapter;
  if (!ch || ch.status !== 'active') return { status: ch?.status || 'active' };
  const sys = (story.map?.systems || []).find((x) => x.id === ch.targetSystemId);
  const mine = sys && sys.faction === story.player.faction;
  if (ch.goalMode === 'capture' && mine) return { status: 'won', reason: 'captured' };
  if (ch.goalMode === 'defend' && sys && !mine) return { status: 'lost', reason: 'fell' };
  if ((story.turn || 1) > ch.deadlineTurn) return { status: 'lost', reason: 'deadline' };
  return { status: 'active' };
}

// 双线结局：军事达成 × 关系(最高好感≥80 交心)
export function computeEnding(story) {
  const military = story.chapter?.status === 'won';
  const bond = topAffinity(story) >= 80;
  if (military && bond) return { key: '双全', title: '双全结局', text: '回廊归于安宁，星海为证，你与挚爱并肩而立。' };
  if (military && !bond) return { key: '孤高', title: '孤高的胜利', text: '你赢得了战争，却独自望着冷清的星海。' };
  if (!military && bond) return { key: '相守', title: '败走亦相守', text: '要塞失守，但总有人始终握紧你的手。' };
  return { key: '陨落', title: '陨落', text: '回廊失守，舰队四散，传说就此沉寂于星尘。' };
}

// 敌军每回合推进（威胁时钟）：吞并一个中立星系，没有则吞并我方一个非目标星系
export function enemyAdvance(story) {
  const sys = story.map?.systems || [];
  const cand = sys.find((x) => x.faction === '中立')
    || sys.find((x) => x.faction === story.player.faction && x.id !== story.chapter?.targetSystemId);
  if (cand) { cand.faction = '新帝国'; return cand.name; }
  return '';
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

// focus: 该场景聚焦的角色对象 {artistId,name} 或 null。输出为「叙述散文 + @@@ + 选项行」的流式友好格式。
export function buildEventMessages(story, focus) {
  const focusName = focus?.name || '在场角色';
  const system = '你是「银河史诗×恋爱养成」互动游戏的编剧。世界观：新帝国 vs 自由同盟，中立费沙。'
    + '玩家是第一人称、不露脸的指挥官，全程 SFW 情感向，节奏明快。'
    + `本场景聚焦角色【${focusName}】。先写 1-3 句简短叙述与该角色的台词（每句≤40字），`
    + '然后另起一行只写三个字符 @@@ 作分隔，其后每行写一个玩家选项（≤20字）；'
    + '可在某选项行末尾加 #好感+N 或 #好感-N 表示该选择对 TA 好感的增减。'
    + '直接输出正文，不要 JSON、不要任何额外说明或标题。';
  const roster = (story.cast || []).map((c) => `${c.name || c.artistId}(好感${c.affinity ?? 0},${c.role || ''})`).join('、') || '（暂无角色）';
  const beat = story.lastBeat ? `承接上一幕：「${story.lastBeat.scene || ''}」，玩家选择了「${story.lastBeat.choice || ''}」，请自然延续。` : '开局序章，请引入世界与在场角色。';
  const ctx = `回合 ${story.turn}，阵营 ${story.player?.faction}。所在【${story.env?.name || '旗舰指挥舱'}】（不要离开此地，地点转移由玩家在星图跃迁）。在场：${roster}。${beat}`;
  return { system, messages: [{ role: 'user', content: ctx }] };
}

// 解析「叙述 + @@@ + 选项」文本为结构化事件。好感增减归到 focusArtistId。永远返回 ≥1 个选项。
export function parseEvent(text, focusArtistId) {
  const raw = String(text || '').replace(/```/g, '').trim();
  const idx = raw.indexOf('@@@');
  const narr = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  const choicePart = idx >= 0 ? raw.slice(idx + 3) : '';
  const lines = narr.split('\n').map((s) => s.trim()).filter(Boolean);
  const choices = choicePart.split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
    const m = line.match(/#\s*好感\s*([+-]\d+)\s*$/);
    const delta = m ? parseInt(m[1], 10) : 0;
    const t = line.replace(/#\s*好感\s*[+-]\d+\s*$/, '').replace(/^[-*\d.、)）.\s]+/, '').trim();
    const effects = (delta && focusArtistId) ? { affinity: { [focusArtistId]: delta } } : {};
    return { text: t, effects };
  }).filter((c) => c.text);
  if (!choices.length) choices.push({ text: '……（继续）', effects: {} });
  return { scene: lines[0] || '', lines, speakerArtistId: focusArtistId || '', choices };
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
