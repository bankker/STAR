// 星舰炉石 · 前端（出战编成 + 战斗界面 + 结算）。引擎在浏览器端运行，无服务器往返。
import { newBattle, canPlay, playCard, attack, endTurn, heroPower } from './engine.js';
import { CARDS, starterDeck, crewFromCast, ENEMIES, CREW_ROLES, CREW_TRAITS } from './cards.js';
import { CAT, PALETTES, portrait, crack, drone, friendlyDrone, enemyShip, traitIcon, cardArt, starfield, shipSchematic } from './assets.js';

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
  G.screen = 'deploy'; G.squad = []; G.detail = null; G.battle = null; G.pending = null; G.result = null;
  render();
  try {
    const r = await fetch('/api/artists').then((x) => x.json());
    G.artists = (r.artists || []).map((a) => ({ id: a.id, name: a.name, portraitUrl: (a.portraits && a.portraits[0] && a.portraits[0].url) || '' }));
  } catch { G.artists = []; }
  if (G.screen === 'deploy') render();
}
function closeGame() { const v = view(); v.hidden = true; v.classList.remove('bg-root'); v.innerHTML = ''; }

// ─────────── 渲染 ───────────
function render() {
  const v = view();
  if (G.screen === 'battle') { v.innerHTML = renderBattle() + '<div class="bg-toast"></div>'; fit(); return; }
  if (G.screen === 'deploy') { v.innerHTML = renderDeploy() + '<div class="bg-toast"></div>'; fit(); return; }
  v.innerHTML = `<div class="bg-wrap">${renderHud()}${renderResult()}</div><div class="bg-toast"></div>`;
}
function fit() {
  const st = document.getElementById('bg-stage'); if (!st) return;
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  st.style.transform = `scale(${s > 0 ? s : 1})`;
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
      ${d ? `<div style="position:relative;width:300px;flex:none;border-right:1px solid rgba(79,214,230,.2);overflow:hidden;background:radial-gradient(ellipse 80% 70% at 50% 30%,${d.accent}26,rgba(8,16,26,.6))"><div style="position:absolute;inset:0;${dPort}"></div><div style="position:absolute;left:0;right:0;bottom:0;padding:14px 18px;background:linear-gradient(180deg,transparent,rgba(6,14,24,.95))"><div style="font-weight:800;font-size:22px;color:#fff;letter-spacing:1px">${esc(d.name)}</div><div style="font-size:12px;letter-spacing:2px;color:${d.accent};margin-top:2px">${esc(d.role)}</div></div></div>
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
      <div style="padding:14px 18px;border-top:1px solid rgba(79,214,230,.2)"><button data-act="deploy" style="width:100%;display:flex;align-items:center;justify-content:center;gap:12px;padding:15px;cursor:pointer;background:linear-gradient(180deg,#5fe8c0,#3fd0e0);border:2px solid #d6fff4;clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);box-shadow:0 0 26px rgba(79,230,200,.5)"><span style="font-weight:900;font-size:18px;letter-spacing:3px;color:#06202a">确认出战 · 海盗前锋</span><span style="font-size:13px;color:#06202a;opacity:.8">▶</span></button></div>
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
    <div style="position:absolute;top:10px;left:10px;right:10px;height:186px;background-image:url(&quot;${Q(portrait(pal))}&quot;);background-size:cover;background-position:top center;filter:${filter}"></div>
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

// ─────────── 交互 ───────────
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
  if (act === 'deploy' || act === 'deploy-again') return deploy();
  const b = G.battle; if (!b || b.status !== 'active' || b.active !== 'player') return;
  if (act === 'card') return clickCard(id);
  if (act === 'unit') return clickUnit(id);
  if (act === 'foe-unit') return clickFoe(id);
  if (act === 'foe-face') return clickFoe('face');
  if (act === 'hero') return apply(heroPower(b));
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
  if (G.screen !== 'result' && G.squad.length === 0) return toast('至少选 1 名核心船员');
  const cast = G.squad.length ? G.squad : G.artists.slice(0, 2);
  if (!cast.length) return toast('还没有艺人可作为船员');
  G.battle = newBattle({ cards: CARDS, deck: starterDeck(), crew: crewFromCast(cast), enemy: ENEMIES.海盗前锋, rng: Math.random });
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
  if (p.kind === 'attack') { if (!isLegalTarget(b, foeId)) return toast('必须先攻击嘲讽单位'); return apply(attack(b, p.iid, foeId === 'face' ? 'enemyFace' : foeId)); }
  if (p.kind === 'card' && p.needs === 'enemyUnit' && foeId !== 'face') return apply(playCard(b, p.iid, { targetId: foeId }));
}

// ─────────── 接管「故事」入口 ───────────
function hijack() {
  const btn = document.getElementById('openStory');
  if (!btn) return;
  btn.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); openGame(); }, true);
  document.addEventListener('click', onClick);
  window.addEventListener('resize', () => { if (G.screen === 'battle') fit(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hijack);
else hijack();
