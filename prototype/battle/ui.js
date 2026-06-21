// 星舰炉石 · 前端（出战编成 + 战斗界面 + 结算）。引擎在浏览器端运行，无服务器往返。
import { newBattle, canPlay, playCard, attack, endTurn, heroPower } from './engine.js';
import { CARDS, starterDeck, crewFromCast, ENEMIES, CREW_ROLES, CREW_TRAITS } from './cards.js';
import { CAT, PALETTES, portrait, crack, drone, friendlyDrone, enemyShip, traitIcon, cardArt, starfield, shipSchematic, tagIcon, dialoguePortrait, nodeIcon, enemyThumb, flagSvg, FAC, TYPE_META } from './assets.js';

// 星图节点数据（取自 comp 星图.dc.html）
const MAP_NODES = [
  { id: 'n1', x: 200, y: 650, name: '自由港', type: 'supply', fac: 'free', state: 'cleared', region: '自由港湾', desc: '舰队的补给前哨，安全的避风港。可在此修复舰体、补充燃料与采购卡牌。', rewards: [{ t: '修复舰体 / 补给燃料', tag: '服务', c: '#5fe0ee', ic: 'supply' }, { t: '卡牌商店', tag: '商店', c: '#ffcc4d', ic: 'event' }] },
  { id: 'n2', x: 480, y: 500, name: '哨戒星', type: 'combat', fac: 'neutral', state: 'cleared', region: '自由港湾', desc: '外围哨戒空域，零星的废弃无人机仍在游荡。', enemy: { name: '废弃无人机群', hp: 18, armor: 0, intent: '集火攻击' }, rewards: [{ t: '信用点 ×80', tag: '+80', c: '#ffd27a', ic: 'supply' }] },
  { id: 'n3', x: 480, y: 800, name: '残骸带', type: 'event', fac: 'neutral', state: 'cleared', region: '自由港湾', desc: '一片古老的战场残骸，漂浮着待打捞的舱段。', rewards: [{ t: '随机零件 / 剧情线索', tag: '事件', c: '#c07bff', ic: 'event' }] },
  { id: 'n4', x: 820, y: 640, name: '赤隼巢穴', type: 'elite', fac: 'raider', state: 'available', region: '争议星域', desc: '掠夺者头目「赤隼」盘踞的小行星基地。清剿后将打通前往双子星域的航路。', enemy: { name: '掠夺者 · 赤隼', hp: 34, armor: 2, intent: '召唤僚机' }, rewards: [{ t: '新卡「破甲弹」', tag: '攻击', c: '#ff4d4d', ic: 'elite' }, { t: '信用点 ×120', tag: '+120', c: '#ffd27a', ic: 'supply' }] },
  { id: 'n5', x: 1180, y: 440, name: '双子星', type: 'combat', fac: 'raider', state: 'locked', region: '争议星域', desc: '两颗互绕的恒星之间，掠夺者的巡逻舰队往来频繁。', enemy: { name: '掠夺者巡逻队', hp: 28, armor: 1, intent: '舷侧齐射' }, rewards: [{ t: '信用点 ×140', tag: '+140', c: '#ffd27a', ic: 'supply' }] },
  { id: 'n6', x: 1180, y: 860, name: '静默舱', type: 'event', fac: 'neutral', state: 'locked', region: '争议星域', desc: '一具漂流的医疗冷冻舱发出微弱信标——里面似乎还有幸存的船员。', rewards: [{ t: '可招募新船员', tag: '养成', c: '#3ff0a0', ic: 'event' }, { t: '对话事件', tag: '剧情', c: '#c07bff', ic: 'event' }] },
  { id: 'n7', x: 1560, y: 640, name: '回廊补给站', type: 'supply', fac: 'free', state: 'locked', region: '虚空回廊', desc: '深入虚空回廊前的最后一处补给点。', rewards: [{ t: '修复 / 升级卡牌', tag: '服务', c: '#5fe0ee', ic: 'supply' }] },
  { id: 'n8', x: 1940, y: 460, name: '截击者据点', type: 'combat', fac: 'void', state: 'locked', region: '虚空回廊', desc: '虚空教团的前哨据点，截击者编队严阵以待。', enemy: { name: '虚空截击编队', hp: 40, armor: 3, intent: '核心蓄力' }, rewards: [{ t: '新卡「相位干扰」', tag: '调度', c: '#ffcc4d', ic: 'combat' }] },
  { id: 'n9', x: 1940, y: 840, name: '暗物质云', type: 'elite', fac: 'void', state: 'locked', region: '虚空回廊', desc: '扭曲的暗物质云团，能量读数异常。精英守卫潜伏其中。', enemy: { name: '湮灭者', hp: 46, armor: 4, intent: '集火攻击' }, rewards: [{ t: '稀有零件', tag: '养成', c: '#3ff0a0', ic: 'elite' }] },
  { id: 'n10', x: 2320, y: 640, name: '涅墨西斯', type: 'boss', fac: 'void', state: 'locked', region: '虚空回廊', desc: '虚空母舰「涅墨西斯」——本章的最终目标。击破它，夺回失落的星门。', enemy: { name: '虚空母舰 · 涅墨西斯', hp: 72, armor: 8, intent: '核心过载' }, rewards: [{ t: '章节通关', tag: 'BOSS', c: '#c07bff', ic: 'boss' }, { t: '传说卡 + 大量信用点', tag: '传说', c: '#ffd27a', ic: 'elite' }] },
];
const MAP_EDGES = [['n1', 'n2'], ['n1', 'n3'], ['n2', 'n4'], ['n3', 'n4'], ['n4', 'n5'], ['n4', 'n6'], ['n5', 'n7'], ['n6', 'n7'], ['n7', 'n8'], ['n7', 'n9'], ['n8', 'n10'], ['n9', 'n10']];
const TYPE_ATK = { combat: 2, elite: 3, boss: 4 };
function nodeEnemyCfg(node) {
  const e = node.enemy; if (!e) return null;
  const minions = node.type === 'boss' ? [{ name: '炮塔', atk: 3, hp: 4, keywords: ['嘲讽'] }, { name: '截击机', atk: 2, hp: 2 }]
    : node.type === 'elite' ? [{ name: '僚机', atk: 2, hp: 2, keywords: ['嘲讽'] }] : [];
  return { name: e.name, hp: e.hp, maxHp: e.hp, armor: e.armor || 0, atk: TYPE_ATK[node.type] || 2, minions };
}

const CATKEY = { 攻击: 'attack', 防御: 'defense', 维护: 'maintenance', 调度: 'tactics' };
const TRAIT = { 参谋长: 'cross', 工程主管: 'shield', 舰队长: 'bolt', 情报官: 'gear' };
const STATION = { 参谋长: '维生舱', 舰队长: '主炮塔', 工程主管: '护盾环', 情报官: '导航席' };
const CATE = { 参谋长: 'maintenance', 舰队长: 'attack', 工程主管: 'defense', 情报官: 'tactics' };
let STARS = null;
// 单个艺人 → 船员档案（角色轮换 + 特性模板 + 调色板）
function profile(a, idx) {
  const role = CREW_ROLES[idx % CREW_ROLES.length], t = CREW_TRAITS[role], pal = PALETTES[idx % 4];
  return { id: a.id, name: a.name, role, station: STATION[role], icon: TRAIT[role], catE: CATE[role], accent: pal.accent, pal, portraitUrl: a.portraitUrl, atk: t.atk, hp: t.hp, blurb: t.blurb };
}
const CARDS_BY_CAT = { attack: [], defense: [], maintenance: [], tactics: [] };
Object.values(CARDS).forEach((c) => { const k = CATKEY[c.cat]; if (CARDS_BY_CAT[k]) CARDS_BY_CAT[k].push(c); });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const view = () => document.getElementById('storyView');
const taunts = (units) => units.filter((u) => (u.keywords || []).includes('嘲讽'));

const G = { screen: 'deploy', artists: [], squad: [], detail: null, battle: null, pending: null, result: null };

function toast(msg) {
  const t = view().querySelector('.bg-toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(G._tt); G._tt = setTimeout(() => t.classList.remove('show'), 1400);
}

// ─────────── 入口 ───────────
async function openGame() {
  const v = view();
  v.hidden = false; v.classList.add('bg-root');
  G.run = { nodes: structuredClone(MAP_NODES), selected: 'n4', flagAt: 'n4', pan: { x: -40, y: -70 }, current: null };
  G.screen = 'map'; G.squad = []; G.detail = null; G.battle = null; G.pending = null; G.result = null; G.pendingEnemy = null;
  render();
  try {
    const r = await fetch('/api/artists').then((x) => x.json());
    G.artists = (r.artists || []).map((a) => ({ id: a.id, name: a.name, portraitUrl: (a.portraits && a.portraits[0] && a.portraits[0].url) || '' }));
  } catch { G.artists = []; }
  render();
}
function closeGame() { const v = view(); v.hidden = true; v.classList.remove('bg-root'); v.innerHTML = ''; }

// ─────────── 渲染 ───────────
function render() {
  const v = view();
  if (G.screen === 'map') { v.innerHTML = renderMap() + '<div class="bg-toast"></div>'; fit(); return; }
  if (G.screen === 'battle') { v.innerHTML = renderBattle() + '<div class="bg-toast"></div>'; fit(); return; }
  if (G.screen === 'deploy') { v.innerHTML = renderDeploy() + '<div class="bg-toast"></div>'; fit(); return; }
  if (G.screen === 'dialogue') { v.innerHTML = renderDialogue() + '<div class="bg-toast"></div>'; fit(); return; }
  v.innerHTML = `<div class="bg-wrap">${renderHud()}${renderResult()}</div><div class="bg-toast"></div>`;
}
function fit() {
  const st = document.getElementById('bg-stage'); if (!st) return;
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  G._scale = s > 0 ? s : 1;
  st.style.transform = `scale(${G._scale})`;
}

function renderHud() {
  const turn = G.battle ? G.battle.turn : '—';
  const title = G.screen === 'deploy' ? '出战编成' : G.screen === 'result' ? '会战结算' : (G.battle?.enemy?.name || '会战');
  return `<div class="bg-hud">
    <div class="bg-hud-l">
      <div class="bg-logo"><i></i></div>
      <div class="bg-title">${esc(title)}<small>STARFALL · 星舰协同作战</small></div>
      ${G.screen === 'battle' ? `<div class="bg-turn"><span class="bg-tag">回合</span><b>${turn}</b></div>` : ''}
    </div>
    <button class="bg-x" data-act="close">✕</button>
  </div>`;
}

// ── 出战编成（1:1 复刻 SC2 comp 出战编成.dc.html）──
function deployThumb(a, pr) {
  return a.portraitUrl
    ? `background-image:url('${esc(a.portraitUrl)}');background-size:cover;background-position:50% 22%`
    : `background-image:url(&quot;${Q(portrait(pr.pal))}&quot;);background-size:150%;background-position:50% 16%`;
}
function rosterRow(a, idx) {
  const pr = profile(a, idx);
  const inTeam = G.squad.some((s) => s.id === a.id), isSel = (G.detail || '') === a.id;
  const cc = CAT[pr.catE].color;
  return `<div data-act="pick" data-id="${esc(a.id)}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;cursor:pointer;border-radius:8px;background:${isSel ? 'linear-gradient(100deg,rgba(95,210,235,.16),rgba(10,20,32,.6))' : 'rgba(10,20,32,.45)'};border:1px solid ${isSel ? 'rgba(95,210,235,.6)' : 'rgba(79,214,230,.16)'}">
    <div style="width:52px;height:52px;flex:none;border-radius:7px;border:1px solid ${pr.accent}66;${deployThumb(a, pr)};box-shadow:0 0 12px ${pr.accent}33"></div>
    <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:7px"><span style="font-weight:700;font-size:15px;color:#eaf4ff">${esc(a.name || '')}</span><span style="width:7px;height:7px;background:${cc};transform:rotate(45deg);box-shadow:0 0 6px ${cc}"></span></div><div style="font-size:11px;letter-spacing:1px;color:${pr.accent};margin-top:2px">${esc(pr.role)}</div></div>
    <span style="font-size:10px;letter-spacing:1px;padding:2px 8px;border-radius:8px;color:${inTeam ? '#7fe6c0' : '#8a9aa8'};background:${inTeam ? 'rgba(63,240,160,.14)' : 'rgba(80,100,120,.14)'};border:1px solid ${inTeam ? '#3ff0a0' : '#55657a'}">${inTeam ? '已编入' : '待命'}</span>
  </div>`;
}
function slotHex(i) {
  const a = G.squad[i];
  const pr = a ? profile(a, G.artists.findIndex((x) => x.id === a.id)) : null;
  const station = pr ? pr.station : ['主炮塔', '护盾环', '维生舱', '导航席'][i];
  const port = pr ? (a.portraitUrl ? `background-image:url('${esc(a.portraitUrl)}');background-size:cover;background-position:top center` : `background-image:url(&quot;${Q(portrait(pr.pal))}&quot;);background-size:cover;background-position:top center`) : '';
  const hexClip = 'polygon(50% 0,100% 26%,100% 74%,50% 100%,0 74%,0 26%)';
  return `<div style="position:absolute;top:40px;left:${36 + i * 256}px;width:200px;display:flex;flex-direction:column;align-items:center;${pr ? '' : 'animation:floatY 4s ease-in-out infinite'}">
    <div ${a ? `data-act="detail" data-id="${esc(a.id)}"` : ''} style="position:relative;width:150px;height:168px;display:flex;align-items:center;justify-content:center;cursor:pointer;clip-path:${hexClip};background:${pr ? `linear-gradient(160deg,${pr.accent}22,rgba(8,16,28,.9))` : 'rgba(10,22,36,.5)'};box-shadow:${pr ? `inset 0 0 24px ${pr.accent}33,0 0 22px ${pr.accent}44` : 'inset 0 0 18px rgba(60,160,200,.12)'};outline:${pr ? 'none' : '2px dashed rgba(95,210,235,.4)'};outline-offset:-8px;${pr ? '' : 'animation:slotGlow 2.8s ease-in-out infinite'}">
      ${pr ? `<div style="position:absolute;inset:8px;clip-path:${hexClip};${port}"></div><button data-act="slot-remove" data-idx="${i}" style="position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;background:rgba(40,12,12,.95);border:1px solid #ff6a4a;color:#ff9a7a;font-size:13px;cursor:pointer;z-index:4">✕</button>`
      : `<div style="display:flex;flex-direction:column;align-items:center;gap:6px"><div style="width:40px;height:40px;background-image:url(&quot;${Q(traitIcon(['bolt', 'shield', 'cross', 'gear'][i], 'rgba(140,190,220,.7)'))}&quot;);background-size:contain;background-repeat:no-repeat"></div><span style="font-size:10px;letter-spacing:1px;color:rgba(140,180,210,.7)">空缺</span></div>`}
    </div>
    <div style="margin-top:9px;text-align:center"><div style="font-size:12px;font-weight:700;letter-spacing:1px;color:${pr ? pr.accent : '#6a8090'}">${esc(station)}</div><div style="font-size:12px;color:#cfe0ee;margin-top:2px;min-height:14px">${pr ? esc(pr.name) : '—'}</div></div>
  </div>`;
}
function renderDeploy() {
  STARS = STARS || starfield();
  const filled = G.squad.length;
  const selArtist = G.squad.find((s) => s.id === G.detail) || G.artists.find((a) => a.id === G.detail) || G.squad[0] || G.artists[0];
  const d = selArtist ? profile(selArtist, Math.max(0, G.artists.findIndex((x) => x.id === selArtist.id))) : null;
  const dPort = d ? (selArtist.portraitUrl ? `background-image:url('${esc(selArtist.portraitUrl)}');background-size:cover;background-position:top center` : `background-image:url(&quot;${Q(portrait(d.pal))}&quot;);background-size:112%;background-position:top center`) : '';
  const dCards = d ? (CARDS_BY_CAT[d.catE] || []).slice(0, 3) : [];
  const deck = starterDeck();
  const groups = { attack: [], defense: [], maintenance: [], tactics: [] };
  deck.forEach((id) => { const c = CARDS[id]; (groups[CATKEY[c.cat]] || groups.attack).push(c); });
  const order = ['attack', 'defense', 'maintenance', 'tactics'];
  const atkN = groups.attack.length, atkPct = Math.round(atkN / Math.max(1, deck.length) * 100), defPct = 100 - atkPct;
  const tLabel = atkPct >= 50 ? '激进 · 强攻型阵容' : atkPct <= 30 ? '稳健 · 防御续航型' : '均衡 · 攻守兼备';
  const roster = G.artists.length ? G.artists.map((a, i) => rosterRow(a, i)).join('') : '<div style="padding:24px;text-align:center;color:#5a93ad;font-size:12px">还没有艺人。到工作台创建，他们会成为你的核心船员。</div>';
  const slots = [0, 1, 2, 3].map(slotHex).join('');
  const deckGroupsHtml = order.map((k) => {
    const m = CAT[k], list = groups[k]; if (!list.length) return '';
    const rows = list.map((c) => `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:rgba(10,20,32,.55);border-left:3px solid ${m.color};border-radius:0 5px 5px 0"><div style="width:24px;height:27px;flex:none;clip-path:polygon(50% 0,100% 26%,100% 74%,50% 100%,0 74%,0 26%);background:linear-gradient(180deg,${m.color},${m.color}99);display:flex;align-items:center;justify-content:center;font-family:Oxanium;font-weight:800;font-size:13px;color:#0a1018">${c.cost}</div><span style="flex:1;font-size:13px;color:#dce8f4">${esc(c.name)}</span></div>`).join('');
    return `<div><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:9px;height:9px;background:${m.color};transform:rotate(45deg);box-shadow:0 0 8px ${m.color}"></span><span style="font-weight:700;font-size:13px;letter-spacing:1px;color:${m.color}">${m.label}</span><span style="font-size:11px;color:#7a93a8">${list.length} 张</span><div style="flex:1;height:1px;background:rgba(79,214,230,.15)"></div></div><div style="display:flex;flex-direction:column;gap:6px">${rows}</div></div>`;
  }).join('');
  return `<div class="bg-fit"><div class="bg-stage" id="bg-stage">
    <div style="position:absolute;inset:0;background-image:url(&quot;${Q(STARS)}&quot;);background-size:cover;opacity:.7;pointer-events:none"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 100% 70% at 50% 35%,rgba(40,90,140,.16),transparent 70%);pointer-events:none"></div>

    <div style="position:absolute;top:0;left:0;width:1920px;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:linear-gradient(180deg,rgba(10,26,40,.96),rgba(8,18,30,.5));border-bottom:1px solid rgba(79,214,230,.3);z-index:40">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:40px;height:40px;border:1px solid rgba(79,214,230,.5);clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);display:flex;align-items:center;justify-content:center;background:rgba(12,34,50,.8)"><div style="width:14px;height:14px;border:2px solid #5fe6ff;border-radius:50%;box-shadow:0 0 10px rgba(95,230,255,.7)"></div></div>
        <div><div style="font-family:Oxanium;font-weight:700;font-size:19px;letter-spacing:3px;color:#d6f3ff;text-shadow:0 0 14px rgba(95,230,255,.45)">出战编成</div><div style="font-size:11px;letter-spacing:3px;color:#5a93ad">DEPLOYMENT · 星舰协同作战</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:2px;color:#7fb6c8"><span style="padding:6px 16px;background:rgba(8,22,34,.85);border:1px solid rgba(79,214,230,.3);border-radius:3px">编队 <span style="color:#ffd27a;font-family:Oxanium;font-weight:800">${filled}</span> / 4</span><button data-act="close" style="width:40px;height:40px;border:1px solid rgba(79,214,230,.35);background:rgba(12,30,44,.85);color:#7fd6e6;font-size:16px;cursor:pointer;border-radius:3px">✕</button></div>
    </div>

    <div style="position:absolute;top:84px;left:28px;width:346px;bottom:28px;background:linear-gradient(160deg,rgba(12,28,42,.7),rgba(8,16,28,.78));border:1px solid rgba(79,214,230,.26);clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);display:flex;flex-direction:column">
      <div style="padding:16px 20px 12px;border-bottom:1px solid rgba(79,214,230,.18)"><div style="font-weight:700;font-size:15px;letter-spacing:2px;color:#d6f3ff">可用船员</div><div style="font-size:10px;letter-spacing:2px;color:#5a93ad;margin-top:3px">点击 · 编入舰桥战位（最多 4）</div></div>
      <div style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px">${roster}</div>
    </div>

    <div style="position:absolute;top:88px;left:392px;font-size:11px;letter-spacing:4px;color:#7a93a8">舰桥战位 · BRIDGE STATIONS</div>
    <div style="position:absolute;top:150px;left:400px;width:1024px;height:300px;pointer-events:none;background-image:url(&quot;${Q(shipSchematic)}&quot;);background-size:contain;background-repeat:no-repeat;background-position:center;opacity:.9"></div>
    <div style="position:absolute;top:150px;left:392px;width:1040px;height:300px">${slots}</div>
    <div style="position:absolute;top:474px;left:392px;width:1040px;height:30px;display:flex;align-items:center;gap:10px;padding-left:8px"><span style="font-size:11px;letter-spacing:3px;color:#5fe0ee;animation:bgblink 2.4s ease-in-out infinite">▸ 当前阵容生成的牌库 →</span><div style="flex:1;height:1px;background:linear-gradient(90deg,rgba(95,210,235,.5),transparent)"></div></div>

    <div style="position:absolute;top:524px;left:392px;width:1040px;bottom:28px;background:linear-gradient(160deg,rgba(12,28,42,.72),rgba(8,16,28,.8));border:1px solid rgba(79,214,230,.26);clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);display:flex;overflow:hidden">
      ${d ? `<div style="position:relative;width:300px;flex:none;border-right:1px solid rgba(79,214,230,.2);overflow:hidden;background:radial-gradient(ellipse 80% 70% at 50% 30%,${d.accent}26,rgba(8,16,26,.6))"><div style="position:absolute;inset:0;${dPort}"></div><div style="position:absolute;left:0;right:0;bottom:0;padding:14px 18px;background:linear-gradient(180deg,transparent,rgba(6,14,24,.95))"><div style="font-weight:800;font-size:22px;color:#fff;letter-spacing:1px">${esc(d.name)}</div><div style="font-size:12px;letter-spacing:2px;color:${d.accent};margin-top:2px">${esc(d.role)}</div><button data-act="talk" data-id="${esc(selArtist.id)}" style="margin-top:10px;padding:8px 16px;font-size:13px;font-weight:700;letter-spacing:1px;color:#06202a;background:linear-gradient(180deg,#ff9ec2,#ff6fae);border:0;border-radius:4px;cursor:pointer;box-shadow:0 0 16px rgba(255,111,174,.5)">✦ 与 ${esc(d.name)} 交流</button></div></div>
      <div style="flex:1;padding:22px 26px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;gap:14px">
          <div style="flex:1;padding:12px 16px;background:rgba(58,20,10,.4);border:1px solid rgba(255,176,32,.4);border-radius:6px"><div style="font-size:10px;letter-spacing:2px;color:#d7a76a">火力</div><div style="font-family:Oxanium;font-weight:800;font-size:30px;color:#ffd27a;line-height:1;margin-top:4px">${d.atk}</div></div>
          <div style="flex:1;padding:12px 16px;background:rgba(58,12,10,.4);border:1px solid rgba(255,90,60,.4);border-radius:6px"><div style="font-size:10px;letter-spacing:2px;color:#e0907a">生命</div><div style="font-family:Oxanium;font-weight:800;font-size:30px;color:#ffd0c8;line-height:1;margin-top:4px">${d.hp}</div></div>
          <div style="flex:1.5;padding:12px 16px;background:rgba(95,210,235,.08);border:1px solid rgba(95,210,235,.32);border-radius:6px"><div style="font-size:10px;letter-spacing:2px;color:#7fc0d2">定位</div><div style="font-family:Oxanium;font-weight:800;font-size:18px;color:#9fe6f4;margin-top:6px">${CAT[d.catE].label}型</div></div>
        </div>
        <div style="padding:13px 16px;background:rgba(8,20,32,.7);border-left:3px solid ${d.accent};border-radius:0 6px 6px 0"><div style="display:flex;align-items:center;gap:8px"><div style="width:22px;height:22px;background-image:url(&quot;${Q(traitIcon(d.icon, d.accent))}&quot;);background-size:contain;background-repeat:no-repeat"></div><span style="font-weight:700;font-size:14px;color:#eaf4ff;letter-spacing:1px">特性 · ${esc(d.role)}</span></div><div style="font-size:13px;line-height:1.5;color:#aebfce;margin-top:7px">${esc(d.blurb || '')}　负伤退场不会死亡，战斗结束后归队。</div></div>
        <div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px"><span style="font-size:13px;font-weight:700;letter-spacing:1px;color:#d6f3ff">携带卡牌 · 出战牌库</span><span style="font-size:11px;color:#7a93a8">带上她，这些卡进入牌库</span></div><div style="display:flex;gap:12px">${dCards.map((c) => { const m = CAT[CATKEY[c.cat]]; return `<div style="position:relative;flex:1;height:104px;padding:11px;background:linear-gradient(180deg,rgba(14,28,44,.9),rgba(8,16,26,.95));border:1px solid ${m.color};border-radius:8px;display:flex;flex-direction:column;box-shadow:0 0 12px ${m.color}33"><div style="display:flex;align-items:center;justify-content:space-between"><div style="width:30px;height:33px;clip-path:polygon(50% 0,100% 26%,100% 74%,50% 100%,0 74%,0 26%);background:linear-gradient(180deg,#7b8cff,#4a2fd0);display:flex;align-items:center;justify-content:center;font-family:Oxanium;font-weight:800;font-size:15px;color:#fff">${c.cost}</div><span style="font-size:10px;font-weight:700;letter-spacing:1px;padding:2px 8px;color:${m.color};background:${m.color}1a;border:1px solid ${m.color};border-radius:3px;height:fit-content">${m.label}</span></div><div style="font-weight:700;font-size:14px;color:#eef5fc;margin-top:auto">${esc(c.name)}</div></div>`; }).join('')}</div></div>
      </div>` : '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#5a93ad;font-size:13px">从左侧选入船员，查看其特性与携带卡牌。</div>'}
    </div>

    <div style="position:absolute;top:84px;left:1448px;width:444px;bottom:28px;background:linear-gradient(160deg,rgba(12,28,42,.74),rgba(8,16,28,.82));border:1px solid rgba(79,214,230,.3);clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);display:flex;flex-direction:column;box-shadow:inset 0 0 30px rgba(60,160,200,.08)">
      <div style="padding:16px 20px 14px;border-bottom:1px solid rgba(79,214,230,.2)">
        <div style="display:flex;align-items:baseline;justify-content:space-between"><span style="font-weight:700;font-size:16px;letter-spacing:2px;color:#d6f3ff">出战牌库</span><span style="font-size:12px;color:#7a93a8">共 <span style="font-family:Oxanium;font-weight:800;font-size:17px;color:#7fe6ff">${deck.length}</span> 张</span></div>
        <div style="margin-top:12px"><div style="display:flex;justify-content:space-between;font-size:10px;letter-spacing:1px;margin-bottom:5px"><span style="color:#ff7a6a">进攻 ${atkPct}%</span><span style="color:#7fb6ff">防御/续航 ${defPct}%</span></div><div style="height:10px;border-radius:5px;overflow:hidden;display:flex;border:1px solid rgba(79,214,230,.2)"><div style="width:${atkPct}%;background:linear-gradient(90deg,#ff5a3c,#ff8a6a)"></div><div style="width:${defPct}%;background:linear-gradient(90deg,#7fb6ff,#4d9fff)"></div></div><div style="text-align:center;font-size:11px;letter-spacing:2px;color:#cfe0ee;margin-top:7px">${tLabel}</div></div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px">${deckGroupsHtml}</div>
      <div style="padding:14px 18px;border-top:1px solid rgba(79,214,230,.2)"><button data-act="deploy" style="width:100%;display:flex;align-items:center;justify-content:center;gap:12px;padding:15px;cursor:pointer;background:linear-gradient(180deg,#5fe8c0,#3fd0e0);border:2px solid #d6fff4;clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);box-shadow:0 0 26px rgba(79,230,200,.5)"><span style="font-weight:900;font-size:18px;letter-spacing:3px;color:#06202a">确认出战 · ${esc(G.pendingEnemy?.name || '海盗前锋')}</span><span style="font-size:13px;color:#06202a;opacity:.8">▶</span></button></div>
    </div>
  </div></div>`;
}

// ── 战斗界面（1:1 复刻 SC2 comp：1920×1080 绝对定位舞台，缩放适配）──
function isLegalTarget(b, foeId) {
  const tn = taunts(b.enemy.board);
  if (foeId === 'face') return tn.length === 0;
  if (tn.length) return tn.some((t) => t.instanceId === foeId);
  return true;
}
const Q = (u) => String(u).replace(/"/g, '&quot;'); // data-uri 进内联 style

function crewPanel(c, idx) {
  const b = G.battle, p = G.pending;
  const pal = PALETTES[idx % 4], accent = pal.accent;
  const injured = c.injured, ready = c.canAct && !injured && b.active === 'player' && b.status === 'active', acted = !c.canAct && !injured;
  const sel = p?.kind === 'attack' && p.iid === c.instanceId;
  const can = ready && (c.atk || 0) > 0;
  const filter = injured ? 'brightness(.42) saturate(.6) contrast(1.05)' : acted ? 'grayscale(.85) brightness(.55)' : 'none';
  const clip = 'polygon(15px 0,100% 0,100% calc(100% - 15px),calc(100% - 15px) 100%,0 100%,0 15px)';
  const base = 'inset 0 0 28px rgba(60,200,235,.16),0 10px 28px rgba(0,0,0,.55)';
  const shadow = sel ? base + ',0 0 0 2px #4fd6e6' : can ? base + ',0 0 0 1px ' + accent : base;
  const trait = TRAIT[c.role] || 'gear';
  const lbl = injured ? '负伤退场' : acted ? '已行动' : '';
  return `<div ${!injured ? `data-act="unit" data-id="${esc(c.instanceId)}"` : ''} style="position:relative;width:190px;height:266px;cursor:${can ? 'pointer' : 'default'};overflow:visible;background:linear-gradient(165deg,rgba(18,46,66,.85),rgba(8,18,30,.92));border:1px solid rgba(90,215,235,.5);clip-path:${clip};box-shadow:${shadow};transition:transform .18s,box-shadow .18s;transform:${sel ? 'translateY(-10px)' : 'none'};${ready ? 'animation:readyglow 2.6s ease-in-out infinite;' : ''}opacity:${acted ? 0.92 : 1}">
    <div style="position:absolute;top:10px;left:10px;right:10px;height:186px;${c.portraitUrl ? `background-image:url('${esc(c.portraitUrl)}')` : `background-image:url(&quot;${Q(portrait(pal))}&quot;)`};background-size:cover;background-position:top center;filter:${filter}"></div>
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(120,200,230,0) 0,rgba(120,200,230,0) 3px,rgba(80,160,200,.07) 4px);pointer-events:none"></div>
    ${injured ? `<div style="position:absolute;inset:0;background-image:url(&quot;${Q(crack)}&quot;);background-size:cover;clip-path:${clip};pointer-events:none;opacity:.9;mix-blend-mode:screen"></div>` : ''}
    ${(c.keywords || []).includes('嘲讽') ? `<div style="position:absolute;top:9px;left:9px;width:26px;height:30px;background:linear-gradient(180deg,rgba(80,150,220,.45),rgba(20,50,80,.85));border:1px solid #8fbfe8;clip-path:polygon(50% 0,100% 22%,100% 70%,50% 100%,0 70%,0 22%);display:flex;align-items:center;justify-content:center;font-size:12px;color:#cfe6ff;box-shadow:0 0 12px rgba(143,191,232,.6);z-index:5">⛨</div>` : ''}
    <div title="${esc(c.role || '')}" style="position:absolute;top:8px;right:8px;width:34px;height:34px;z-index:6;background:radial-gradient(circle,rgba(10,28,42,.95),rgba(6,16,26,.95));border:1px solid ${accent};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px ${accent}77"><div style="width:20px;height:20px;background-image:url(&quot;${Q(traitIcon(trait, accent))}&quot;);background-size:contain;background-repeat:no-repeat"></div></div>
    ${lbl ? `<div style="position:absolute;top:46px;left:50%;transform:translateX(-50%);z-index:7;padding:2px 12px;font-size:10px;letter-spacing:2px;font-weight:700;border-radius:9px;white-space:nowrap;background:${injured ? 'rgba(60,14,8,.92)' : 'rgba(40,40,46,.92)'};color:${injured ? '#ff7a5a' : '#aebccb'};border:1px solid ${injured ? '#ff5a3c' : '#5a6a78'}">${lbl}</div>` : ''}
    <div style="position:absolute;left:40px;right:40px;bottom:8px;padding:7px 10px;background:linear-gradient(180deg,rgba(10,28,42,.6),rgba(8,22,34,.95));border-top:1px solid rgba(79,214,230,.3)"><div style="display:flex;flex-direction:column;line-height:1.1;align-items:center;text-align:center"><span style="font-weight:700;font-size:15px;color:#eaf6ff;letter-spacing:1px">${esc(c.name)}</span><span style="font-size:9px;letter-spacing:2px;color:${accent}">${esc(c.role || '')}</span></div></div>
    <div style="position:absolute;bottom:-12px;left:-9px;width:42px;height:42px;background:radial-gradient(circle,#3a2a10,#1a1206);border:2px solid #ffb020;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(255,176,32,.55);z-index:6"><span style="font-family:Oxanium;font-weight:800;font-size:21px;color:#ffd27a;text-shadow:0 0 8px rgba(255,210,122,.7)">${c.atk}</span></div>
    <div style="position:absolute;bottom:-12px;right:-9px;width:42px;height:42px;background:radial-gradient(circle,#3a1410,#1a0806);border:2px solid #ff5a3c;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(255,90,60,.55);z-index:6"><span style="font-family:Oxanium;font-weight:800;font-size:21px;color:#ffd0c8;text-shadow:0 0 8px rgba(255,90,60,.7)">${injured ? 0 : c.hp}</span></div>
  </div>`;
}

function summonSlot(s) {
  if (!s) return `<div style="width:118px;height:170px;border-radius:8px;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(90,140,170,.4);background:rgba(12,26,40,.3)"><span style="font-size:9px;letter-spacing:2px;color:rgba(120,160,190,.5)">召唤位</span></div>`;
  const b = G.battle, p = G.pending;
  const can = s.canAct && (s.atk || 0) > 0 && b.active === 'player' && !s.injured && b.status === 'active';
  const sel = p?.kind === 'attack' && p.iid === s.instanceId;
  return `<div ${!s.injured ? `data-act="unit" data-id="${esc(s.instanceId)}"` : ''} style="width:118px;height:170px;border-radius:8px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(79,214,230,.45);background:linear-gradient(160deg,rgba(16,40,58,.7),rgba(8,18,30,.85));box-shadow:${sel ? '0 0 0 2px #4fd6e6,' : ''}${can ? '0 0 0 1px #5fe0ee,' : ''}inset 0 0 18px rgba(60,180,210,.15);cursor:${can ? 'pointer' : 'default'}"><div style="display:flex;flex-direction:column;align-items:center;gap:5px;width:100%"><div style="width:76px;height:76px;background-image:url(&quot;${Q(friendlyDrone)}&quot;);background-size:contain;background-repeat:no-repeat;background-position:center"></div><div style="display:flex;justify-content:space-between;width:100%;padding:0 12px"><span style="font-family:Oxanium;font-weight:800;font-size:13px;color:#ffd27a">${s.atk}</span><span style="font-family:Oxanium;font-weight:800;font-size:13px;color:#ff8a8a">${s.hp}</span></div><span style="font-size:8px;letter-spacing:1px;color:#8fa6b6">${esc(s.name)}</span></div></div>`;
}

function enemyDroneCard(d) {
  const b = G.battle, p = G.pending;
  const taunt = (d.keywords || []).includes('嘲讽');
  const legal = (p?.kind === 'attack' && isLegalTarget(b, d.instanceId)) || (p?.kind === 'card' && p.needs === 'enemyUnit');
  return `<div ${legal ? `data-act="foe-unit" data-id="${esc(d.instanceId)}"` : ''} style="position:relative;width:92px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:${taunt ? '12px 6px 6px' : '6px'};border:${taunt ? '1px solid rgba(143,191,232,.55)' : '1px solid rgba(255,120,90,.28)'};border-radius:6px;background:${taunt ? 'rgba(20,40,62,.5)' : 'rgba(30,16,16,.4)'};box-shadow:${legal ? '0 0 0 2px #ff5a3c,0 0 16px rgba(255,90,60,.5)' : taunt ? '0 0 16px rgba(143,191,232,.3)' : 'none'};cursor:${legal ? 'crosshair' : 'default'}">
    ${taunt ? '<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:2px 9px;background:rgba(20,46,70,.95);border:1px solid #8fbfe8;border-radius:10px;font-size:9px;letter-spacing:1px;color:#cfe6ff;white-space:nowrap;box-shadow:0 0 12px rgba(143,191,232,.5)">⛨ 嘲讽</div>' : ''}
    <div style="width:70px;height:70px;background-image:url(&quot;${Q(drone(false))}&quot;);background-size:contain;background-repeat:no-repeat;background-position:center"></div>
    <div style="display:flex;justify-content:space-between;width:100%;padding:0 3px"><span style="font-family:Oxanium;font-weight:800;font-size:14px;color:#ff8a6a;text-shadow:0 0 6px rgba(255,90,60,.6)">${d.atk}</span><span style="font-family:Oxanium;font-weight:800;font-size:14px;color:#ff5a5a;text-shadow:0 0 6px rgba(255,60,60,.6)">${d.hp}</span></div>
    <div style="font-size:9px;color:#8fa6b6;letter-spacing:1px;text-align:center;width:100%">${esc(d.name)}</div></div>`;
}

function handCard(c, i, n) {
  const b = G.battle, p = G.pending;
  const m = CAT[CATKEY[c.cat] || 'attack'];
  const off = i - (n - 1) / 2;
  const afford = canPlay(b, c.instanceId) && (c.needsTarget !== 'enemyUnit' || b.enemy.board.length > 0);
  const sel = p?.kind === 'card' && p.iid === c.instanceId;
  const rot = off * 5, ty = Math.abs(off) * Math.abs(off) * 5;
  const transform = sel ? 'translateX(-50%) translateY(-58px) rotate(0deg) scale(1.08)' : `translateX(-50%) translateY(${ty}px) rotate(${rot}deg)`;
  return `<div ${afford ? `data-act="card" data-id="${esc(c.instanceId)}"` : ''} style="position:absolute;left:calc(50% + ${off * 116}px);bottom:74px;width:152px;height:212px;transform-origin:bottom center;transform:${transform};transition:transform .2s,box-shadow .2s,filter .2s;cursor:${afford ? 'pointer' : 'default'};pointer-events:auto;z-index:${sel ? 60 : 20 + i};background:linear-gradient(180deg,rgba(14,30,44,.96),rgba(8,16,26,.98));border:2px solid ${m.color};clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);box-shadow:${sel ? `0 0 30px ${m.glow},0 16px 30px rgba(0,0,0,.6)` : `0 0 14px ${m.glow}55,0 8px 20px rgba(0,0,0,.5)`};filter:${afford ? 'none' : 'grayscale(.7) brightness(.62)'};opacity:${afford ? 1 : 0.82}">
    <div style="position:absolute;top:30px;left:16px;right:16px;height:60px;background-image:url(&quot;${Q(cardArt(CATKEY[c.cat] || 'attack', m.color))}&quot;);background-size:contain;background-repeat:no-repeat;background-position:center;opacity:.92;filter:drop-shadow(0 0 8px ${m.glow})"></div>
    <div style="position:absolute;top:-12px;left:-10px;width:40px;height:44px;background:${afford ? 'linear-gradient(180deg,#7b8cff,#4a2fd0)' : 'linear-gradient(180deg,#5a3a3a,#3a2020)'};border:2px solid ${afford ? '#aeb8ff' : '#8a6a6a'};clip-path:polygon(50% 0,100% 26%,100% 74%,50% 100%,0 74%,0 26%);display:flex;align-items:center;justify-content:center;box-shadow:${afford ? '0 0 16px rgba(120,140,255,.65)' : 'none'};z-index:2"><span style="font-family:Oxanium;font-weight:800;font-size:19px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)">${c.cost}</span></div>
    <div style="position:absolute;top:10px;right:10px;padding:2px 9px;font-size:10px;font-weight:700;letter-spacing:2px;background:${m.color}22;border:1px solid ${m.color};color:${m.color};border-radius:3px">${m.label}</div>
    <div style="position:absolute;top:96px;left:0;right:0;text-align:center;font-weight:700;font-size:13px;color:#f2f8ff;letter-spacing:1px;text-shadow:0 1px 3px rgba(0,0,0,.7);padding:0 6px">${esc(c.name)}</div>
    <div style="position:absolute;top:122px;left:9px;right:9px;bottom:12px;background:rgba(6,14,24,.78);border-radius:5px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;line-height:1.4;color:#cfe0ee;padding:6px">${esc(c.text || '')}</div></div>`;
}

function renderBattle() {
  const b = G.battle, p = G.pending;
  STARS = STARS || starfield();
  const crew = b.board.filter((u) => u.type === 'crew');
  const summons = b.board.filter((u) => u.type === 'summon');
  const faceHit = p?.kind === 'attack' && isLegalTarget(b, 'face');
  const totalAtk = (b.enemy.atk || 0) + b.enemy.board.reduce((s, u) => s + (u.atk || 0), 0);
  const enemyPct = Math.max(0, Math.min(100, b.enemy.hp / b.enemy.maxHp * 100));
  const hullPct = Math.max(0, Math.min(100, b.ship.hp / b.ship.maxHp * 100));
  const capAfford = b.heroPower && !b.heroPowerUsed && b.heroPower.cost <= b.energy.current && b.active === 'player';
  const energy = Array.from({ length: Math.max(b.energy.max, 1) }, (_, i) => { const on = i < b.energy.current; return `<div style="width:24px;height:30px;clip-path:polygon(50% 0,100% 28%,100% 72%,50% 100%,0 72%,0 28%);background:${on ? 'linear-gradient(180deg,#aeb8ff,#5a4fe0)' : 'rgba(20,26,46,.7)'};border:1px solid ${on ? '#cfd4ff' : 'rgba(90,100,160,.5)'};box-shadow:${on ? '0 0 12px rgba(130,140,255,.7)' : 'inset 0 0 6px rgba(0,0,0,.5)'}"></div>`; }).join('');
  const handN = b.hand.length;
  const hand = b.hand.map((c, i) => handCard(c, i, handN)).join('');
  const drones = b.enemy.board.map(enemyDroneCard).join('');
  const slots = [0, 1, 2].map((i) => summonSlot(summons[i])).join('');
  return `<div class="bg-fit"><div class="bg-stage" id="bg-stage">
    <div style="position:absolute;inset:0;background-image:url(&quot;${Q(STARS)}&quot;);background-size:cover;opacity:.7;pointer-events:none"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 60% 40% at 50% 8%,rgba(60,120,170,.16),transparent 70%),radial-gradient(ellipse 70% 45% at 50% 96%,rgba(40,90,140,.22),transparent 65%);pointer-events:none"></div>

    <div style="position:absolute;top:0;left:0;width:1920px;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 26px;background:linear-gradient(180deg,rgba(10,26,40,.96),rgba(8,18,30,.55));border-bottom:1px solid rgba(79,214,230,.32);box-shadow:0 2px 18px rgba(0,0,0,.6);z-index:40">
      <div style="display:flex;align-items:center;gap:18px">
        <div style="width:42px;height:42px;border:1px solid rgba(79,214,230,.5);clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);display:flex;align-items:center;justify-content:center;background:rgba(12,34,50,.8);box-shadow:inset 0 0 14px rgba(79,214,230,.25)"><div style="width:16px;height:16px;border:2px solid #5fe6ff;border-radius:50%;box-shadow:0 0 10px rgba(95,230,255,.7)"></div></div>
        <div><div style="font-family:Oxanium;font-weight:700;font-size:18px;letter-spacing:2px;color:#d6f3ff;text-shadow:0 0 14px rgba(95,230,255,.45)">星舰协同作战</div><div style="font-size:11px;letter-spacing:3px;color:#5a93ad">STARFALL CO-OP</div></div>
        <div style="margin-left:6px;padding:5px 16px;background:rgba(8,22,34,.85);border:1px solid rgba(79,214,230,.38);clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)"><span style="font-size:10px;letter-spacing:2px;color:#5a93ad">回合</span><span style="font-family:Oxanium;font-weight:800;font-size:20px;color:#ffd27a;margin-left:7px;text-shadow:0 0 12px rgba(255,210,122,.5)">${b.turn}</span></div>
      </div>
      <button data-act="close" style="width:40px;height:40px;border:1px solid rgba(79,214,230,.35);background:rgba(12,30,44,.85);color:#7fd6e6;font-size:18px;cursor:pointer;clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)">✕</button>
    </div>

    <div style="position:absolute;top:64px;left:0;width:1920px;height:330px">
      <div style="position:absolute;top:14px;left:50%;transform:translateX(-50%);width:470px;display:flex;flex-direction:column;align-items:center">
        <div ${faceHit ? 'data-act="foe-face"' : ''} style="width:430px;height:144px;background-image:url(&quot;${Q(enemyShip(false))}&quot;);background-size:contain;background-repeat:no-repeat;background-position:center;filter:drop-shadow(0 0 24px rgba(255,110,60,.35));animation:bgfloat 5s ease-in-out infinite;cursor:${faceHit ? 'crosshair' : 'default'};${faceHit ? 'outline:2px solid #ff5a3c;outline-offset:6px' : ''}"></div>
        <div style="margin-top:-6px;display:flex;flex-direction:column;align-items:center;gap:6px;width:460px">
          <div style="font-family:Oxanium;font-weight:700;font-size:18px;letter-spacing:2px;color:#ffb9a0;text-shadow:0 0 14px rgba(255,90,60,.45)">${esc(b.enemy.name)}</div>
          <div style="position:relative;width:310px;height:18px;background:rgba(6,16,26,.9);border:1px solid rgba(255,90,60,.45);clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px);overflow:hidden">
            <div style="position:absolute;top:0;left:0;bottom:0;width:${enemyPct}%;background:linear-gradient(90deg,#7a1a14,#ff5a3c,#ff8a5a);box-shadow:0 0 12px rgba(255,90,60,.6)"></div>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:Oxanium;font-weight:800;font-size:12px;color:#fff;text-shadow:0 1px 4px #000">${Math.max(0, b.enemy.hp)} / ${b.enemy.maxHp}</div>
          </div>
        </div>
      </div>
      ${b.enemy.armor > 0 ? `<div style="position:absolute;top:46px;left:calc(50% - 250px);display:flex;flex-direction:column;align-items:center;gap:3px"><div style="width:50px;height:56px;background:linear-gradient(180deg,rgba(120,160,210,.3),rgba(20,40,60,.85));border:1px solid rgba(150,190,230,.6);clip-path:polygon(50% 0,100% 26%,100% 74%,50% 100%,0 74%,0 26%);display:flex;align-items:center;justify-content:center"><span style="font-family:Oxanium;font-weight:800;font-size:22px;color:#cfe6ff">${b.enemy.armor}</span></div><span style="font-size:9px;letter-spacing:2px;color:#7fa8c4">护甲</span></div>` : ''}
      <div style="position:absolute;top:34px;left:calc(50% + 200px);width:262px">
        <div style="font-size:10px;letter-spacing:4px;color:#7a93a8;margin-bottom:5px;padding-left:4px">敌方下回合意图</div>
        <div style="position:relative;background:linear-gradient(160deg,rgba(40,18,18,.9),rgba(12,18,28,.94));border:1px solid #ff5a3c;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);padding:14px 15px;box-shadow:0 0 24px #ff5a3c44,inset 0 0 18px rgba(0,0,0,.4);animation:bgblink 2.4s ease-in-out infinite">
          <div style="display:flex;align-items:baseline;gap:8px"><span style="font-weight:700;font-size:17px;color:#fff;letter-spacing:1px">集火攻击</span><span style="font-family:Oxanium;font-weight:800;font-size:22px;color:#ff5a3c;text-shadow:0 0 12px #ff5a3c">${totalAtk}</span></div>
          <div style="font-size:11px;color:#9fb6c6;margin-top:3px">瞄准火力最薄弱的船员</div>
        </div>
      </div>
      <div style="position:absolute;top:232px;left:50%;transform:translateX(-50%);display:flex;gap:18px;align-items:flex-end">${drones}</div>
    </div>

    <div style="position:absolute;top:394px;left:0;width:1920px;height:68px;overflow:hidden">
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,20,34,0),rgba(20,50,74,.25),rgba(8,20,34,0))"></div>
      <div style="position:absolute;top:50%;left:0;width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(79,214,230,.5),transparent)"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:9px;letter-spacing:8px;color:rgba(120,170,200,.45)">— 交战空域 · DMZ —</div>
      ${G.beam ? `<div style="position:absolute;top:50%;left:14%;width:72%;height:4px;transform-origin:left center;background:linear-gradient(90deg,transparent,${G.beam.color},#fff,${G.beam.color});box-shadow:0 0 18px ${G.beam.color},0 0 6px #fff;border-radius:3px;animation:beamfly .7s cubic-bezier(.4,0,.2,1) forwards"></div>` : ''}
    </div>

    <div style="position:absolute;top:462px;left:0;width:1920px;height:310px;display:flex;align-items:center;justify-content:center;gap:18px;padding:0 70px">
      ${crew.map((c, i) => crewPanel(c, i)).join('')}
      <div style="width:1px;height:180px;background:linear-gradient(180deg,transparent,rgba(79,214,230,.4),transparent);margin:0 4px"></div>
      ${slots}
    </div>

    <div style="position:absolute;bottom:0;left:0;width:1920px;height:308px;background:linear-gradient(180deg,rgba(8,18,30,0),rgba(9,22,36,.92) 36%,rgba(7,16,28,.98));border-top:1px solid rgba(79,214,230,.28);z-index:20">
      <div style="position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(79,214,230,.6),transparent)"></div>
      <div style="position:absolute;bottom:22px;left:28px;width:266px;background:linear-gradient(160deg,rgba(16,40,58,.9),rgba(8,18,30,.95));border:1px solid rgba(79,214,230,.32);clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);padding:13px 16px;box-shadow:inset 0 0 22px rgba(60,160,200,.12)">
        <div style="font-weight:700;font-size:13px;letter-spacing:2px;color:#d6f3ff;margin-bottom:8px">「奥德赛」号 · 舰体</div>
        <div style="display:flex;align-items:center;gap:11px">
          <div style="width:46px;height:52px;background:linear-gradient(180deg,rgba(120,200,160,.3),rgba(20,40,40,.85));border:1px solid #4dd6a0;clip-path:polygon(50% 0,100% 26%,100% 74%,50% 100%,0 74%,0 26%);display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(77,214,160,.4)"><span style="font-family:Oxanium;font-weight:800;font-size:24px;color:#bdffe0;text-shadow:0 0 10px rgba(77,214,160,.7)">${Math.max(0, b.ship.hp)}</span></div>
          <div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:9px;color:#7fa8b8;letter-spacing:1px;margin-bottom:4px"><span>结构完整度</span><span>${Math.max(0, b.ship.hp)} / ${b.ship.maxHp}${b.ship.armor ? ' +' + b.ship.armor : ''}</span></div><div style="height:9px;background:rgba(6,16,26,.9);border:1px solid rgba(77,214,160,.4);border-radius:5px;overflow:hidden"><div style="width:${hullPct}%;height:100%;background:linear-gradient(90deg,#2a8a64,#4dd6a0);box-shadow:0 0 10px rgba(77,214,160,.6)"></div></div></div>
        </div>
        <button ${capAfford ? 'data-act="hero"' : ''} style="width:100%;margin-top:12px;display:flex;align-items:center;gap:10px;padding:9px 12px;background:${capAfford ? 'linear-gradient(180deg,rgba(60,120,90,.5),rgba(20,50,40,.7))' : 'rgba(30,36,42,.6)'};border:1px solid ${capAfford ? '#4dd6a0' : '#4a5560'};border-radius:5px;cursor:${capAfford ? 'pointer' : 'not-allowed'};color:${capAfford ? '#bdffe0' : '#6a7682'};box-shadow:${capAfford ? '0 0 16px rgba(77,214,160,.3)' : 'none'}"><div style="width:30px;height:30px;border:1px solid currentColor;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px">◎</div><div style="text-align:left;line-height:1.15"><div style="font-size:12px;font-weight:700;letter-spacing:1px">舰长指令 · ${esc(b.heroPower?.name || '集火')}</div><div style="font-size:9px;opacity:.8">消耗 ${b.heroPower?.cost || 2} 能量 · 每回合一次</div></div></button>
      </div>

      <div style="position:absolute;left:0;right:0;bottom:0;height:308px;pointer-events:none">${hand}</div>

      <div style="position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px;z-index:25">
        <div style="display:flex;align-items:center;gap:5px">${energy}</div>
        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:10px;letter-spacing:3px;color:#8aa8d6">反应堆能量</span><span style="font-family:Oxanium;font-weight:800;font-size:15px;color:#aebfff;text-shadow:0 0 10px rgba(130,150,255,.6)">${b.energy.current} / ${b.energy.max}</span></div>
      </div>

      <div style="position:absolute;bottom:24px;right:30px;display:flex;flex-direction:column;align-items:center;gap:5px;z-index:25">
        <div style="position:relative;width:64px;height:88px"><div style="position:absolute;inset:0;border:1px solid rgba(79,214,230,.5);clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(18,44,66,.95),rgba(8,20,34,.98));box-shadow:0 0 16px rgba(79,214,230,.3)"><span style="font-family:Oxanium;font-weight:800;font-size:26px;color:#7fe6ff;text-shadow:0 0 12px rgba(95,230,255,.7)">${b.deck.length}</span></div></div>
        <span style="font-size:9px;letter-spacing:2px;color:#7fa8c4">牌库</span>
      </div>
    </div>

    <button data-act="endturn" style="position:absolute;right:26px;top:430px;width:118px;height:132px;z-index:45;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;background:linear-gradient(180deg,#5fe8c0,#3fd0e0);border:2px solid #d6fff4;clip-path:polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px);box-shadow:0 0 28px rgba(79,230,200,.6),0 8px 24px rgba(0,0,0,.5)"><div style="font-size:11px;letter-spacing:3px;color:#06202a;opacity:.85">YOUR TURN</div><div style="font-weight:900;font-size:21px;letter-spacing:2px;color:#062028">结束回合</div><div style="font-size:18px;color:#062028">▶</div></button>

    <div style="position:absolute;bottom:316px;left:50%;transform:translateX(-50%);padding:5px 20px;background:rgba(6,16,28,.8);border:1px solid rgba(79,214,230,.25);border-radius:14px;font-size:11px;letter-spacing:1px;color:#9fc4d6;z-index:30;white-space:nowrap">${esc(G.log || '舰长，下达指令。')}</div>
  </div></div>`;
}

function renderResult() {
  const win = G.result === 'won';
  return `<div class="bg-result">
    <div class="bg-verdict ${win ? 'win' : 'lose'}">${win ? 'VICTORY' : 'DEFEAT'}</div>
    <div class="bg-verdict-sub">${win ? '会战胜利 · 全员归队' : '舰体损毁 · 撤退重整'}</div>
    <button class="bg-btn gold" data-act="deploy-again">${win ? '再战一场 ▸' : '重整出击 ▸'}</button>
  </div>`;
}

// ── 星图（1:1 复刻 SC2 comp 星图.dc.html）+ run 循环 ──
function mapById(id) { return G.run.nodes.find((n) => n.id === id); }
function unlockAdjacent() {
  const map = Object.fromEntries(G.run.nodes.map((n) => [n.id, n]));
  for (const [a, b] of MAP_EDGES) {
    if (map[a].state === 'cleared' && map[b].state === 'locked') map[b].state = 'available';
    if (map[b].state === 'cleared' && map[a].state === 'locked') map[a].state = 'available';
  }
}
function clearNode(id) { const n = mapById(id); if (!n) return; n.state = 'cleared'; G.run.flagAt = id; unlockAdjacent(); }
function nodeGo(id) {
  const n = mapById(id); if (!n || n.state === 'locked') return;
  if (n.type === 'supply') { toast('已补给 · 舰体修复、燃料补充'); clearNode(id); return render(); }
  if (n.type === 'event') { toast('事件：' + (n.rewards?.[0]?.t || '已处理')); clearNode(id); return render(); }
  G.pendingEnemy = nodeEnemyCfg(n); G.run.current = id; G.screen = 'deploy'; render();
}
function returnFromBattle() {
  if (G.run && G.run.current) {
    if (G.result === 'won') clearNode(G.run.current);
    G.run.selected = G.run.current; G.run.current = null; G.pendingEnemy = null;
    G.battle = null; G.result = null; G.screen = 'map'; return render();
  }
  return deploy();
}
function renderMapDetail(n) {
  const fc = FAC[n.fac].color, locked = n.state === 'locked', cleared = n.state === 'cleared';
  const lvl = n.type === 'boss' ? 5 : n.type === 'elite' ? 3 : n.type === 'combat' ? 2 : 1;
  const stars = '★'.repeat(lvl) + '☆'.repeat(5 - lvl);
  const rewards = (n.rewards || []).map((rw) => `<div style="display:flex;align-items:center;gap:11px;padding:10px 12px;background:rgba(10,20,32,.6);border-left:3px solid ${rw.c};border-radius:0 6px 6px 0"><div style="width:22px;height:22px;background-image:url(&quot;${Q(nodeIcon(rw.ic, rw.c))}&quot;);background-size:contain;background-repeat:no-repeat"></div><span style="flex:1;font-size:13px;color:#dce8f4">${esc(rw.t)}</span><span style="font-size:11px;color:${rw.c};letter-spacing:1px">${esc(rw.tag)}</span></div>`).join('');
  const actionLabel = cleared ? '已清剿 · 重新出击' : n.state === 'available' ? (n.type === 'supply' ? '进入港口' : n.type === 'event' ? '进入事件' : '出击') : '🔒 需先清剿前置节点';
  const enemyBlock = n.enemy ? `<div><div style="font-size:11px;letter-spacing:3px;color:#7a93a8;margin-bottom:9px">敌军预览</div><div style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(8,18,30,.7);border:1px solid ${fc}55;border-radius:8px"><div style="width:120px;height:90px;flex:none;background-image:url(&quot;${Q(enemyThumb(fc))}&quot;);background-size:contain;background-repeat:no-repeat;background-position:center;filter:drop-shadow(0 0 12px ${fc}55)"></div><div style="flex:1"><div style="font-weight:700;font-size:15px;color:#ffd9c8">${esc(n.enemy.name)}</div><div style="display:flex;gap:14px;margin-top:6px;font-size:12px"><span style="color:#ff8a6a">HP <span style="font-family:Oxanium;font-weight:800;font-size:15px">${n.enemy.hp}</span></span><span style="color:#9fb6c6">护甲 <span style="font-family:Oxanium;font-weight:800;font-size:15px;color:#cfe6ff">${n.enemy.armor}</span></span></div><div style="margin-top:8px;display:flex;align-items:center;gap:7px;padding:5px 10px;background:rgba(40,16,16,.7);border:1px solid rgba(255,90,60,.4);border-radius:6px;width:fit-content"><span style="width:15px;height:15px;background-image:url(&quot;${Q(nodeIcon('combat', '#ff7a5a'))}&quot;);background-size:contain;background-repeat:no-repeat"></span><span style="font-size:11px;color:#ffb0a0">下回合意图 · ${esc(n.enemy.intent)}</span></div></div></div></div>` : '';
  return `<div style="position:absolute;top:84px;right:28px;width:436px;bottom:24px;background:linear-gradient(160deg,rgba(12,26,42,.9),rgba(8,16,28,.94));border:1px solid rgba(79,214,230,.34);clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);z-index:38;display:flex;flex-direction:column;box-shadow:0 12px 50px rgba(0,0,0,.5),inset 0 0 30px rgba(60,160,200,.08)">
    <div style="padding:18px 20px 16px;border-bottom:1px solid ${fc}33;background:linear-gradient(160deg,${fc}1f,transparent)">
      <div style="display:flex;align-items:center;gap:10px"><span style="width:9px;height:9px;background:${fc};transform:rotate(45deg);box-shadow:0 0 8px ${fc}"></span><span style="font-size:11px;letter-spacing:2px;color:${fc}">${esc(n.region)} · ${esc(FAC[n.fac].name)}</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px"><span style="font-weight:800;font-size:24px;letter-spacing:1px;color:#fff">${esc(n.name)}</span><span style="font-size:11px;font-weight:700;letter-spacing:2px;padding:4px 12px;color:${fc};background:${fc}1a;border:1px solid ${fc};border-radius:4px">${TYPE_META[n.type]}</span></div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:8px"><span style="font-size:11px;color:#8a9aa8;letter-spacing:1px">威胁等级</span><span style="font-size:14px;letter-spacing:2px;color:#ffb86a">${stars}</span></div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:18px"><p style="margin:0;font-size:13px;line-height:1.65;color:#aebfce">${esc(n.desc)}</p>${enemyBlock}<div><div style="font-size:11px;letter-spacing:3px;color:#7a93a8;margin-bottom:9px">清剿奖励</div><div style="display:flex;flex-direction:column;gap:8px">${rewards}</div></div></div>
    <div style="padding:16px 20px;border-top:1px solid rgba(79,214,230,.2)"><button ${locked ? '' : `data-act="node-go" data-id="${n.id}"`} style="width:100%;padding:15px;cursor:${locked ? 'not-allowed' : 'pointer'};font-weight:900;font-size:17px;letter-spacing:3px;clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);background:${locked ? 'rgba(40,48,58,.7)' : 'linear-gradient(180deg,#5fe8c0,#3fd0e0)'};color:${locked ? '#7a8794' : '#06202a'};border:${locked ? '1px solid #4a5560' : '2px solid #d6fff4'};box-shadow:${locked ? 'none' : '0 0 24px rgba(79,230,200,.5)'}">${actionLabel}</button></div>
  </div>`;
}
function renderMap() {
  const r = G.run; STARS = STARS || starfield();
  const map = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  const routes = MAP_EDGES.map(([a, b]) => {
    const A = map[a], B = map[b];
    const cleared = A.state === 'cleared' && (B.state === 'cleared' || B.state === 'available');
    const active = (A.state === 'cleared' || A.state === 'available') && B.state === 'available';
    const stroke = cleared ? '#5fe0ee' : active ? '#ffb86a' : 'rgba(120,150,180,.3)';
    return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${stroke}" stroke-width="${cleared || active ? 2.4 : 1.6}" stroke-dasharray="${cleared ? '0' : '6 8'}" opacity="${cleared || active ? 0.8 : 0.4}"/>`;
  }).join('');
  const nodes = r.nodes.map((n) => {
    const fc = FAC[n.fac].color, avail = n.state === 'available', locked = n.state === 'locked', sel = r.selected === n.id, boss = n.type === 'boss';
    const size = boss ? 96 : avail ? 84 : 72;
    return `<div data-act="node" data-id="${n.id}" style="position:absolute;left:${n.x}px;top:${n.y}px;transform:translate(-50%,-50%);width:${size + 40}px;display:flex;flex-direction:column;align-items:center;cursor:pointer;z-index:${sel ? 20 : 10};opacity:${locked ? 0.62 : 1}">
      <div style="position:absolute;top:${20 - size / 2 + (boss ? 2 : 6)}px;width:${size + 22}px;height:${size + 22}px;border-radius:50%;border:1.5px ${avail ? 'solid' : 'dashed'} ${sel ? '#fff' : fc};opacity:${avail ? 0.9 : 0.5};${avail ? 'animation:ringSpin 14s linear infinite;' : ''}${sel ? `box-shadow:0 0 22px ${fc}` : ''}"></div>
      <div style="width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 40% 35%, ${fc}33, rgba(8,14,24,.95));border:2px solid ${sel ? '#fff' : fc};box-shadow:${avail ? `0 0 30px ${fc}66, inset 0 0 18px ${fc}44` : `0 0 14px ${fc}33`};${avail ? 'animation:nodePulse 2.6s ease-in-out infinite;' : ''}">
        <div style="width:${boss ? 44 : 34}px;height:${boss ? 44 : 34}px;background-image:url(&quot;${Q(nodeIcon(n.type, boss ? '#e8c8ff' : fc))}&quot;);background-size:contain;background-repeat:no-repeat"></div>
      </div>
      <div style="margin-top:10px;font-size:${boss ? 16 : 14}px;font-weight:700;letter-spacing:1px;color:${locked ? '#8a9aa8' : '#eaf4ff'};text-shadow:0 2px 6px rgba(0,0,0,.8);white-space:nowrap">${esc(n.name)}</div>
      <div style="margin-top:3px;font-size:10px;letter-spacing:2px;padding:1px 8px;color:${fc};background:${fc}1a;border:1px solid ${fc}66;border-radius:8px">${TYPE_META[n.type]}</div>
      ${n.state === 'cleared' ? '<div style="position:absolute;top:-6px;right:-6px;width:26px;height:26px;border-radius:50%;background:#0c2a1e;border:1px solid #3ff0a0;color:#7fffc0;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px rgba(63,240,160,.5)">✓</div>' : ''}
      ${locked ? '<div style="position:absolute;top:-4px;right:-4px;font-size:15px;opacity:.85">🔒</div>' : ''}
    </div>`;
  }).join('');
  const fa = map[r.flagAt];
  const flag = `<div style="position:absolute;left:${fa.x + 58}px;top:${fa.y - 58}px;transform:translate(-50%,-50%);width:72px;height:54px;z-index:25;animation:flagFloat 3.4s ease-in-out infinite"><div style="width:72px;height:54px;background-image:url(&quot;${Q(flagSvg)}&quot;);background-size:contain;background-repeat:no-repeat;filter:drop-shadow(0 0 14px rgba(95,224,238,.6))"></div><div style="position:absolute;top:-22px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;letter-spacing:1px;color:#9fe6f4;background:rgba(6,16,26,.8);padding:2px 8px;border-radius:8px;border:1px solid rgba(95,210,235,.4)">旗舰 · 奥德赛号</div></div>`;
  const legend = Object.values(FAC).map((f) => `<div style="display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:1px;color:#b6c6d4"><span style="width:10px;height:10px;background:${f.color};transform:rotate(45deg);box-shadow:0 0 6px ${f.color}"></span>${f.name}</div>`).join('');
  return `<div class="bg-fit"><div class="bg-stage" id="bg-stage">
    <div id="bg-mapwrap" style="position:absolute;inset:0;overflow:hidden;cursor:grab;background:radial-gradient(ellipse 70% 60% at 30% 40%,rgba(40,80,130,.16),transparent 60%),radial-gradient(ellipse 60% 60% at 80% 60%,rgba(120,70,200,.14),transparent 60%),#05070f">
      <div id="bg-map" style="position:absolute;left:0;top:0;width:2600px;height:1320px;transform:translate(${r.pan.x}px,${r.pan.y}px)">
        <div style="position:absolute;left:60px;top:380px;width:560px;height:560px;border-radius:50%;background:radial-gradient(circle,rgba(95,224,238,.12),transparent 70%)"></div>
        <div style="position:absolute;left:760px;top:300px;width:680px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(255,138,74,.1),transparent 70%)"></div>
        <div style="position:absolute;left:1640px;top:300px;width:840px;height:760px;border-radius:50%;background:radial-gradient(circle,rgba(192,123,255,.13),transparent 70%)"></div>
        <div style="position:absolute;left:230px;top:330px;font-size:14px;letter-spacing:8px;color:rgba(95,224,238,.5)">自 由 港 湾</div>
        <div style="position:absolute;left:980px;top:270px;font-size:14px;letter-spacing:8px;color:rgba(255,168,110,.5)">争 议 星 域</div>
        <div style="position:absolute;left:1900px;top:270px;font-size:14px;letter-spacing:8px;color:rgba(200,140,255,.5)">虚 空 回 廊</div>
        <div style="position:absolute;inset:0;background-image:url(&quot;${Q(STARS)}&quot;);opacity:.8;pointer-events:none"></div>
        <svg width="2600" height="1320" style="position:absolute;left:0;top:0;pointer-events:none">${routes}</svg>
        ${nodes}${flag}
      </div>
    </div>
    <div style="position:absolute;top:0;left:0;width:1920px;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:linear-gradient(180deg,rgba(8,16,28,.96),rgba(8,16,28,.2));border-bottom:1px solid rgba(79,214,230,.26);z-index:40;pointer-events:none">
      <div style="display:flex;align-items:center;gap:16px;pointer-events:auto">
        <button data-act="close" style="width:40px;height:40px;border:1px solid rgba(79,214,230,.4);background:rgba(12,30,44,.85);color:#7fd6e6;border-radius:3px;cursor:pointer;font-size:18px">✕</button>
        <div><div style="font-family:Oxanium;font-weight:700;font-size:19px;letter-spacing:3px;color:#d6f3ff;text-shadow:0 0 14px rgba(95,230,255,.45)">星域航图</div><div style="font-size:11px;letter-spacing:3px;color:#5a93ad">星舰协同作战 · 第一章</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;pointer-events:auto;font-size:12px;letter-spacing:1px;color:#9fb6c6">
        <div style="display:flex;align-items:center;gap:8px;padding:7px 14px;background:rgba(8,22,34,.85);border:1px solid rgba(79,214,230,.3);border-radius:3px"><span style="width:7px;height:7px;background:#5fe0ee;transform:rotate(45deg)"></span>跃迁燃料 <span style="font-family:Oxanium;font-weight:800;color:#7fe6ff">8</span>/10</div>
        <div style="display:flex;align-items:center;gap:8px;padding:7px 14px;background:rgba(8,22,34,.85);border:1px solid rgba(255,176,32,.3);border-radius:3px"><span style="width:7px;height:7px;background:#ffd27a;transform:rotate(45deg)"></span>信用点 <span style="font-family:Oxanium;font-weight:800;color:#ffd27a">1,240</span></div>
      </div>
    </div>
    <div style="position:absolute;bottom:24px;left:28px;display:flex;gap:16px;padding:10px 18px;background:rgba(8,16,28,.82);border:1px solid rgba(79,214,230,.22);border-radius:8px;z-index:35">${legend}<div style="width:1px;background:rgba(79,214,230,.2)"></div><span style="font-size:11px;letter-spacing:1px;color:#6a8090">拖动平移星图</span></div>
    ${renderMapDetail(map[r.selected])}
  </div></div>`;
}

// ── 对话界面（1:1 复刻 SC2 comp 对话界面.dc.html）──
const DLG_TAG = { 好感: { color: '#ff6fae', glow: 'rgba(255,111,174,.5)', icon: 'heart' }, 能力: { color: '#4fd6e6', glow: 'rgba(79,214,230,.5)', icon: 'chip' }, 协同: { color: '#ffcc4d', glow: 'rgba(255,204,77,.5)', icon: 'link' } };
const dlgStage = (a) => (a >= 86 ? '羁绊' : a >= 70 ? '心动' : a >= 50 ? '信赖' : '熟识');
const dlgMood = (a) => (a >= 82 ? 'bright' : a >= 70 ? 'blush' : a >= 55 ? 'smile' : 'neutral');
function enterDialogue(artist) {
  G.screen = 'dialogue';
  G.dialogue = { artist, line: '', choices: [], shown: 0, typing: false, loading: true, affinity: 64, floats: [], fid: 0, history: [] };
  render(); fetchDialogue();
}
function exitDialogue() { clearInterval(G._typer); G.screen = 'deploy'; render(); }
async function fetchDialogue() {
  const d = G.dialogue; d.loading = true; render();
  try {
    const r = await fetch('/api/game/dialogue', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId: d.artist.id, name: d.artist.name, affinity: d.affinity, history: d.history }) }).then((x) => x.json());
    if (r.error) throw new Error(r.error.message || '生成失败');
    d.line = r.line || '……'; d.choices = Array.isArray(r.choices) ? r.choices : [];
  } catch {
    d.line = '（通讯受到星云干扰，对面的声音断断续续。）'; d.choices = [{ text: '再试一次', tag: '协同', delta: 0 }];
  }
  if (G.screen !== 'dialogue') return;
  d.loading = false; startType();
}
function startType() {
  clearInterval(G._typer);
  const d = G.dialogue; d.shown = 0; d.typing = true; render();
  G._typer = setInterval(() => {
    if (G.screen !== 'dialogue') return clearInterval(G._typer);
    if (d.shown < d.line.length) { d.shown++; const el = document.getElementById('bg-typed'); if (el) el.textContent = d.line.slice(0, d.shown); }
    else { d.typing = false; clearInterval(G._typer); render(); }
  }, 24);
}
function advanceDialogue() {
  const d = G.dialogue;
  if (d.loading) return;
  if (d.typing) { clearInterval(G._typer); d.shown = d.line.length; d.typing = false; return render(); }
  // 选项驱动推进；无选项时点击 = 再生成一轮
  if (!d.choices.length) { d.history.push('（沉默）'); fetchDialogue(); }
}
function chooseDialogue(idx) {
  const d = G.dialogue, opt = d.choices[idx]; if (!opt) return;
  const meta = DLG_TAG[opt.tag] || DLG_TAG['好感'];
  if (opt.tag === '好感' && opt.delta) d.affinity = Math.min(100, d.affinity + opt.delta);
  if (opt.delta) { const fid = d.fid++; d.floats.push({ id: fid, text: `${opt.tag} +${opt.delta}`, color: meta.color }); setTimeout(() => { if (G.dialogue) { G.dialogue.floats = G.dialogue.floats.filter((f) => f.id !== fid); if (G.screen === 'dialogue') render(); } }, 1500); }
  d.history.push(opt.text);
  fetchDialogue();
}
function renderDialogue() {
  const d = G.dialogue, a = d.artist;
  const isChoice = !d.loading && !d.typing && d.choices.length > 0, stage = dlgStage(d.affinity);
  const portBg = a.portraitUrl ? `background-image:url('${esc(a.portraitUrl)}');background-size:cover;background-position:top center` : `background-image:url(&quot;${Q(dialoguePortrait(dlgMood(d.affinity)))}&quot;);background-size:contain;background-repeat:no-repeat;background-position:bottom center`;
  const avBg = a.portraitUrl ? `background-image:url('${esc(a.portraitUrl)}');background-size:cover` : `background-image:url(&quot;${Q(dialoguePortrait('smile'))}&quot;);background-size:260%;background-position:48% 12%`;
  const opts = isChoice ? d.choices.map((o, i) => { const m = DLG_TAG[o.tag] || DLG_TAG['好感']; return `<button data-act="dlg-choose" data-idx="${i}" style="display:flex;align-items:center;gap:16px;padding:15px 18px 15px 24px;cursor:pointer;background:linear-gradient(110deg,rgba(16,30,48,.92),rgba(10,18,30,.88));border:1px solid rgba(95,210,235,.4);border-left:3px solid ${m.color};clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px));box-shadow:0 6px 20px rgba(0,0,0,.4);animation:optIn .3s ease both"><span style="flex:1;text-align:left;font-size:17px;letter-spacing:.5px;color:#eaf4ff;line-height:1.3">${esc(o.text)}</span><span style="display:flex;align-items:center;gap:7px;flex:none;padding:6px 13px;font-size:13px;font-weight:700;letter-spacing:1px;color:${m.color};background:${m.color}1a;border:1px solid ${m.color};border-radius:14px;box-shadow:0 0 12px ${m.glow}"><span style="width:17px;height:17px;background-image:url(&quot;${Q(tagIcon(m.icon, m.color))}&quot;);background-size:contain;background-repeat:no-repeat"></span>${o.tag}${o.delta ? ' +' + o.delta : ''}</span></button>`; }).join('') : '';
  const bodyText = d.loading ? '正在接通通讯……' : d.line.slice(0, d.shown);
  const floats = d.floats.map((f) => `<div style="position:absolute;right:0;top:0;white-space:nowrap;padding:4px 12px;font-size:14px;font-weight:800;letter-spacing:1px;color:${f.color};background:${f.color}22;border:1px solid ${f.color};border-radius:12px;box-shadow:0 0 16px ${f.color}88;animation:statFloat 1.5s ease-out forwards">${esc(f.text)}</div>`).join('');
  return `<div class="bg-fit"><div class="bg-stage" id="bg-stage" style="background:#06060f">
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 120% 80% at 50% 30%,#181233,#0a0a1c 70%,#06060f)"></div>
    <div style="position:absolute;top:66px;left:54px;right:54px;height:560px;clip-path:polygon(36px 0,calc(100% - 36px) 0,100% 36px,100% calc(100% - 18px),calc(100% - 60px) 100%,60px 100%,0 calc(100% - 18px),0 36px);overflow:hidden;box-shadow:inset 0 0 120px rgba(0,0,0,.7)">
      <div style="position:absolute;inset:-60px;animation:nebDrift 26s ease-in-out infinite;background:radial-gradient(ellipse 42% 52% at 28% 38%,rgba(255,86,148,.55),transparent 62%),radial-gradient(ellipse 50% 44% at 64% 26%,rgba(150,92,255,.5),transparent 62%),radial-gradient(ellipse 46% 56% at 52% 60%,rgba(58,196,214,.34),transparent 62%),radial-gradient(ellipse 32% 34% at 80% 64%,rgba(255,168,92,.34),transparent 60%),#0c0a22"></div>
      <div style="position:absolute;left:11%;top:50%;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle at 36% 32%,#ffd9a8,#e07a4a 46%,#7a2f3a 78%,#2a1230);box-shadow:0 0 60px rgba(255,140,90,.4),inset -12px -10px 30px rgba(0,0,0,.55)"></div>
      <div style="position:absolute;left:8%;top:54%;width:200px;height:46px;border-radius:50%;border:2px solid rgba(255,200,150,.4);transform:rotate(-18deg)"></div>
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(120,200,230,0) 0,rgba(120,200,230,0) 3px,rgba(90,170,210,.04) 4px)"></div>
    </div>
    <div style="position:absolute;top:66px;left:54px;right:54px;height:560px;pointer-events:none;clip-path:polygon(36px 0,calc(100% - 36px) 0,100% 36px,100% calc(100% - 18px),calc(100% - 60px) 100%,60px 100%,0 calc(100% - 18px),0 36px);border:2px solid rgba(95,210,235,.34)"></div>
    <div style="position:absolute;left:0;right:0;top:560px;bottom:0;background:linear-gradient(180deg,rgba(20,16,34,.2),#0a0814 60%)"></div>
    <div style="position:absolute;left:0;right:0;top:560px;height:2px;background:linear-gradient(90deg,transparent,rgba(255,150,110,.4),rgba(95,210,235,.3),transparent)"></div>
    <div style="position:absolute;right:0;bottom:0;width:1100px;height:900px;background:radial-gradient(ellipse 60% 60% at 70% 60%,rgba(255,150,90,.16),transparent 65%);pointer-events:none"></div>
    <div style="position:absolute;right:150px;bottom:-26px;width:720px;height:1060px;${portBg};filter:drop-shadow(0 12px 40px rgba(0,0,0,.6)) drop-shadow(-18px 0 50px rgba(255,150,90,.18));z-index:10"></div>
    <div style="position:absolute;right:300px;bottom:8px;width:560px;height:60px;background:radial-gradient(ellipse 50% 50% at 50% 50%,rgba(0,0,0,.5),transparent 70%)"></div>
    <div style="position:absolute;top:84px;left:78px;display:flex;align-items:center;gap:14px;padding:11px 22px 11px 12px;background:linear-gradient(160deg,rgba(14,22,36,.82),rgba(8,14,24,.78));border:1px solid rgba(95,210,235,.32);clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);box-shadow:0 6px 24px rgba(0,0,0,.45),inset 0 0 20px rgba(60,180,220,.1);z-index:30">
      <div style="width:56px;height:56px;flex:none;border-radius:8px;border:1px solid rgba(255,143,182,.5);${avBg};box-shadow:0 0 16px rgba(255,143,182,.3)"></div>
      <div style="display:flex;flex-direction:column;gap:5px;min-width:236px">
        <div style="display:flex;align-items:baseline;justify-content:space-between"><span style="font-weight:700;font-size:16px;letter-spacing:1px;color:#f3ead8">${esc(a.name)}</span><span style="font-size:11px;letter-spacing:2px;color:#ff8fb6">核心船员</span></div>
        <div style="position:relative;height:9px;background:rgba(8,16,26,.9);border:1px solid rgba(255,143,182,.4);border-radius:5px;overflow:hidden"><div style="height:100%;width:${d.affinity}%;background:linear-gradient(90deg,#ff6fae,#ffb0cf);box-shadow:0 0 12px rgba(255,111,174,.7);transition:width .5s cubic-bezier(.3,.9,.3,1)"></div></div>
        <div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:10px;letter-spacing:2px;color:#9a8aa0">好感度</span><span style="font-size:11px;letter-spacing:1px;color:#ffb0cf;font-weight:700">${stage} · <span style="font-family:Oxanium">${d.affinity}%</span></span></div>
      </div>
      <div style="position:absolute;right:18px;top:-6px">${floats}</div>
    </div>
    <div style="position:absolute;top:84px;right:78px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;z-index:30">
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:2px;color:#7fb6c8"><span style="width:6px;height:6px;background:#ff9a5a;transform:rotate(45deg);box-shadow:0 0 8px #ff9a5a"></span>「奥德赛」号 · 武器甲板 · 休整区</div>
      <button data-act="close-dialogue" style="padding:6px 14px;font-size:12px;letter-spacing:2px;color:#8fd0de;background:rgba(12,24,38,.8);border:1px solid rgba(95,210,235,.3);border-radius:3px;cursor:pointer">‹ 返回编成</button>
    </div>
    ${isChoice ? `<div style="position:absolute;left:120px;bottom:332px;display:flex;flex-direction:column;gap:14px;width:660px;z-index:25">${opts}</div>` : ''}
    <div data-act="dlg-advance" style="position:absolute;left:70px;right:70px;bottom:54px;height:236px;z-index:20;cursor:pointer">
      <div style="position:absolute;top:-26px;left:46px;z-index:6;display:flex;align-items:center;gap:10px;padding:8px 26px;background:linear-gradient(120deg,rgba(255,120,80,.32),rgba(14,24,38,.95));border:1px solid rgba(255,150,110,.55);clip-path:polygon(14px 0,100% 0,calc(100% - 14px) 100%,0 100%);box-shadow:0 4px 16px rgba(0,0,0,.5),0 0 22px rgba(255,140,90,.2)"><span style="width:7px;height:7px;background:#ff9a5a;transform:rotate(45deg);box-shadow:0 0 10px #ff9a5a"></span><span style="font-weight:700;font-size:19px;letter-spacing:2px;color:#ffd9b8;text-shadow:0 0 14px rgba(255,150,90,.5)">${esc(a.name)}</span></div>
      <div style="position:absolute;inset:0;background:linear-gradient(160deg,rgba(14,26,42,.84),rgba(8,14,26,.9));border:1px solid rgba(95,210,235,.36);clip-path:polygon(24px 0,100% 0,100% calc(100% - 24px),calc(100% - 24px) 100%,0 100%,0 24px);box-shadow:inset 0 0 50px rgba(50,150,200,.1),0 10px 40px rgba(0,0,0,.55)"></div>
      <div style="position:absolute;top:40px;left:54px;right:80px;font-size:25px;line-height:1.62;color:#e8f1fb;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.5)"><span id="bg-typed">${esc(bodyText)}</span><span style="color:#5fe0ee;margin-left:2px;animation:caret 1s step-end infinite;opacity:${d.typing ? 1 : 0}">▌</span></div>
      <div style="position:absolute;bottom:18px;right:40px;font-size:14px;letter-spacing:2px;color:#7fd6e6;display:${(!d.loading && !isChoice && !d.typing) ? 'block' : 'none'};animation:contBob 1.3s ease-in-out infinite">▼ 点击继续</div>
    </div>
  </div></div>`;
}

// ─────────── 交互 ───────────
function flashBeam(color) {
  G.beam = { color };
  clearTimeout(G._beamT);
  G._beamT = setTimeout(() => { G.beam = null; if (G.screen === 'battle') render(); }, 720);
}
function apply(next) {
  G.battle = next; G.pending = null;
  if (next.status === 'won' || next.status === 'lost') { G.result = next.status; G.screen = 'result'; }
  render();
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || !view().contains(el)) return;
  const act = el.dataset.act; const id = el.dataset.id;
  if (act === 'close') return closeGame();
  if (act === 'pick') return togglePick(id);
  if (act === 'slot-remove') { G.squad.splice(+el.dataset.idx, 1); return render(); }
  if (act === 'detail') { G.detail = id; return render(); }
  if (act === 'node') { if (!G._moved) { G.run.selected = id; render(); } return; }
  if (act === 'node-go') return nodeGo(id);
  if (act === 'deploy') return deploy();
  if (act === 'deploy-again') return returnFromBattle();
  if (act === 'talk') { const a = G.artists.find((x) => x.id === id); if (a) enterDialogue(a); return; }
  if (act === 'close-dialogue') return exitDialogue();
  if (act === 'dlg-advance') return advanceDialogue();
  if (act === 'dlg-choose') return chooseDialogue(+el.dataset.idx);
  const b = G.battle; if (!b || b.status !== 'active' || b.active !== 'player') return;
  if (act === 'card') return clickCard(id);
  if (act === 'unit') return clickUnit(id);
  if (act === 'foe-unit') return clickFoe(id);
  if (act === 'foe-face') return clickFoe('face');
  if (act === 'hero') { flashBeam('#ffd27a'); return apply(heroPower(b)); }
  if (act === 'endturn') return apply(endTurn(b));
}

function togglePick(idStr) {
  const a = G.artists.find((x) => x.id === idStr); if (!a) return;
  G.detail = idStr;
  if (G.squad.some((x) => x.id === idStr)) return render();      // 已在队 → 仅查看详情
  if (G.squad.length >= 4) { toast('小队已满（最多 4 名）'); return render(); }
  G.squad.push(a); render();
}

function deploy() {
  if (G.squad.length === 0) return toast('至少选 1 名核心船员');
  const cast = G.squad.length ? G.squad : G.artists.slice(0, 2);
  if (!cast.length) return toast('还没有艺人可作为船员');
  G.battle = newBattle({ cards: CARDS, deck: starterDeck(), crew: crewFromCast(cast), enemy: G.pendingEnemy || ENEMIES.海盗前锋, rng: Math.random });
  G.screen = 'battle'; G.pending = null; G.result = null;
  render();
}

function clickCard(iid) {
  const b = G.battle; const card = b.hand.find((c) => c.instanceId === iid); if (!card) return;
  if (!canPlay(b, iid)) return toast('能量不足或无法打出');
  const needs = card.needsTarget === 'enemyUnit';
  if (needs && !b.enemy.board.length) return toast('没有可指定的敌方单位');
  if (G.pending?.kind === 'card' && G.pending.iid === iid) {     // 第二次点同一张 → 打出
    if (needs) return toast('选择一个敌方单位');
    G.log = `打出「${card.name}」 — ${card.text || ''}`;
    if (CATKEY[card.cat] === 'attack') flashBeam(CAT.attack.color);
    return apply(playCard(b, iid));
  }
  G.pending = { kind: 'card', iid, needs: needs ? 'enemyUnit' : null };
  G.log = needs ? `选中「${card.name}」· 点击敌方单位` : `选中「${card.name}」· 再次点击打出`;
  render();
}

function clickUnit(iid) {
  const b = G.battle; const u = b.board.find((x) => x.instanceId === iid);
  if (!u || u.injured || !u.canAct || (u.atk || 0) <= 0) return;
  G.pending = (G.pending?.kind === 'attack' && G.pending.iid === iid) ? null : { kind: 'attack', iid };
  render();
}

function clickFoe(foeId) {
  const b = G.battle; const p = G.pending; if (!p) return;
  if (p.kind === 'attack') { if (!isLegalTarget(b, foeId)) return toast('必须先攻击嘲讽单位'); flashBeam('#5fe6ff'); return apply(attack(b, p.iid, foeId === 'face' ? 'enemyFace' : foeId)); }
  if (p.kind === 'card' && p.needs === 'enemyUnit' && foeId !== 'face') { const card = b.hand.find((c) => c.instanceId === p.iid); if (card && CATKEY[card.cat] === 'attack') flashBeam(CAT.attack.color); return apply(playCard(b, p.iid, { targetId: foeId })); }
}

// ─────────── 接管「故事」入口 ───────────
function hijack() {
  const btn = document.getElementById('openStory');
  if (!btn) return;
  btn.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); openGame(); }, true);
  document.addEventListener('click', onClick);
  document.addEventListener('mousedown', onPanDown);
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', () => { G._panning = false; });
  window.addEventListener('resize', () => { if (G.screen) fit(); });
}
function onPanDown(e) {
  if (G.screen !== 'map' || !G.run) return;
  if (e.target.closest('[data-act="node"]')) { G._moved = false; return; }  // 节点交给 click
  if (!e.target.closest('#bg-mapwrap')) return;
  G._panning = true; G._moved = false;
  G._panStart = { mx: e.clientX, my: e.clientY, px: G.run.pan.x, py: G.run.pan.y };
}
function onPanMove(e) {
  if (!G._panning || !G.run) return;
  const s = G._scale || 1;
  if (Math.abs(e.clientX - G._panStart.mx) + Math.abs(e.clientY - G._panStart.my) > 4) G._moved = true;
  let x = G._panStart.px + (e.clientX - G._panStart.mx) / s;
  let y = G._panStart.py + (e.clientY - G._panStart.my) / s;
  x = Math.max(-(2600 - 1920), Math.min(80, x));
  y = Math.max(-(1320 - 1080), Math.min(60, y));
  G.run.pan = { x, y };
  const m = document.getElementById('bg-map'); if (m) m.style.transform = `translate(${x}px,${y}px)`;
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hijack);
else hijack();
