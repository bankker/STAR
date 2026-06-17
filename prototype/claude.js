/* ============================================================
   Star · 全新前端逻辑（从空白重写）：对话即界面 + 在对话里创作
   复用现有后端：/api/artists、/chat、/chat/opening、/chat/stream、/photo
   ============================================================ */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (url, body, method) => {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  try { return await (await fetch(url, opt)).json(); } catch (e) { return { error: { message: String(e) } }; }
};
let toastTimer;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const state = { artists: [], current: null, mode: 'chat', busy: false };

const STAGES = [[0, '陌生'], [20, '初识'], [40, '朋友'], [58, '暧昧'], [75, '恋人'], [92, '灵魂伴侣']];
const stageName = (a) => { let n = '陌生'; STAGES.forEach(([m, s]) => { if ((a || 0) >= m) n = s; }); return n; };
const avatarOf = (a) => (a && a.portraits && a.portraits[0] && a.portraits[0].url) || '';
const renderActs = (text) => esc(text || '')
  .replace(/[（(][^（()）]{0,80}?[）)]/g, (m) => `<span class="act">${m}</span>`)
  .replace(/\*([^*\n]{1,60}?)\*/g, '<span class="act">$1</span>');

/* ── 左侧艺人列表 ── */
async function loadArtists() {
  const data = await api('/api/artists');
  state.artists = (data && data.artists) || [];
  const list = $('#artistList');
  if (!state.artists.length) {
    list.innerHTML = '<div class="rail-empty">还没有艺人，点上方「新建艺人」</div>';
    return;
  }
  list.innerHTML = state.artists.map((a) => {
    const av = avatarOf(a);
    return `<button class="artist-row${state.current && a.id === state.current.id ? ' active' : ''}" data-id="${esc(a.id)}">
      <span class="ar-av">${av ? `<img src="${esc(av)}" alt="">` : '🎭'}</span>
      <span class="ar-info"><span class="ar-name">${esc(a.name || '未命名')}</span><span class="ar-sub">${esc(a.persona || a.positioning || '虚拟艺人')}</span></span>
    </button>`;
  }).join('');
  list.querySelectorAll('.artist-row').forEach((b) => b.addEventListener('click', () => openArtist(b.dataset.id)));
}

/* ── 打开某艺人的对话 ── */
async function openArtist(id) {
  const a = state.artists.find((x) => x.id === id);
  if (!a) return;
  state.current = a; state.mode = 'chat';
  $('#convEmpty').hidden = true; $('#conv').hidden = false;
  loadArtists();
  renderHead(a, null);
  setHint('');
  const ti = $('#threadInner'); ti.innerHTML = '';
  $('#suggest').innerHTML = '';
  const data = await api(`/api/artist/${encodeURIComponent(id)}/chat`);
  if (data.error) return;
  renderHead(a, data.state);
  const msgs = data.messages || [];
  if (msgs.length) {
    msgs.forEach((m) => addMsg(m.role === 'user' ? 'user' : 'ai', m.content));
  } else {
    // 角色主动开场白
    const ph = addMsg('ai', '', true);
    const op = await api(`/api/artist/${encodeURIComponent(id)}/chat/opening`, {});
    ph.querySelector('.msg-text').classList.remove('typing');
    if (!op.error && op.opening) { ph.querySelector('.msg-text').innerHTML = renderActs(op.opening); renderSuggest(op.suggestions); }
    else ph.remove();
  }
  scrollDown();
  $('#input').focus();
}

function renderHead(a, st) {
  const av = avatarOf(a);
  const aff = st ? st.affinity : null;
  $('#convHead').innerHTML = `
    <span class="ch-av">${av ? `<img src="${esc(av)}" alt="">` : '🎭'}</span>
    <span><span class="ch-name">${esc(a.name || '未命名')}</span><div class="ch-meta">${esc(a.persona || a.positioning || '虚拟艺人')}</div></span>
    ${aff != null ? `<span class="ch-rel">${esc(stageName(aff))} · ${aff}</span>` : ''}`;
}

/* ── 消息渲染 ── */
function addMsg(role, text, typing) {
  const ti = $('#threadInner');
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  if (role === 'ai') {
    const av = avatarOf(state.current);
    wrap.innerHTML = `<span class="msg-av">${av ? `<img src="${esc(av)}" alt="">` : '🎭'}</span>
      <div class="msg-body"><div class="msg-text${typing ? ' typing' : ''}">${typing ? '' : renderActs(text)}</div></div>`;
  } else {
    wrap.innerHTML = `<div class="msg-body"><div class="msg-text">${esc(text)}</div></div>`;
  }
  ti.appendChild(wrap);
  scrollDown();
  return wrap;
}
function renderSuggest(list) {
  const wrap = $('#suggest');
  if (!list || !list.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = list.map((s) => `<button class="suggest-chip">${esc(s)}</button>`).join('');
  wrap.querySelectorAll('.suggest-chip').forEach((b) => b.addEventListener('click', () => { $('#input').value = b.textContent; wrap.innerHTML = ''; send(); }));
}
const scrollDown = () => { const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; };
const setHint = (h) => { const el = $('#composerHint'); if (el) el.textContent = h || ''; };

/* ── 发送：聊天 或 写真创作（取决于 mode）── */
async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !state.current || state.busy) return;
  input.value = ''; autoGrow(); $('#suggest').innerHTML = '';
  if (state.mode === 'photo') return createPhoto(text);
  // 聊天（流式）
  addMsg('user', text);
  const ph = addMsg('ai', '', true);
  const textEl = ph.querySelector('.msg-text');
  state.busy = true; $('#send').disabled = true;
  try {
    const res = await fetch(`/api/artist/${encodeURIComponent(state.current.id)}/chat/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
    });
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let carry = '', acc = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      carry += dec.decode(value, { stream: true });
      let i;
      while ((i = carry.indexOf('\n\n')) >= 0) {
        const block = carry.slice(0, i); carry = carry.slice(i + 2);
        const ev = (block.match(/^event: (.*)$/m) || [])[1];
        const dl = (block.match(/^data: (.*)$/m) || [])[1];
        if (!dl) continue;
        const p = JSON.parse(dl);
        if (ev === 'token') { acc += p.t; textEl.textContent = acc; scrollDown(); }
        else if (ev === 'done') { textEl.classList.remove('typing'); textEl.innerHTML = renderActs(p.reply || acc); renderHead(state.current, p.state); renderSuggest(p.suggestions); scrollDown(); }
        else if (ev === 'error') { textEl.classList.remove('typing'); textEl.textContent = (p.message || '出错了'); }
      }
    }
    if (!acc && !textEl.textContent) { textEl.classList.remove('typing'); textEl.textContent = '（没有回复）'; }
  } catch (e) { textEl.classList.remove('typing'); textEl.textContent = '连接失败：' + e.message; }
  state.busy = false; $('#send').disabled = false;
}

/* ── 在对话里直接出图：写真作为「艺术品」出现在线程里 ── */
async function createPhoto(prompt) {
  exitPhotoMode();
  addMsg('user', '📸 写真：' + prompt);
  const ph = addMsg('ai', '', true);
  ph.querySelector('.msg-text').textContent = '正在为你拍这组写真…';
  state.busy = true; $('#send').disabled = true;
  const r = await api(`/api/artist/${encodeURIComponent(state.current.id)}/photo`, { stylePrompt: prompt, aspect: '3:4', count: 1 });
  state.busy = false; $('#send').disabled = false;
  const textEl = ph.querySelector('.msg-text');
  textEl.classList.remove('typing');
  const url = r && r.assets && r.assets[0] && r.assets[0].url;
  if (url) {
    textEl.innerHTML = '给你拍好啦 ✨';
    const art = document.createElement('div');
    art.className = 'artifact';
    art.innerHTML = `<img src="${esc(url)}" alt=""><div class="artifact-cap">写真 · 已存入作品库</div>`;
    ph.querySelector('.msg-body').appendChild(art);
  } else {
    textEl.textContent = '出图失败了：' + ((r.error && r.error.message) || '请重试');
  }
  scrollDown();
}

/* ── 创作菜单（composer 的「＋」）── */
const CREATE = [
  { key: 'photo', icon: '📸', title: '写真', desc: '描述场景，直接在对话里出图', inline: true },
  { key: 'video', icon: '🎬', title: '视频', desc: '在工作室生成（即将接入对话）', href: '/studio.html' },
  { key: 'music', icon: '🎵', title: '音乐', desc: '为 Ta 作一首歌', href: '/studio.html' },
  { key: 'interview', icon: '🎙️', title: '访谈', desc: '深度访谈 · 对口型影像', href: '/studio.html' },
  { key: 'drama', icon: '🎞️', title: '短剧', desc: '主演 Ta 的微短剧', href: '/studio.html' },
];
function openCreateMenu() {
  const menu = $('#cmenu');
  menu.innerHTML = CREATE.map((c) => `<button class="cmenu-item" data-key="${c.key}">
    <span class="cmenu-ic">${c.icon}</span><span class="cmenu-tx"><span class="cmenu-tt">${c.title}</span><span class="cmenu-ds">${c.desc}</span></span>
  </button>`).join('');
  const r = $('#composerPlus').getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = (r.top - menu.offsetHeight) + 'px';
  menu.hidden = false;
  // 摆正位置（菜单高度已知后）
  menu.style.top = (r.top - menu.getBoundingClientRect().height - 10) + 'px';
  menu.querySelectorAll('.cmenu-item').forEach((b) => b.addEventListener('click', () => {
    const c = CREATE.find((x) => x.key === b.dataset.key);
    menu.hidden = true;
    if (c.inline) enterPhotoMode();
    else { toast('该工具在「创作工作室」中，正在接入对话…'); window.open(c.href, '_blank'); }
  }));
}
function enterPhotoMode() {
  state.mode = 'photo';
  $('#composerPlus').classList.add('on');
  $('#input').placeholder = '描述你想要的写真（场景/风格/情绪），回车生成…';
  setHint('写真模式 · 直接描述即可出图，再点「＋」可退出');
  $('#input').focus();
}
function exitPhotoMode() {
  state.mode = 'chat';
  $('#composerPlus').classList.remove('on');
  $('#input').placeholder = '对 Ta 说点什么…';
  setHint('');
}

/* ── composer 交互 ── */
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
function init() {
  $('#newArtist').addEventListener('click', () => { window.location.href = '/studio.html'; });
  $('#send').addEventListener('click', send);
  const input = $('#input');
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#composerPlus').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.mode === 'photo') { exitPhotoMode(); return; }
    if ($('#cmenu').hidden) openCreateMenu(); else $('#cmenu').hidden = true;
  });
  document.addEventListener('click', (e) => { const m = $('#cmenu'); if (!m.hidden && !m.contains(e.target) && e.target !== $('#composerPlus')) m.hidden = true; });
  loadArtists().then(() => { if (state.artists.length) openArtist(state.artists[0].id); });
}
window.addEventListener('DOMContentLoaded', init);
