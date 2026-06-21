// 星舰炉石 · 前端（出战编成 + 战斗界面 + 结算）。引擎在浏览器端运行，无服务器往返。
import { newBattle, canPlay, playCard, attack, endTurn, heroPower } from './engine.js';
import { CARDS, starterDeck, crewFromCast, ENEMIES } from './cards.js';

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
  const body = G.screen === 'battle' ? renderBattle() : G.screen === 'result' ? renderResult() : renderDeploy();
  v.innerHTML = `<div class="bg-wrap">${renderHud()}${body}</div><div class="bg-toast"></div>`;
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

// ── 出战编成 ──
function renderDeploy() {
  const picked = new Set(G.squad.map((a) => a.id));
  const roster = G.artists.length
    ? G.artists.map((a) => `<div class="bg-rtile ${picked.has(a.id) ? 'on' : ''}" data-act="pick" data-id="${esc(a.id)}">
        ${a.portraitUrl ? `<img src="${esc(a.portraitUrl)}" alt="">` : `<span class="ph">${esc((a.name || '?')[0])}</span>`}
        <div class="bg-rname">${esc(a.name || '')}</div></div>`).join('')
    : '<div class="bg-empty">还没有艺人。先到工作台创建艺人，他们会成为你的核心船员。</div>';
  const crew = crewFromCast(G.squad);
  const slots = Array.from({ length: 4 }, (_, i) => {
    const c = crew[i];
    return c
      ? `<div class="bg-slot filled" data-act="detail" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><span class="bg-urole">${esc(c.role)}</span></div>`
      : '<div class="bg-slot">空位</div>';
  }).join('');
  const det = crew.find((c) => c.id === G.detail) || crew[0];
  const detail = det
    ? `<div class="bg-panel bg-detail"><h3>${esc(det.name)}</h3><div class="role">${esc(det.role)} · 核心船员</div>
        <div class="bg-statline"><div class="a"><span class="bg-tag">火力</span><br><b>${det.atk}</b></div><div class="h"><span class="bg-tag">生命</span><br><b>${det.hp}</b></div></div>
        <div class="bg-blurb">${esc(det.blurb || '')}<br><br>负伤退场不会死亡，战斗结束后归队。</div></div>`
    : '<div class="bg-panel bg-detail"><div class="bg-empty">从左侧选入船员（最多 4 名）查看详情。</div></div>';
  const deck = starterDeck();
  const counts = {};
  deck.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
  const deckRows = Object.entries(counts).map(([id, n]) => {
    const c = CARDS[id]; return `<div class="bg-crow"><span class="c">${c.cost}</span><span class="n">${esc(c.name)}</span><span class="t">${esc(c.cat)}${n > 1 ? ' ×' + n : ''}</span></div>`;
  }).join('');
  return `<div class="bg-deploy">
    <div class="bg-col"><div class="bg-colhd">船员名单<small>点选入队 · 最多 4</small></div><div class="bg-roster">${roster}</div></div>
    <div class="bg-col"><div class="bg-colhd">出战小队<small>${G.squad.length}/4</small></div><div class="bg-slots">${slots}</div>${detail}
      <button class="bg-btn gold" data-act="deploy" style="margin-top:auto;align-self:flex-start">⚔ 出战 — 海盗前锋</button></div>
    <div class="bg-col"><div class="bg-colhd">牌库预览<small>固定 ${deck.length} 张</small></div><div class="bg-cardlist">${deckRows}</div></div>
  </div>`;
}

// ── 战斗界面 ──
function unitCard(u, side) {
  const kw = (u.keywords || []).filter((k) => ['嘲讽', '突袭', '光环', '亡语'].includes(k))[0] || '';
  const cls = [side === 'enemy' ? 'enemy' : 'crew'];
  if (u.injured) cls.push('injured');
  if ((u.keywords || []).includes('嘲讽')) cls.push('taunt');
  const b = G.battle, p = G.pending;
  let act = '';
  if (side === 'enemy' && !u.injured) {
    const legalAttack = p?.kind === 'attack' && isLegalTarget(b, u.instanceId);
    const legalCard = p?.kind === 'card' && p.needs === 'enemyUnit';
    if (legalAttack || legalCard) { cls.push('hit'); act = `data-act="foe-unit" data-id="${esc(u.instanceId)}"`; }
  }
  if (side === 'crew' && !u.injured) {
    if (p?.kind === 'attack' && p.iid === u.instanceId) cls.push('sel');
    else if (b.active === 'player' && u.canAct && (u.atk || 0) > 0 && b.status === 'active') { cls.push('can'); }
    act = `data-act="unit" data-id="${esc(u.instanceId)}"`;
  }
  const img = u.portraitUrl ? `<img class="bg-uimg" src="${esc(u.portraitUrl)}" alt="">` : `<div class="bg-uimg">${esc((u.name || '?')[0])}</div>`;
  return `<div class="bg-unit ${cls.join(' ')}" ${act}>
    ${kw ? `<span class="bg-kw">${kw}</span>` : ''}${img}
    <div class="bg-uname">${esc(u.name)}</div>${u.role ? `<div class="bg-urole">${esc(u.role)}</div>` : ''}
    <div class="bg-ustat"><span class="bg-atk">${u.atk}</span><span class="bg-hp">${u.injured ? '负伤' : u.hp}</span></div>
  </div>`;
}

function isLegalTarget(b, foeId) {
  const tn = taunts(b.enemy.board);
  if (foeId === 'face') return tn.length === 0;
  if (tn.length) return tn.some((t) => t.instanceId === foeId);
  return true;
}

function renderBattle() {
  const b = G.battle;
  const p = G.pending;
  const faceHit = p?.kind === 'attack' && isLegalTarget(b, 'face');
  const enemyLine = b.enemy.board.length ? b.enemy.board.map((u) => unitCard(u, 'enemy')).join('') : '<div class="bg-tag">— 无随从 —</div>';
  const crewLine = b.board.length ? b.board.map((u) => unitCard(u, 'crew')).join('') : '<div class="bg-tag">— 无在场单位 —</div>';
  const hand = b.hand.map((c) => {
    const playable = canPlay(b, c.instanceId) && (!c.needsTarget || c.needsTarget !== 'enemyUnit' || b.enemy.board.length > 0);
    const aim = p?.kind === 'card' && p.iid === c.instanceId;
    return `<div class="bg-card ${aim ? 'aim' : playable ? 'play' : 'dim'}" ${playable ? `data-act="card" data-id="${esc(c.instanceId)}"` : ''}>
      <span class="bg-cost">${c.cost}</span><div class="bg-cardname">${esc(c.name)}</div><div class="bg-cardcat">${esc(c.cat || c.type)}</div><div class="bg-cardtext">${esc(c.text || '')}</div></div>`;
  }).join('');
  const crys = Array.from({ length: Math.max(b.energy.max, 10) }, (_, i) =>
    `<span class="bg-cry ${i < b.energy.current ? 'on' : ''}" ${i >= b.energy.max ? 'style="opacity:.25"' : ''}></span>`).join('');
  const hpCan = b.heroPower && !b.heroPowerUsed && (b.heroPower.cost <= b.energy.current);
  return `<div class="bg-battle">
    <div class="bg-enemy">
      <div class="bg-ship ${faceHit ? '' : ''}" ${faceHit ? 'data-act="foe-face"' : ''} style="${faceHit ? 'cursor:crosshair;box-shadow:0 0 0 2px var(--red),0 0 22px rgba(255,90,60,.5)' : ''}"></div>
      <div class="bg-name foe">${esc(b.enemy.name)}</div>
      <div class="bg-shiprow">
        ${hpBar(b.enemy.hp, b.enemy.maxHp, 'foe')}
        ${b.enemy.armor > 0 ? `<span class="bg-badge armor">${b.enemy.armor}</span>` : ''}
      </div>
      <div class="bg-line">${enemyLine}</div>
    </div>
    <div class="bg-line">${crewLine}</div>
  </div>
  <div class="bg-deck">
    <div class="bg-energy"><div class="bg-crys">${crys}</div><div class="bg-elabel">${b.energy.current} / ${b.energy.max}</div>
      ${b.ship.armor > 0 ? `<span class="bg-badge armor" style="width:30px;height:34px;font-size:13px">${b.ship.armor}</span>` : ''}
    </div>
    <div class="bg-hand">${hand}</div>
    <div class="bg-cmd">
      ${hpBar(b.ship.hp, b.ship.maxHp, 'ally', '旗舰')}
      ${hpCan ? `<button class="bg-btn ghost" data-act="hero">${esc(b.heroPower.name)} · ${b.heroPower.cost}</button>` : ''}
      <button class="bg-btn" data-act="endturn">结束回合 ▸</button>
    </div>
  </div>`;
}
function hpBar(hp, max, side, label) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">${label ? `<div class="bg-name ally" style="font-size:13px">${esc(label)}</div>` : ''}
    <div class="bg-hpbar ${side}"><div class="bg-hpfill ${side}" style="transform:scaleX(${pct / 100})"></div><div class="bg-hptext">${Math.max(0, hp)} / ${max}</div></div></div>`;
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
  const i = G.squad.findIndex((x) => x.id === idStr);
  if (i >= 0) G.squad.splice(i, 1);
  else { if (G.squad.length >= 4) return toast('小队已满（最多 4 名）'); G.squad.push(a); G.detail = a.id; }
  render();
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
  if (card.needsTarget === 'enemyUnit') {
    if (!b.enemy.board.length) return toast('没有可指定的敌方单位');
    G.pending = (G.pending?.iid === iid) ? null : { kind: 'card', iid, needs: 'enemyUnit' };
    return render();
  }
  apply(playCard(b, iid));
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
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hijack);
else hijack();
