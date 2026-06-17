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
  const tools = HEAD_TOOLS.map((c, i) => `<button class="ch-tool" data-i="${i}" title="${esc(c.title)}"><span class="ch-tool-ic">${c.icon}</span>${esc(c.short)}</button>`).join('');
  const head = $('#convHead');
  head.innerHTML = `
    <span class="ch-av">${av ? `<img src="${esc(av)}" alt="">` : '🎭'}</span>
    <span class="ch-id"><span class="ch-name">${esc(a.name || '未命名')}</span><div class="ch-meta">${esc(a.persona || a.positioning || '虚拟艺人')}</div></span>
    <div class="ch-tools">${tools}</div>
    ${aff != null ? `<span class="ch-rel">${esc(stageName(aff))} · ${aff}</span>` : ''}`;
  head.querySelectorAll('.ch-tool').forEach((b) => b.addEventListener('click', () => {
    const c = HEAD_TOOLS[+b.dataset.i];
    if (c.href) { toast('这个重流程在「创作工作室」完成'); window.open(c.href, '_blank'); return; }
    enterMode(c.act);
  }));
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
/* 对话头部的创作工具条（与 陈恩珠 · 灵魂伴侣100 同一行）*/
const HEAD_TOOLS = [
  { act: 'photo', icon: '📸', short: '写真', title: '写真 · 对话内出图' },
  { act: 'video', icon: '🎬', short: '视频', title: '视频 · 以最新写真为首帧' },
  { act: 'music', icon: '🎵', short: '音乐', title: '音乐 · 描述即作词作曲' },
  { href: '/studio.html', icon: '🗞️', short: '访谈', title: '访谈成片（创作工作室）' },
  { href: '/studio.html', icon: '🎙️', short: '深访', title: '深度访谈（创作工作室）' },
  { href: '/studio.html', icon: '🎭', short: '短剧', title: '短剧（创作工作室）' },
];
const scrollDown = () => { const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; };
const setHint = (h) => { const el = $('#composerHint'); if (el) el.textContent = h || ''; };

/* ── 发送：聊天 或 写真创作（取决于 mode）── */
async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !state.current || state.busy) return;
  input.value = ''; autoGrow(); $('#suggest').innerHTML = '';
  if (state.mode === 'photo') return createPhoto(text);
  if (state.mode === 'video' || state.mode === 'music') return createMedia(state.mode, text);
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
  exitMode();
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

/* ── 在对话里出视频 / 音乐（异步任务：提交 → 轮询 → artifact）── */
async function pollJob(jobId, onProgress) {
  if (!jobId) return null;
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const d = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    const j = d && d.job;
    if (!j) continue;
    if (onProgress) onProgress(j);
    if (j.status === 'done') return (j.result && j.result.files && j.result.files[0] && j.result.files[0].url) || null;
    if (j.status === 'failed' || j.status === 'interrupted') throw new Error((j.error && j.error.message) || j.error || '任务失败');
  }
  throw new Error('生成超时');
}
async function createMedia(kind, prompt) {
  exitMode();
  addMsg('user', (kind === 'video' ? '🎬 视频：' : '🎵 音乐：') + prompt);
  const ph = addMsg('ai', '', true);
  const textEl = ph.querySelector('.msg-text');
  state.busy = true; $('#send').disabled = true;
  try {
    let jobId;
    if (kind === 'video') {
      textEl.textContent = '正在以 Ta 最新写真为首帧生成视频…';
      const r = await api(`/api/artist/${encodeURIComponent(state.current.id)}/video`, { prompt, confirm: true });
      if (r.error) throw new Error(r.error.message || '提交失败');
      jobId = r.jobId;
    } else {
      textEl.textContent = '正在为你作词作曲…';
      const bp = await api(`/api/artist/${encodeURIComponent(state.current.id)}/song/blueprint`, { brief: prompt });
      if (bp.error) throw new Error(bp.error.message || '作曲蓝图失败');
      const r = await api(`/api/artist/${encodeURIComponent(state.current.id)}/song`, { blueprint: bp.blueprint, confirm: true });
      if (r.error) throw new Error(r.error.message || '提交失败');
      jobId = r.jobId;
    }
    const url = await pollJob(jobId, (j) => { textEl.textContent = `${kind === 'video' ? '生成视频' : '作曲'}中… ${j.stage || ''} ${j.progress || 0}%`; });
    textEl.classList.remove('typing');
    if (url) {
      textEl.innerHTML = kind === 'video' ? '影像好啦 ✨' : '歌做好啦 ✨';
      const art = document.createElement('div');
      art.className = 'artifact' + (kind === 'music' ? ' artifact-audio' : '');
      art.innerHTML = (kind === 'video'
        ? `<video src="${esc(url)}" controls playsinline></video>`
        : `<audio src="${esc(url)}" controls></audio>`)
        + `<div class="artifact-cap">${kind === 'video' ? '视频' : '歌曲'} · 已存入作品库</div>`;
      ph.querySelector('.msg-body').appendChild(art);
    } else { textEl.textContent = '生成没成功，再试一次？'; }
  } catch (e) { textEl.classList.remove('typing'); textEl.textContent = '没能完成：' + e.message; }
  state.busy = false; $('#send').disabled = false;
  scrollDown();
}

/* ── 创作菜单（composer 的「＋」）── */
const CREATE = [
  { key: 'photo', icon: '📸', title: '写真', desc: '描述场景，直接在对话里出图', inline: true },
  { key: 'video', icon: '🎬', title: '视频', desc: '描述运镜，以最新写真为首帧', inline: true },
  { key: 'music', icon: '🎵', title: '音乐', desc: '描述一首歌，为 Ta 作词作曲', inline: true },
  { key: 'interview', icon: '🎙️', title: '深度访谈', desc: '真人嘉宾·对口型（在工作室）', href: '/studio.html' },
  { key: 'drama', icon: '🎞️', title: '短剧', desc: '主演 Ta 的微短剧（在工作室）', href: '/studio.html' },
];
const MODES = {
  photo: { ph: '描述你想要的写真（场景/风格/情绪），回车生成…', hint: '写真模式 · 描述即可出图，再点「＋」退出' },
  video: { ph: '描述运镜与动作（如：轻轻转头浅笑），回车生成…', hint: '视频模式 · 以 Ta 最新写真为首帧，再点「＋」退出' },
  music: { ph: '描述一首歌（主题/情绪/曲风），回车生成…', hint: '音乐模式 · 描述即可作词作曲，再点「＋」退出' },
};
function openCreateMenu() {
  const menu = $('#cmenu');
  menu.innerHTML = CREATE.map((c) => `<button class="cmenu-item" data-key="${c.key}">
    <span class="cmenu-ic">${c.icon}</span><span class="cmenu-tx"><span class="cmenu-tt">${c.title}</span><span class="cmenu-ds">${c.desc}</span></span>
  </button>`).join('');
  const r = $('#composerPlus').getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.hidden = false;
  menu.style.top = (r.top - menu.getBoundingClientRect().height - 10) + 'px';
  menu.querySelectorAll('.cmenu-item').forEach((b) => b.addEventListener('click', () => {
    const c = CREATE.find((x) => x.key === b.dataset.key);
    menu.hidden = true;
    if (c.inline) enterMode(c.key);
    else { toast('这个重流程在「创作工作室」完成'); window.open(c.href, '_blank'); }
  }));
}
function enterMode(key) {
  state.mode = key;
  $('#composerPlus').classList.add('on');
  $('#input').placeholder = MODES[key].ph;
  setHint(MODES[key].hint);
  $('#input').focus();
}
function exitMode() {
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
    if (state.mode !== 'chat') { exitMode(); return; }
    if ($('#cmenu').hidden) openCreateMenu(); else $('#cmenu').hidden = true;
  });
  document.addEventListener('click', (e) => { const m = $('#cmenu'); if (!m.hidden && !m.contains(e.target) && e.target !== $('#composerPlus')) m.hidden = true; });
  loadArtists().then(() => { if (state.artists.length) openArtist(state.artists[0].id); });
}
window.addEventListener('DOMContentLoaded', init);
