/* ============================================================
   Star · 全新前端逻辑：对话即界面 + 右栏常驻详情/操作台
   右栏（类 Claude Code / Codex）是唯一的详情与操作界面：
   资料 / 写真 / 视频 / 音乐 / 访谈 / 深访 / 短剧 / 新建艺人 都在这里
   复用现有后端，不再跳转 studio 页。
   ============================================================ */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (url, body, method) => {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  try {
    const res = await fetch(url, opt);
    if (res.status === 401) { location.href = '/login'; return { error: { code: 'unauthorized', message: '会话已过期，请重新登录' } }; }
    return await res.json();
  } catch (e) { return { error: { message: String(e) } }; }
};
let toastTimer;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

const state = { artists: [], current: null, mode: 'chat', busy: false, panel: 'profile', chat: null, gallery: [], creating: false, create: null, createMsgs: [] };

const STAGES = [[0, '陌生'], [20, '初识'], [40, '朋友'], [58, '暧昧'], [75, '恋人'], [92, '灵魂伴侣']];
const stageName = (a) => { let n = '陌生'; STAGES.forEach(([m, s]) => { if ((a || 0) >= m) n = s; }); return n; };
const avatarOf = (a) => (a && a.portraits && a.portraits[0] && a.portraits[0].url) || '';
const renderActs = (text) => esc(text || '')
  .replace(/[（(][^（()）]{0,80}?[）)]/g, (m) => `<span class="act">${m}</span>`)
  .replace(/\*([^*\n]{1,60}?)\*/g, '<span class="act">$1</span>');
const isImg = (u) => /\.(png|jpe?g|webp|gif)$/i.test(u || '');
const isVid = (u) => /\.(mp4|webm|mov)$/i.test(u || '');
const isAud = (u) => /\.(mp3|wav|m4a|aac)$/i.test(u || '');

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
  state.current = a; state.mode = 'chat'; state.chat = null; state.gallery = []; state.creating = false;
  exitMode(); resetDeep();
  $('#convEmpty').hidden = true; $('#conv').hidden = false;
  $('#rpanel').hidden = false;
  setPanel('profile');
  loadArtists();
  renderHead(a, null);
  const ti = $('#threadInner'); ti.innerHTML = '';
  $('#suggest').innerHTML = '';
  const data = await api(`/api/artist/${encodeURIComponent(id)}/chat`);
  if (data.error) return;
  state.chat = data.state;
  renderHead(a, data.state);
  if (state.panel === 'profile') renderPanel();
  const msgs = data.messages || [];
  if (msgs.length) {
    msgs.forEach((m) => addMsg(m.role === 'user' ? 'user' : 'ai', m.content));
  } else {
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
  const aff = st ? st.affinity : (state.chat ? state.chat.affinity : null);
  const tools = HEAD_TOOLS.map((c, i) => `<button class="ch-tool" data-i="${i}" title="${esc(c.title)}"><span class="ch-tool-ic">${c.icon}</span>${esc(c.short)}</button>`).join('');
  const head = $('#convHead');
  head.innerHTML = `
    <button class="ch-id" id="chId" title="查看资料">
      <span class="ch-av">${av ? `<img src="${esc(av)}" alt="">` : '🎭'}</span>
      <span class="ch-idtext"><span class="ch-name">${esc(a.name || '未命名')}</span><span class="ch-meta">${esc(a.persona || a.positioning || '虚拟艺人')}</span></span>
    </button>
    ${aff != null ? `<span class="ch-rel">${esc(stageName(aff))} · ${aff}</span>` : ''}
    <div class="ch-tools">${tools}</div>`;
  $('#chId').addEventListener('click', () => setPanel('profile'));
  head.querySelectorAll('.ch-tool').forEach((b) => b.addEventListener('click', () => setPanel(HEAD_TOOLS[+b.dataset.i].panel)));
  if (!$('#rpanel').hidden) markActiveTool(state.panel);
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

/* ══════════════════════════════════════════
   右栏：视图路由
   ══════════════════════════════════════════ */
const HEAD_TOOLS = [
  { panel: 'photo', icon: '📸', short: '写真', title: '写真' },
  { panel: 'video', icon: '🎬', short: '视频', title: '视频' },
  { panel: 'music', icon: '🎵', short: '音乐', title: '音乐' },
  { panel: 'deepiv', icon: '🎙️', short: '深访', title: '深度访谈' },
  { panel: 'drama', icon: '🎭', short: '短剧', title: '短剧' },
  { panel: 'assets', icon: '🗂️', short: '资产', title: '资产 · 全部作品' },
];
const PANEL_TITLE = { profile: '资料', photo: '写真', video: '视频', music: '音乐', deepiv: '深度访谈', drama: '短剧', assets: '资产', create: '新建艺人' };

function markActiveTool(kind) {
  document.querySelectorAll('.ch-tool').forEach((b) => b.classList.toggle('on', HEAD_TOOLS[+b.dataset.i].panel === kind));
}
function setPanel(kind) {
  state.panel = kind;
  $('#rpanel').hidden = false;
  $('#rpanelTitle').textContent = PANEL_TITLE[kind] || '详情';
  $('#rpanelBack').hidden = (kind === 'profile' || kind === 'create');
  markActiveTool(kind);
  renderPanel();
}
async function renderPanel() {
  const body = $('#rpanelBody');
  const k = state.panel;
  if (k === 'create') return renderCreate(body);
  if (!state.current) { body.innerHTML = '<div class="rp-col"><div class="op-empty">先选择一位艺人</div></div>'; return; }
  if (k === 'profile') return renderProfile(body);
  if (k === 'photo' || k === 'video' || k === 'music') return renderCreator(body, k);
  if (k === 'deepiv') return renderDeepiv(body);
  if (k === 'drama') return renderDrama(body);
  if (k === 'assets') return renderAssets(body);
}

/* 拉取并缓存画廊 */
async function loadGallery() {
  if (!state.current) return [];
  const d = await api(`/api/artist/${encodeURIComponent(state.current.id)}/gallery`);
  state.gallery = (d && d.assets) || [];
  return state.gallery;
}
const galleryBy = (pred) => state.gallery.filter(pred);

/* —— 沉浸式资料页 —— */
function attrRow(k, v) { return v ? `<div class="attr"><div class="attr-k">${esc(k)}</div><div class="attr-v">${esc(v)}</div></div>` : ''; }
async function renderProfile(body) {
  const a = state.current;
  const av = avatarOf(a);
  const aff = state.chat ? state.chat.affinity : null;
  const comp = a.companion || {};
  const calls = [comp.petName ? `Ta 唤你「${comp.petName}」` : '', comp.userCall ? `你称 Ta「${comp.userCall}」` : ''].filter(Boolean).join(' · ');
  const tags = (a.personality || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  body.innerHTML = `<div class="rp-col">
    <div class="profile-hero">
      ${av ? `<img src="${esc(av)}" alt="">` : '<div class="profile-hero-ph">🎭</div>'}
      <div class="profile-hero-grad"></div>
      <button class="hero-edit" id="profEditLook" title="换定妆照">✦ 换定妆照</button>
      <div class="profile-hero-cap">
        <div class="profile-hero-name">${esc(a.name || '未命名')}</div>
        <div class="profile-hero-line">
          ${aff != null ? `<span class="profile-chip rel">${esc(stageName(aff))} · ${aff}</span>` : ''}
          ${a.gender ? `<span class="profile-chip">${esc(a.gender)}</span>` : ''}
          ${a.positioning ? `<span class="profile-chip">${esc(a.positioning)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="look-edit" id="profLookForm" hidden>
      <input id="profLookStyle" type="text" placeholder="新外形描述，如：齐耳银色短发、清冷妆感、米色西装…">
      <div class="look-edit-note">填写即<b>替换 Ta 的「外形」设定</b>（后续写真/视频也会用新外形）；留空＝按现有外形重出一张。</div>
      <div class="look-edit-row">
        <button class="op-gen" id="profLookGen" style="margin-left:0">✦ 生成新定妆照</button>
        <button class="profile-btn" id="profLookCancel" style="flex:0 0 auto;min-width:0">取消</button>
      </div>
      <div class="op-status" id="profLookMsg"></div>
    </div>
    ${a.persona ? `<div class="profile-persona">${esc(a.persona)}</div>` : ''}
    ${tags ? `<div class="profile-section"><div class="profile-section-h">性格</div><div class="tagrow">${tags}</div></div>` : ''}
    <div class="profile-section">
      <div class="profile-section-h">人物设定</div>
      ${attrRow('核心魅力', a.coreAppeal)}
      ${attrRow('说话风格', a.speakingStyle)}
      ${attrRow('声音', a.voiceProfile && a.voiceProfile.description)}
      ${attrRow('外形', a.visualIdentity)}
      ${attrRow('音乐', a.musicStyle)}
      ${attrRow('称呼', calls)}
      ${a.backstory ? `<div class="attr" style="margin-top:11px"><div class="attr-k">背景</div><div class="attr-v">${esc(a.backstory)}</div></div>` : ''}
    </div>
    <div class="profile-section" id="recentWrap" hidden>
      <div class="profile-section-h">最近作品</div>
      <div class="recent-strip" id="recentStrip"></div>
    </div>
    <div class="profile-actions">
      <button class="profile-btn primary" data-go="photo">📸 拍写真</button>
      <button class="profile-btn" data-go="video">🎬 出视频</button>
      <button class="profile-btn" data-go="music">🎵 做音乐</button>
    </div>
  </div>`;
  body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => setPanel(b.dataset.go)));
  // 换定妆照
  $('#profEditLook').addEventListener('click', () => { const f = $('#profLookForm'); f.hidden = !f.hidden; if (!f.hidden) $('#profLookStyle').focus(); });
  $('#profLookCancel').addEventListener('click', () => { $('#profLookForm').hidden = true; });
  $('#profLookGen').addEventListener('click', regenPortrait);
  // 最近作品（异步填充，不阻塞资料渲染）
  const g = await loadGallery();
  const recent = g.filter((x) => isImg(x.url) || isVid(x.url)).slice(0, 8);
  if (recent.length && state.panel === 'profile') {
    $('#recentWrap').hidden = false;
    $('#recentStrip').innerHTML = recent.map((x) => `<div class="rs">${isVid(x.url) ? `<video src="${esc(x.url)}" muted></video>` : `<img src="${esc(x.url)}" alt="" loading="lazy">`}</div>`).join('');
  }
}
/* 换定妆照：重新生成并置为头像（portraits[0]）*/
async function regenPortrait() {
  if (!state.current) return;
  const msg = $('#profLookMsg'); const btn = $('#profLookGen');
  const stylePrompt = ($('#profLookStyle').value || '').trim();
  btn.disabled = true; setMsg(msg, stylePrompt ? '正在按新外形生成定妆照…（约 20 秒）' : '正在重出定妆照…（约 20 秒）', true);
  const r = await api(`/api/artist/${encodeURIComponent(state.current.id)}/portrait`, { stylePrompt, makePrimary: true, overrideLook: !!stylePrompt });
  if (r.error || !(r.artist && r.artist.portraits)) { setMsg(msg, (r.error && r.error.message) || '出图失败', false, true); btn.disabled = false; return; }
  state.current = r.artist;
  const idx = state.artists.findIndex((a) => a.id === r.artist.id); if (idx >= 0) state.artists[idx] = r.artist;
  toast('定妆照已更新 ✨');
  loadArtists(); renderHead(state.current, state.chat);
  if (state.panel === 'profile') renderPanel();   // 重渲染：hero 用新头像
}

/* —— 写真/视频/音乐/访谈：右栏操作台 —— */
const CREATORS = {
  // 只显示真正的「写真」：/photo 出的图无 title；嘉宾形象/主播形象/短剧选角等同为 photo 但都带 title，排除
  photo: { intro: '描述场景、风格与情绪，为 Ta 拍一组写真。', ph: '如：黄昏咖啡馆，暖光，浅景深，胶片质感…', match: (a) => a.type === 'photo' && !a.title, aspect: true },
  video: { intro: '以 Ta 最新写真为首帧生成短视频，描述运镜与动作。', ph: '如：轻轻转头，对镜头微笑，发丝随风…', match: (a) => a.type === 'video' || isVid(a.url) && a.type !== 'interview' && a.type !== 'drama', wide: true },
  music: { intro: '描述一首歌的主题、情绪与曲风，为 Ta 作词作曲。', ph: '如：城市夜晚，慵懒爵士，关于久别重逢…', match: (a) => a.type === 'song' || isAud(a.url) },
};
async function renderCreator(body, kind) {
  const cfg = CREATORS[kind];
  const aspectSeg = cfg.aspect ? `<div class="op-seg" id="opAspect">
      <button data-v="3:4" class="on">竖 3:4</button><button data-v="1:1">方 1:1</button><button data-v="16:9">横 16:9</button>
    </div>` : '';
  body.innerHTML = `<div class="rp-col">
    <p class="op-intro">${esc(cfg.intro)}</p>
    <div class="op-form">
      <textarea id="opInput" rows="3" placeholder="${esc(cfg.ph)}"></textarea>
      <div class="op-row">
        ${aspectSeg}
        <button class="op-gen" id="opGen">✦ 生成${PANEL_TITLE[kind]}</button>
      </div>
      <div class="op-status" id="opStatus"></div>
    </div>
    <div class="op-sub">作品</div>
    <div id="opGrid"></div>
  </div>`;
  if (cfg.aspect) $('#opAspect').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    $('#opAspect').querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
  }));
  $('#opGen').addEventListener('click', () => runCreate(kind));
  await loadGallery();
  paintGrid(kind);
}
function paintGrid(kind) {
  const grid = $('#opGrid'); if (!grid) return;
  const cfg = CREATORS[kind];
  const items = galleryBy(cfg.match);
  if (!items.length) { grid.innerHTML = `<div class="op-empty"><span class="e-mark">✦</span>还没有${PANEL_TITLE[kind]}作品，上面描述一下就能生成</div>`; return; }
  grid.className = 'op-grid';
  grid.innerHTML = items.map((a) => opTile(a, cfg.wide)).join('');
}
function opTile(a, wide) {
  const u = esc(a.url);
  const cap = esc(a.title || a.prompt || '');
  let media;
  if (isVid(a.url)) media = `<video src="${u}" controls preload="metadata"></video>`;
  else if (isAud(a.url)) media = `<audio src="${u}" controls preload="none"></audio>`;
  else media = `<img src="${u}" alt="" loading="lazy">`;
  return `<div class="op-tile${wide ? ' wide' : ''}">${media}${cap ? `<div class="op-tile-cap">${cap}</div>` : ''}</div>`;
}

const setStatus = (msg, busy, err) => {
  const el = $('#opStatus'); if (!el) return;
  el.className = 'op-status' + (err ? ' err' : '');
  el.innerHTML = (busy ? '<span class="spinner"></span>' : '') + esc(msg || '');
};
async function runCreate(kind) {
  if (state.busy) return;
  const input = $('#opInput'); const prompt = (input.value || '').trim();
  if (!prompt) { input.focus(); return; }
  const gen = $('#opGen'); state.busy = true; gen.disabled = true;
  try {
    if (kind === 'photo') {
      const aspect = ($('#opAspect .on') || {}).dataset?.v || '3:4';
      setStatus('正在拍这组写真…', true);
      const r = await api(`/api/artist/${encodeURIComponent(state.current.id)}/photo`, { stylePrompt: prompt, aspect, count: 1 });
      if (r.error || !(r.assets && r.assets[0])) throw new Error((r.error && r.error.message) || '出图失败');
      setStatus('拍好啦 ✨', false);
    } else if (kind === 'video') {
      setStatus('以最新写真为首帧生成视频…', true);
      const r = await api(`/api/artist/${encodeURIComponent(state.current.id)}/video`, { prompt, confirm: true });
      if (r.error) throw new Error(r.error.message || '提交失败');
      await pollJob(r.jobId, (j) => setStatus(`生成视频中… ${j.stage || ''} ${j.progress || 0}%`, true));
      setStatus('影像好啦 ✨', false);
    } else if (kind === 'music') {
      setStatus('作词作曲中…', true);
      const bp = await api(`/api/artist/${encodeURIComponent(state.current.id)}/song/blueprint`, { brief: prompt });
      if (bp.error) throw new Error(bp.error.message || '作曲蓝图失败');
      const r = await api(`/api/artist/${encodeURIComponent(state.current.id)}/song`, { blueprint: bp.blueprint, confirm: true });
      if (r.error) throw new Error(r.error.message || '提交失败');
      await pollJob(r.jobId, (j) => setStatus(`作曲中… ${j.stage || ''} ${j.progress || 0}%`, true));
      setStatus('歌做好啦 ✨', false);
    }
    input.value = '';
    await loadGallery();
    paintGrid(kind);
  } catch (e) {
    setStatus(e.message || '没能完成，请重试', false, true);
  } finally {
    state.busy = false; if ($('#opGen')) $('#opGen').disabled = false;
  }
}

/* ══════════════════════════════════════════
   深度访谈：全流程在右栏（嘉宾名录 → 实时访谈室 → 成片）
   ══════════════════════════════════════════ */
const SHARP_META = {
  1: { label: '温和', desc: '友善正面、轻松随和，给足舒适空间，回避敏感与争议话题。' },
  2: { label: '平和', desc: '常规专业、礼貌中性，稳妥推进，偶有浅层追问。' },
  3: { label: '适中', desc: '有深度、适度追问，专业而平衡，敢于点到争议但不纠缠。' },
  4: { label: '犀利', desc: '直接、不回避争议与矛盾，敢于当面质疑、追问、点出问题与回避。' },
  5: { label: '尖锐', desc: '咄咄逼人、直戳痛点、穷追不舍，逼问真相、不接受空泛或回避的回答。' },
};
const deep = { sub: 'setup', session: null, guestId: null, recording: false, busy: false, ending: false, sharpness: 3 };
function resetDeep() { cleanupRec(); deep.sub = 'setup'; deep.session = null; deep.guestId = null; deep.recording = false; deep.busy = false; deep.ending = false; deep.sharpness = 3; }
const deepBase = () => `/api/artist/${encodeURIComponent(state.current.id)}`;
const sessBase = () => `${deepBase()}/interview2/${encodeURIComponent(deep.session.id)}`;
const guestPortraitUrl = (g) => { const p = g && g.portrait; return (p && p.current >= 0 && p.versions && p.versions[p.current]) ? p.versions[p.current].url : ''; };

/* —— 麦克风 —— */
let _rec = null, _recChunks = [], _recStream = null;
const micSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
async function startRec() {
  if (!micSupported()) { toast('当前环境不支持麦克风录音'); return false; }
  try { _recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('无法访问麦克风，请在浏览器允许权限'); return false; }
  _recChunks = []; _rec = new MediaRecorder(_recStream);
  _rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) _recChunks.push(ev.data); };
  _rec.start(); return true;
}
function stopRec() {
  return new Promise((resolve) => {
    if (!_rec) return resolve(null);
    const rec = _rec, stream = _recStream;
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(_recChunks, { type: rec.mimeType || 'audio/webm' });
      const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(blob);
    };
    _rec = null; _recStream = null; rec.stop();
  });
}
function cleanupRec() {
  try { if (_recStream) _recStream.getTracks().forEach((t) => t.stop()); } catch {}
  try { if (_rec && _rec.state !== 'inactive') { _rec.onstop = null; _rec.stop(); } } catch {}
  _rec = null; _recStream = null; _recChunks = [];
  if (typeof deep !== 'undefined') deep.recording = false;
}
let _clip = null;
function playClip(url) { try { if (_clip) _clip.pause(); } catch {} _clip = new Audio(url); _clip.play().catch(() => {}); return _clip; }
function fileToDataUrl(input) {
  return new Promise((res) => { const f = input.files && input.files[0]; if (!f) return res(null); const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(f); });
}
async function deepSSE(url, body, cb) {
  await sseStream(url, body, (ev, p) => {
    if (ev === 'stage' && cb.onStage) cb.onStage(p);
    else if (ev === 'done' && cb.onDone) cb.onDone(p);
    else if (ev === 'error' && cb.onError) cb.onError(p);
  });
}
/* 成本确认：把确认条渲染进 targetEl，返回 Promise<bool> */
function inlineConfirm(targetEl, text) {
  return new Promise((resolve) => {
    targetEl.innerHTML = `<div class="op-confirm"><span>${esc(text)}</span><div class="op-confirm-btns"><button class="op-confirm-no">取消</button><button class="op-confirm-yes">确认生成</button></div></div>`;
    targetEl.querySelector('.op-confirm-yes').onclick = () => { targetEl.innerHTML = ''; resolve(true); };
    targetEl.querySelector('.op-confirm-no').onclick = () => { targetEl.innerHTML = ''; resolve(false); };
  });
}
const usd = (n) => (typeof n === 'number' ? `约 $${n.toFixed(3)}` : '');

/* —— 视图入口 —— */
async function renderDeepiv(body) {
  if (deep.sub === 'room' && deep.session) return renderDeepRoom(body);
  return renderDeepSetup(body);
}

/* —— 嘉宾名录 / 犀利度 / 历史 —— */
async function renderDeepSetup(body) {
  deep.sub = 'setup';
  body.innerHTML = `<div class="rp-col">
    <p class="op-intro">登记一位真人嘉宾，选好提问犀利度，开始一场实时访谈，最后出对口型影像。</p>
    <div class="op-form">
      <div class="cr-field"><label>嘉宾姓名 *</label><input id="dpName" type="text" placeholder="如：李教授"></div>
      <div class="op-row" style="margin-top:0">
        <div class="cr-field" style="flex:1;margin:0"><label>头衔</label><input id="dpTitle" type="text" placeholder="如：经济学家"></div>
        <div class="cr-field" style="flex:1;margin:0"><label>机构</label><input id="dpCompany" type="text" placeholder="如：某某大学"></div>
      </div>
      <div class="cr-field" style="margin-top:14px"><label>人物简介</label><textarea id="dpPersona" rows="2" placeholder="选填：观点、经历、争议点…"></textarea></div>
      <button class="op-gen" id="dpCreate" style="margin-left:0">＋ 添加嘉宾</button>
      <div class="op-status" id="dpStatus"></div>
    </div>

    <div class="op-sub">提问犀利度</div>
    <div class="dp-sharp" id="dpSharp"></div>
    <div class="dp-sharp-desc" id="dpSharpDesc"></div>

    <div class="op-sub">嘉宾</div>
    <div id="dpGuests"></div>

    <div class="op-sub">历史访谈</div>
    <div id="dpSessions"></div>
  </div>`;
  $('#dpCreate').addEventListener('click', createGuest);
  // 犀利度
  const sharpWrap = $('#dpSharp');
  sharpWrap.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="dp-sharp-btn" data-l="${n}">${n}·${SHARP_META[n].label}</button>`).join('');
  sharpWrap.querySelectorAll('.dp-sharp-btn').forEach((b) => b.addEventListener('click', () => setSharpness(+b.dataset.l)));
  setSharpness(deep.sharpness);
  loadGuests();
  loadSessions();
}
function setSharpness(level) {
  const n = (level >= 1 && level <= 5) ? level : 3;
  deep.sharpness = n;
  const wrap = $('#dpSharp'); if (wrap) wrap.querySelectorAll('.dp-sharp-btn').forEach((b) => b.classList.toggle('on', +b.dataset.l === n));
  const d = $('#dpSharpDesc'); if (d) d.textContent = SHARP_META[n].desc;
}
async function createGuest() {
  const name = ($('#dpName').value || '').trim();
  if (!name) { $('#dpName').focus(); return; }
  const btn = $('#dpCreate'); btn.disabled = true; deepStatus('添加中…', true);
  const r = await api(`${deepBase()}/guests`, { name, title: $('#dpTitle').value.trim(), company: $('#dpCompany').value.trim(), persona: $('#dpPersona').value.trim() });
  btn.disabled = false;
  if (r.error) { deepStatus((r.error.message) || '添加失败', false, true); return; }
  deepStatus('');
  ['#dpName', '#dpTitle', '#dpCompany', '#dpPersona'].forEach((s) => { $(s).value = ''; });
  toast('嘉宾已添加'); loadGuests();
}
const deepStatus = (msg, busy, err) => { const el = $('#dpStatus'); if (!el) return; el.className = 'op-status' + (err ? ' err' : ''); el.innerHTML = (busy ? '<span class="spinner"></span>' : '') + esc(msg || ''); };
async function loadGuests() {
  const grid = $('#dpGuests'); if (!grid) return;
  const data = await api(`${deepBase()}/guests`);
  const guests = (data && data.guests) || [];
  if (!guests.length) { grid.innerHTML = '<div class="op-empty"><span class="e-mark">🎙️</span>还没有嘉宾，上面登记一位</div>'; return; }
  grid.innerHTML = guests.map((g) => {
    const url = guestPortraitUrl(g);
    const meta = [g.title, g.company].filter(Boolean).map(esc).join(' · ');
    return `<div class="dp-guest" data-gid="${esc(g.id)}">
      <div class="dp-guest-av">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : '👤'}</div>
      <div class="dp-guest-body">
        <div class="dp-guest-name">${esc(g.name || '嘉宾')}</div>
        ${meta ? `<div class="dp-guest-meta">${meta}</div>` : ''}
        ${g.persona ? `<div class="dp-guest-persona">${esc(g.persona)}</div>` : ''}
        <div class="dp-guest-actions">
          <button class="dp-mini ai" data-gid="${esc(g.id)}">✦ AI 形象</button>
          <button class="dp-mini up" data-gid="${esc(g.id)}">⤒ 上传</button>
          <input type="file" class="dp-file" data-gid="${esc(g.id)}" accept="image/*" hidden>
          <button class="dp-mini start" data-gid="${esc(g.id)}">▶ 开始访谈</button>
        </div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.dp-mini.ai').forEach((b) => b.addEventListener('click', () => guestPortraitAi(b.dataset.gid, b)));
  grid.querySelectorAll('.dp-mini.up').forEach((b) => b.addEventListener('click', () => grid.querySelector(`.dp-file[data-gid="${b.dataset.gid}"]`).click()));
  grid.querySelectorAll('.dp-file').forEach((inp) => inp.addEventListener('change', () => guestPortraitUpload(inp.dataset.gid, inp)));
  grid.querySelectorAll('.dp-mini.start').forEach((b) => b.addEventListener('click', () => startInterview(b.dataset.gid, b)));
}
async function guestPortraitAi(gid, btn) {
  btn.disabled = true; toast('正在生成 AI 形象…');
  const r = await api(`${deepBase()}/guest/${encodeURIComponent(gid)}/portrait`, { mode: 'ai' });
  btn.disabled = false;
  if (r.error) { toast(r.error.message || '生成失败'); return; }
  toast('AI 形象已生成'); loadGuests();
}
async function guestPortraitUpload(gid, input) {
  const dataUrl = await fileToDataUrl(input); input.value = '';
  if (!dataUrl) { toast('未选择图片'); return; }
  toast('正在上传形象…');
  const r = await api(`${deepBase()}/guest/${encodeURIComponent(gid)}/portrait`, { mode: 'upload', dataUrl });
  if (r.error) { toast(r.error.message || '上传失败'); return; }
  toast('形象已上传'); loadGuests();
}
async function loadSessions() {
  const wrap = $('#dpSessions'); if (!wrap) return;
  const [sData, gData] = await Promise.all([api(`${deepBase()}/interviews`), api(`${deepBase()}/guests`)]);
  const sessions = (sData && sData.sessions) || [];
  if (!sessions.length) { wrap.innerHTML = '<div class="op-empty"><span class="e-mark">🗂️</span>还没有访谈记录</div>'; return; }
  const nameById = {}; ((gData && gData.guests) || []).forEach((g) => { nameById[g.id] = g.name; });
  wrap.innerHTML = sessions.map((s) => {
    const when = s.createdAt ? new Date(s.createdAt).toLocaleString() : '';
    const chips = [];
    if ((s.turns || []).length) chips.push('<span class="dp-chip">文字稿</span>');
    if (s.recordUrl) chips.push('<span class="dp-chip s1">语音</span>');
    if (s.videoUrl) chips.push('<span class="dp-chip ok">对口型</span>');
    return `<button class="dp-session" data-sid="${esc(s.id)}">
      <div><div class="dp-session-name">${esc(nameById[s.guestId] || '嘉宾')}</div><div class="dp-session-date">${esc(when)}</div></div>
      <div class="dp-session-chips">${chips.join('')}</div>
    </button>`;
  }).join('');
  wrap.querySelectorAll('.dp-session').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.sid)));
}
async function openSession(sid) {
  const r = await api(`${deepBase()}/interview2/${encodeURIComponent(sid)}`);
  if (r.error) { toast(r.error.message || '打开失败'); return; }
  deep.session = r.session || r; deep.guestId = deep.session.guestId; deep.sub = 'room';
  renderPanel();
}
async function startInterview(gid, btn) {
  btn.disabled = true;
  toast(`正在以「${SHARP_META[deep.sharpness].label}」犀利度生成访谈提纲…`);
  const r = await api(`${deepBase()}/interview2`, { guestId: gid, sharpness: deep.sharpness });
  btn.disabled = false;
  if (r.error) { toast(r.error.message || '建会话失败'); return; }
  deep.session = r.session; deep.guestId = gid; deep.sub = 'room'; deep.ending = false;
  renderPanel();
}

/* —— 实时访谈室 —— */
async function renderDeepRoom(body) {
  const s = deep.session;
  const done = s.status === 'done';
  body.innerHTML = `<div class="rp-col">
    <button class="dp-back" id="dpBack">‹ 返回名录</button>
    <div class="dp-room-head">
      <div class="dp-room-title" id="dpRoomTitle">访谈室</div>
      <div class="dp-room-meta" id="dpRoomMeta"></div>
      <div class="dp-room-pills">
        <span class="dp-chip ${done ? 'ok' : 's2'}" id="dpStatusPill">${done ? '已结束' : '访谈中'}</span>
        <span class="dp-chip">犀利度 ${esc((SHARP_META[s.sharpness] || SHARP_META[3]).label)}</span>
      </div>
    </div>
    <details class="dp-outline"${done ? '' : ' open'}>
      <summary>访谈提纲</summary>
      <div class="dp-outline-open" id="dpOutlineOpen"></div>
      <ol id="dpOutlineQs"></ol>
    </details>
    <div class="dp-transcript" id="dpTranscript"></div>
    <div class="op-status" id="dpRoomMsg"></div>
    <div class="dp-mic-notice" id="dpMicNotice" hidden>当前环境不支持麦克风录音，无法语音作答。</div>
    <div class="dp-controls" id="dpControls">
      <button class="dp-ctl" id="dpAsk">主持追问</button>
      <button class="dp-ctl rec" id="dpRec"><span id="dpRecLabel">🎤 回答</span></button>
      <button class="dp-ctl end" id="dpEnd">结束访谈</button>
    </div>
    <div class="dp-finish" id="dpFinish" hidden></div>
  </div>`;
  $('#dpBack').addEventListener('click', () => { cleanupRec(); deep.sub = 'setup'; deep.session = null; renderPanel(); });
  $('#dpAsk').addEventListener('click', askNext);
  $('#dpRec').addEventListener('click', toggleRecord);
  $('#dpEnd').addEventListener('click', endInterview);
  // mic guard
  if (!micSupported()) { $('#dpMicNotice').hidden = false; $('#dpRec').disabled = true; }
  // guest name
  if (deep.guestId) api(`${deepBase()}/guest/${encodeURIComponent(deep.guestId)}`).then((r) => {
    if (r.error || !r.guest) return; const g = r.guest;
    $('#dpRoomTitle').textContent = `访谈室 · ${g.name || '嘉宾'}`;
    $('#dpRoomMeta').textContent = [g.title, g.company].filter(Boolean).join(' · ') || (g.persona || '');
  });
  renderOutline(s);
  renderTranscript(s);
  if (done) { $('#dpControls').querySelectorAll('button').forEach((b) => b.disabled = true); $('#dpFinish').hidden = false; renderFinish(s); }
  else if ((s.turns || []).length === 0) askNext();
}
function renderOutline(s) {
  const o = s.outline || { opening: '', questions: [] };
  if ($('#dpOutlineOpen')) $('#dpOutlineOpen').textContent = o.opening || '';
  if ($('#dpOutlineQs')) $('#dpOutlineQs').innerHTML = (o.questions || []).map((q) => `<li>${esc(q)}</li>`).join('');
}
function renderTranscript(s) {
  const wrap = $('#dpTranscript'); if (!wrap) return;
  const turns = (s && s.turns) || [];
  if (!turns.length) { wrap.innerHTML = '<div class="dp-transcript-empty">访谈即将开始，主持人会先说开场白。</div>'; return; }
  wrap.innerHTML = turns.map((t) => {
    const host = t.speaker === 'host';
    const play = t.audioUrl ? `<button class="dp-bubble-play" data-url="${esc(t.audioUrl)}" title="播放">▶</button>` : '';
    return `<div class="dp-bubble-row ${host ? 'host' : 'guest'}"><div class="dp-bubble">
      <div class="dp-bubble-who">${host ? '主持' : '嘉宾'}${play}</div>
      <div class="dp-bubble-text">${esc(t.text || '')}</div>
    </div></div>`;
  }).join('');
  wrap.querySelectorAll('.dp-bubble-play').forEach((b) => b.addEventListener('click', () => playClip(b.dataset.url)));
  wrap.scrollTop = wrap.scrollHeight;
}
function setRoomBusy(busy) {
  deep.busy = busy;
  ['#dpAsk', '#dpEnd'].forEach((s) => { const b = $(s); if (b) b.disabled = busy; });
  const rec = $('#dpRec'); if (rec) rec.disabled = busy || !micSupported();
}
const roomMsg = (msg, busy, err) => { const el = $('#dpRoomMsg'); if (!el) return; el.className = 'op-status' + (err ? ' err' : ''); el.innerHTML = (busy ? '<span class="spinner"></span>' : '') + esc(msg || ''); };
async function askNext() {
  const s = deep.session; if (!s || deep.busy || deep.recording) return;
  setRoomBusy(true); roomMsg('主持人思考中…', true);
  const r = await api(`${sessBase()}/ask`, {});
  setRoomBusy(false);
  if (r.error) { roomMsg(r.error.message || '提问失败', false, true); return; }
  roomMsg('');
  if (r.turn) { s.turns = s.turns || []; s.turns.push(r.turn); renderTranscript(s); if (r.turn.audioUrl) playClip(r.turn.audioUrl); }
}
async function toggleRecord() {
  const s = deep.session; if (!s || deep.busy) return;
  if (!deep.recording) { const ok = await startRec(); if (!ok) return; deep.recording = true; setRecUI(true); return; }
  deep.recording = false; setRecUI(false); setRoomBusy(true); roomMsg('识别语音中…', true);
  const dataUrl = await stopRec();
  if (!dataUrl) { setRoomBusy(false); roomMsg(''); toast('录音失败，请重试'); return; }
  const r = await api(`${sessBase()}/answer`, { audio: dataUrl });
  setRoomBusy(false);
  if (r.error) { roomMsg(r.error.message || '识别失败', false, true); return; }
  roomMsg('');
  if (r.turn) { s.turns = s.turns || []; s.turns.push(r.turn); renderTranscript(s); }
  if (deep.ending) await finalizeClosing(); else await askNext();
}
function setRecUI(recording) {
  const btn = $('#dpRec'), label = $('#dpRecLabel');
  if (btn) btn.classList.toggle('on', recording);
  if (label) label.textContent = recording ? '⏹ 停止并提交' : '🎤 回答';
}
async function endInterview() {
  const s = deep.session; if (!s) return;
  if (deep.recording) { toast('请先停止录音'); return; }
  if (deep.busy) return;
  const turns = s.turns || [];
  const pending = turns.length > 0 && turns[turns.length - 1].speaker === 'host';
  if (pending && !deep.ending) {
    deep.ending = true; roomMsg('请对当前问题作最后回答（🎤），随后主持人致结束语并结束。');
    $('#dpEnd').textContent = '跳过回答 · 直接结束'; return;
  }
  await finalizeClosing();
}
async function finalizeClosing() {
  const s = deep.session; if (!s) return;
  setRoomBusy(true); roomMsg('主持人致结束语…', true);
  const r = await api(`${sessBase()}/end`, {});
  setRoomBusy(false); deep.ending = false;
  if ($('#dpEnd')) $('#dpEnd').textContent = '结束访谈';
  if (r.error) { roomMsg(r.error.message || '结束失败', false, true); return; }
  deep.session = r.session;
  if (r.turn) { renderTranscript(r.session); if (r.turn.audioUrl) playClip(r.turn.audioUrl); }
  roomMsg('');
  $('#dpStatusPill').textContent = '已结束'; $('#dpStatusPill').className = 'dp-chip ok';
  $('#dpControls').querySelectorAll('button').forEach((b) => b.disabled = true);
  $('#dpFinish').hidden = false; renderFinish(r.session);
  toast('访谈已结束');
}

/* —— 成片区：双方形象 / 语音记录 / 对口型影像 —— */
async function refetchSession() {
  const r = await api(`${sessBase()}`);
  if (r.error) return deep.session;
  deep.session = r.session || r; return deep.session;
}
function renderFinish(s) {
  const wrap = $('#dpFinish'); if (!wrap) return;
  const looksReady = !!(s.hostLook && s.guestLook);
  wrap.innerHTML = `
    <div class="dp-fin-block">
      <div class="dp-fin-h">① 双方主播形象</div>
      <div class="dp-looks" id="dpLooks"></div>
      <button class="op-gen" id="dpLooksBtn" style="margin-left:0">${looksReady ? '↻ 重新生成双方形象' : '✦ 生成双方主播形象'}</button>
      <div class="op-status" id="dpLooksMsg"></div>
    </div>
    <div class="dp-fin-block">
      <div class="dp-fin-h">② 语音对谈记录</div>
      <div class="op-row" style="margin-top:0">
        <span class="dp-fin-label">嘉宾配音</span>
        <div class="op-seg" id="dpGuestAudio"><button data-v="ai" class="on">AI 重配</button><button data-v="original">原声</button></div>
        <button class="op-gen" id="dpRecordBtn">✦ 生成语音记录</button>
      </div>
      <div class="op-status" id="dpRecordMsg"></div>
      <div id="dpRecordPlayer"></div>
    </div>
    <div class="dp-fin-block">
      <div class="dp-fin-h">③ 对口型影像</div>
      <div class="dp-fin-hint" id="dpVideoHint">${looksReady ? '双方形象已就绪，需先生成语音记录，再出对口型影像。' : '需先生成并确认双方主播形象。'}</div>
      <button class="op-gen" id="dpVideoBtn" style="margin-left:0"${looksReady ? '' : ' disabled'}>✦ 生成对口型影像</button>
      <div class="op-status" id="dpVideoMsg"></div>
      <div id="dpVideoPlayer"></div>
    </div>`;
  renderLooks(s);
  if (s.recordUrl) $('#dpRecordPlayer').innerHTML = `<audio src="${esc(s.recordUrl)}" controls class="dp-audio"></audio>`;
  if (s.videoUrl) $('#dpVideoPlayer').innerHTML = `<video src="${esc(s.videoUrl)}" controls playsinline class="dp-video"></video>`;
  $('#dpLooksBtn').addEventListener('click', genLooks);
  $('#dpRecordBtn').addEventListener('click', genRecord);
  $('#dpVideoBtn').addEventListener('click', genVideo);
  $('#dpGuestAudio').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { $('#dpGuestAudio').querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }));
}
function renderLooks(s) {
  const wrap = $('#dpLooks'); if (!wrap) return;
  if (s.hostLook && s.guestLook) {
    wrap.innerHTML = `<div class="dp-look"><img src="${esc(s.hostLook)}" alt=""><span>主持人</span></div><div class="dp-look"><img src="${esc(s.guestLook)}" alt=""><span>嘉宾</span></div>`;
  } else wrap.innerHTML = '';
}
async function genLooks() {
  const path = `${sessBase()}/looks`;
  const btn = $('#dpLooksBtn'); const msg = $('#dpLooksMsg');
  btn.disabled = true;
  const est = await api(path, {});
  btn.disabled = false;
  if (est.error && est.error.code === 'confirm_required') {
    const ok = await inlineConfirm(msg, `生成双方主播形象（${usd(est.error.estimate && est.error.estimate.estimatedUsd)}）`);
    if (!ok) return;
  } else if (est.error) { setMsg(msg, est.error.message || '生成失败', false, true); return; }
  btn.disabled = true; setMsg(msg, '正在生成双方主播形象…', true);
  let lastErr = null;
  await deepSSE(path, { confirm: true }, {
    onStage: (p) => setMsg(msg, `${p.msg || '生成中'}… ${p.progress || 0}%`, true),
    onDone: async (p) => { deep.session = (p && p.session) || await refetchSession(); renderLooks(deep.session); setMsg(msg, '双方主播形象已生成 ✨', false); $('#dpVideoHint').textContent = '双方形象已就绪，需先生成语音记录，再出对口型影像。'; toast('双方主播形象已生成'); },
    onError: (p) => { lastErr = p; },
  });
  btn.disabled = false;
  if (lastErr) setMsg(msg, lastErr.message || '形象生成失败', false, true);
}
async function genRecord() {
  const path = `${sessBase()}/record`;
  const btn = $('#dpRecordBtn'); const msg = $('#dpRecordMsg');
  const guestAudio = ($('#dpGuestAudio .on') || {}).dataset?.v || 'ai';
  btn.disabled = true; setMsg(msg, '正在合成语音…', true);
  let lastErr = null;
  await deepSSE(path, { guestAudio }, {
    onStage: (p) => setMsg(msg, `${p.msg || '合成中'}… ${p.progress || 0}%`, true),
    onDone: async (p) => { const sess = await refetchSession(); const url = (sess && sess.recordUrl) || (p && p.url); if (url) $('#dpRecordPlayer').innerHTML = `<audio src="${esc(url)}" controls class="dp-audio"></audio>`; setMsg(msg, '语音记录已生成 ✨', false); toast('语音对谈记录已生成'); },
    onError: (p) => { lastErr = p; },
  });
  btn.disabled = false;
  if (lastErr) setMsg(msg, lastErr.message || '生成失败', false, true);
}
async function genVideo() {
  const path = `${sessBase()}/video`;
  const btn = $('#dpVideoBtn'); const msg = $('#dpVideoMsg');
  btn.disabled = true;
  const est = await api(path, {});
  btn.disabled = false;
  if (est.error && est.error.code === 'confirm_required') {
    const ok = await inlineConfirm(msg, `对口型出片，逐轮生成（${usd(est.error.estimate && est.error.estimate.estimatedUsd)}）`);
    if (!ok) return;
  } else if (est.error) { setMsg(msg, est.error.message || '生成失败', false, true); return; }
  btn.disabled = true; setMsg(msg, '正在生成对口型影像…', true);
  let lastErr = null;
  await deepSSE(path, { confirm: true }, {
    onStage: (p) => setMsg(msg, `${p.msg || '生成中'}… ${p.progress || 0}%`, true),
    onDone: async (p) => { const sess = await refetchSession(); const url = (sess && sess.videoUrl) || (p && p.url); if (url) $('#dpVideoPlayer').innerHTML = `<video src="${esc(url)}" controls playsinline class="dp-video"></video>`; setMsg(msg, '对口型影像已生成 ✨', false); toast('对口型影像已生成'); },
    onError: (p) => { lastErr = p; },
  });
  btn.disabled = false;
  if (lastErr) setMsg(msg, lastErr.message || '影像生成失败', false, true);
}
const setMsg = (el, msg, busy, err) => { if (!el) return; el.className = 'op-status' + (err ? ' err' : ''); el.innerHTML = (busy ? '<span class="spinner"></span>' : '') + esc(msg || ''); };

async function renderDrama(body) {
  body.innerHTML = `<div class="rp-col">
    <div class="op-soon">
      <span class="badge">原生制作台 · 即将上线</span>
      <div class="op-soon-h">短剧 · 剧本 → 选角 → 分镜 → 成片</div>
      <p>多集剧本、选角出图、分镜流水线与连播合集，正在原生重写进这块面板。这一版先把已出的短剧成片放在下面回看。</p>
    </div>
    <div class="op-sub">短剧成片</div>
    <div id="opGrid"></div>
  </div>`;
  await loadGallery();
  const grid = $('#opGrid');
  const items = galleryBy((a) => a.type === 'drama');
  grid.className = 'op-grid';
  grid.innerHTML = items.length ? items.map((a) => opTile(a, true)).join('') : '<div class="op-empty"><span class="e-mark">🎭</span>还没有短剧成片</div>';
}

/* —— 资产：全部生成内容 —— */
const ASSET_FILTERS = [
  { key: 'all', label: '全部', match: () => true },
  { key: 'photo', label: '图片', match: (a) => a.type === 'photo' || isImg(a.url) },
  { key: 'video', label: '视频', match: (a) => a.type === 'video' || (isVid(a.url) && a.type !== 'interview' && a.type !== 'drama') },
  { key: 'song', label: '音乐', match: (a) => a.type === 'song' || isAud(a.url) },
  { key: 'interview', label: '访谈', match: (a) => a.type === 'interview' },
  { key: 'drama', label: '短剧', match: (a) => a.type === 'drama' },
];
const TYPE_BADGE = { photo: '图片', video: '视频', song: '音乐', interview: '访谈', drama: '短剧' };
let _assetFilter = 'all';
async function renderAssets(body) {
  body.innerHTML = `<div class="rp-col">
    <p class="op-intro">这位艺人生成的所有内容——写真、视频、音乐、访谈、短剧、形象照都在这里。</p>
    <div class="asset-filters" id="assetFilters"></div>
    <div id="assetGrid"></div>
  </div>`;
  await loadGallery();
  const fwrap = $('#assetFilters');
  fwrap.innerHTML = ASSET_FILTERS.map((f) => {
    const n = state.gallery.filter(f.match).length;
    return `<button class="asset-fchip${f.key === _assetFilter ? ' on' : ''}" data-k="${f.key}">${f.label}<span class="asset-fn">${n}</span></button>`;
  }).join('');
  fwrap.querySelectorAll('.asset-fchip').forEach((b) => b.addEventListener('click', () => { _assetFilter = b.dataset.k; renderAssets(body); }));
  paintAssetGrid();
}
function paintAssetGrid() {
  const grid = $('#assetGrid'); if (!grid) return;
  const f = ASSET_FILTERS.find((x) => x.key === _assetFilter) || ASSET_FILTERS[0];
  const items = state.gallery.filter(f.match);
  if (!items.length) { grid.innerHTML = '<div class="op-empty"><span class="e-mark">🗂️</span>还没有这一类作品</div>'; return; }
  grid.className = 'op-grid';
  grid.innerHTML = items.map(assetTile).join('');
}
function assetTile(a) {
  const u = esc(a.url);
  const cap = esc(a.title || a.prompt || '');
  const badge = TYPE_BADGE[a.type] || (isVid(a.url) ? '视频' : isAud(a.url) ? '音乐' : '图片');
  let media;
  if (isVid(a.url)) media = `<video src="${u}" controls preload="metadata"></video>`;
  else if (isAud(a.url)) media = `<audio src="${u}" controls preload="none"></audio>`;
  else media = `<img src="${u}" alt="" loading="lazy">`;
  return `<div class="op-tile"><div class="asset-media">${media}<span class="asset-badge">${esc(badge)}</span></div>${cap ? `<div class="op-tile-cap">${cap}</div>` : ''}</div>`;
}

/* ══════════════════════════════════════════
   新建艺人：左栏对话「和星探捏人」，右栏看艺人成形 + 定妆照
   ══════════════════════════════════════════ */
const CREATE_OPENING = '我们一起来捏一位虚拟艺人吧 ✨ 先说说，你想要一位什么气质的 Ta？比如「清冷御姐」「元气邻家少女」「痞帅少年」——也可以直接报个艺名或人设方向。';
function startCreate() {
  state.creating = true; state.current = null; state.mode = 'chat'; state.chat = null; state.gallery = [];
  resetDeep();
  state.create = { phase: 'chat', draft: null, artistId: null, artist: null };
  state.createMsgs = [{ role: 'assistant', content: CREATE_OPENING }];
  loadArtists();
  $('#convEmpty').hidden = true; $('#conv').hidden = false;
  renderCreateHead();
  const ti = $('#threadInner'); ti.innerHTML = ''; $('#suggest').innerHTML = '';
  addMsg('ai', CREATE_OPENING);
  $('#input').placeholder = '描述你想要的艺人…';
  $('#rpanel').hidden = false; setPanel('create');
  $('#input').focus();
}
function renderCreateHead() {
  $('#convHead').innerHTML = `<button class="ch-id" id="chId" title="新建艺人">
    <span class="ch-av">✶</span>
    <span class="ch-idtext"><span class="ch-name">新建艺人</span><span class="ch-meta">和星探聊聊，捏一位你的虚拟艺人</span></span>
  </button>`;
  $('#chId').addEventListener('click', () => setPanel('create'));
}
async function sendCreate(text) {
  addMsg('user', text);
  state.createMsgs.push({ role: 'user', content: text });
  const ph = addMsg('ai', '', true);
  const textEl = ph.querySelector('.msg-text');
  state.busy = true; $('#send').disabled = true;
  let acc = '';
  try {
    await sseStream('/api/artist/interview/stream', { messages: state.createMsgs }, (ev, p) => {
      if (ev === 'token') { acc += p.t; textEl.textContent = acc; scrollDown(); }
      else if (ev === 'done') { textEl.classList.remove('typing'); textEl.innerHTML = renderActs(p.reply || acc); state.createMsgs.push({ role: 'assistant', content: p.reply || acc }); scrollDown(); }
      else if (ev === 'error') { textEl.classList.remove('typing'); textEl.textContent = p.message || '出错了'; }
    });
    if (!acc && !textEl.textContent) { textEl.classList.remove('typing'); textEl.textContent = '（没有回复）'; }
  } catch (e) { textEl.classList.remove('typing'); textEl.textContent = '连接失败：' + e.message; }
  state.busy = false; $('#send').disabled = false;
  if (state.panel === 'create' && state.create.phase === 'chat') renderPanel();   // 解锁「生成档案」
}

/* 右栏：三态——构思中 / 档案草稿 / 已创建（生成定妆照）*/
function renderCreate(body) {
  const c = state.create || { phase: 'chat' };
  if (c.phase === 'created') return renderCreatedPanel(body);
  if (c.phase === 'draft') return renderDraftPanel(body);
  return renderCreateChatPanel(body);
}
function renderCreateChatPanel(body) {
  const canFinalize = state.createMsgs.filter((m) => m.role === 'user').length >= 1;
  body.innerHTML = `<div class="rp-col">
    <div class="op-soon">
      <span class="badge">构思中</span>
      <div class="op-soon-h">和左边的星探聊聊你想要的 Ta</div>
      <p>气质人设、性别、音乐与内容风格、外貌、艺名想法……聊到差不多了，点下面让 AI 把 Ta 的档案生成出来，你还能复核。</p>
    </div>
    <button class="op-gen" id="crFinalize" style="margin-left:0"${canFinalize ? '' : ' disabled'}>✦ 根据对话生成档案</button>
    <div class="op-status" id="crMsg">${canFinalize ? '' : '先和星探聊几句…'}</div>
  </div>`;
  const b = $('#crFinalize'); if (b) b.addEventListener('click', finalizeCreate);
}
async function finalizeCreate() {
  const msg = $('#crMsg'); const btn = $('#crFinalize');
  if (btn) btn.disabled = true; setMsg(msg, '正在生成档案…', true);
  const r = await api('/api/artist/finalize', { transcript: state.createMsgs });
  if (r.error || !r.draft) { setMsg(msg, (r.error && r.error.message) || '生成档案失败', false, true); if (btn) btn.disabled = false; return; }
  state.create.draft = r.draft; state.create.phase = 'draft';
  renderPanel();
}
function draftAttr(k, v) { return v ? `<div class="attr"><div class="attr-k">${esc(k)}</div><div class="attr-v">${esc(v)}</div></div>` : ''; }
function renderDraftPanel(body) {
  const d = state.create.draft || {};
  const tags = (d.personality || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  body.innerHTML = `<div class="rp-col">
    <p class="op-intro">这是星探为你拟的档案草稿，满意就创建；想改可以「继续聊」再生成。</p>
    <div class="draft-card">
      <div class="draft-name">${esc(d.name || '未命名')}</div>
      <div class="profile-hero-line" style="margin-top:8px">
        ${d.gender ? `<span class="tag">${esc(d.gender)}</span>` : ''}
        ${d.positioning ? `<span class="tag">${esc(d.positioning)}</span>` : ''}
      </div>
      ${d.persona ? `<div class="profile-persona" style="margin:14px 0 4px">${esc(d.persona)}</div>` : ''}
      ${tags ? `<div class="tagrow" style="margin-top:10px">${tags}</div>` : ''}
      <div class="profile-section" style="margin-top:16px">
        ${draftAttr('核心魅力', d.coreAppeal)}
        ${draftAttr('说话风格', d.speakingStyle)}
        ${draftAttr('声音', d.voiceProfile && d.voiceProfile.description)}
        ${draftAttr('外形', d.visualIdentity)}
        ${draftAttr('音乐', d.musicStyle)}
        ${d.backstory ? `<div class="attr" style="margin-top:11px"><div class="attr-k">背景</div><div class="attr-v">${esc(d.backstory)}</div></div>` : ''}
      </div>
    </div>
    <div class="profile-actions">
      <button class="profile-btn primary" id="crCreate">✦ 创建这位艺人</button>
      <button class="profile-btn" id="crBack">继续聊</button>
    </div>
    <div class="op-status" id="crMsg"></div>
  </div>`;
  $('#crCreate').addEventListener('click', doCreateFromDraft);
  $('#crBack').addEventListener('click', () => { state.create.phase = 'chat'; renderPanel(); });
}
async function doCreateFromDraft() {
  const msg = $('#crMsg'); const btn = $('#crCreate');
  btn.disabled = true; setMsg(msg, '创建中…', true);
  const r = await api('/api/artist', { profile: state.create.draft });
  if (r.error || !r.id) { setMsg(msg, (r.error && r.error.message) || '创建失败', false, true); btn.disabled = false; return; }
  state.create.phase = 'created'; state.create.artistId = r.id; state.create.artist = r.artist;
  await loadArtists();
  const closing = `🎉 ${r.artist.name} 诞生啦！右边可以给 Ta 拍一张定妆照，或直接进入工作台开始相处。`;
  state.createMsgs.push({ role: 'assistant', content: closing });
  addMsg('ai', closing);
  toast('已创建 ' + r.artist.name);
  renderPanel();
}
function renderCreatedPanel(body) {
  const a = state.create.artist || {};
  const av = avatarOf(a);
  body.innerHTML = `<div class="rp-col">
    <div class="profile-hero">
      ${av ? `<img src="${esc(av)}" alt="">` : '<div class="profile-hero-ph">🎭</div>'}
      <div class="profile-hero-grad"></div>
      <div class="profile-hero-cap"><div class="profile-hero-name">${esc(a.name || '')}</div>
        <div class="profile-hero-line">${a.positioning ? `<span class="profile-chip">${esc(a.positioning)}</span>` : ''}</div></div>
    </div>
    ${a.persona ? `<div class="profile-persona">${esc(a.persona)}</div>` : ''}
    <div class="op-form" style="margin-top:16px">
      <div class="dp-fin-h">✦ 定妆照</div>
      <div class="dp-fin-hint">为 Ta 生成第一张正式形象照（也会成为头像）。</div>
      <input id="crLookStyle" type="text" placeholder="选填：风格/场景，如 影棚柔光、纯色背景…" style="width:100%;border:1px solid var(--line-2);border-radius:11px;background:var(--surface);font-size:14px;color:var(--ink);padding:10px 12px;outline:none">
      <button class="op-gen" id="crPortraitBtn" style="margin-left:0;margin-top:12px">✦ 生成定妆照</button>
      <div class="op-status" id="crPortraitMsg"></div>
      <div id="crPortraitArea"></div>
    </div>
    <div class="profile-actions">
      <button class="profile-btn primary" id="crEnter">进入 Ta 的工作台 →</button>
    </div>
  </div>`;
  $('#crPortraitBtn').addEventListener('click', genCreatePortrait);
  $('#crEnter').addEventListener('click', () => { const id = state.create.artistId; state.creating = false; openArtist(id); });
}
async function genCreatePortrait() {
  const msg = $('#crPortraitMsg'); const btn = $('#crPortraitBtn');
  const stylePrompt = ($('#crLookStyle').value || '').trim();
  btn.disabled = true; setMsg(msg, '正在拍定妆照…', true);
  const r = await api(`/api/artist/${encodeURIComponent(state.create.artistId)}/portrait`, { stylePrompt, makePrimary: true });
  btn.disabled = false;
  if (r.error || !(r.portrait && r.portrait.url)) { setMsg(msg, (r.error && r.error.message) || '出图失败', false, true); return; }
  setMsg(msg, '定妆照好啦 ✨', false);
  state.create.artist = r.artist || state.create.artist;
  $('#crPortraitArea').innerHTML = `<div class="op-tile" style="margin-top:12px"><img src="${esc(r.portrait.url)}" alt=""></div>`;
  // 同步 hero 头像
  const heroImg = document.querySelector('.profile-hero');
  if (heroImg) heroImg.innerHTML = `<img src="${esc(r.portrait.url)}" alt=""><div class="profile-hero-grad"></div><div class="profile-hero-cap"><div class="profile-hero-name">${esc(state.create.artist.name || '')}</div></div>`;
  loadArtists();
}

/* ── 异步任务轮询 / SSE 工具 ── */
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
async function sseStream(url, body, onEvent) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let carry = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    carry += dec.decode(value, { stream: true });
    let i;
    while ((i = carry.indexOf('\n\n')) >= 0) {
      const block = carry.slice(0, i); carry = carry.slice(i + 2);
      const ev = (block.match(/^event: (.*)$/m) || [])[1];
      const dl = (block.match(/^data: (.*)$/m) || [])[1];
      if (!dl) continue;
      onEvent(ev, JSON.parse(dl));
    }
  }
}

/* ── 发送：聊天 或 对话内创作（composer 模式）── */
async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || state.busy) return;
  input.value = ''; autoGrow(); $('#suggest').innerHTML = '';
  if (state.creating) return sendCreate(text);
  if (!state.current) return;
  if (state.mode === 'photo') return createPhotoInline(text);
  if (state.mode === 'video' || state.mode === 'music') return createMediaInline(state.mode, text);
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
        else if (ev === 'done') { textEl.classList.remove('typing'); textEl.innerHTML = renderActs(p.reply || acc); state.chat = p.state; renderHead(state.current, p.state); renderSuggest(p.suggestions); if (state.panel === 'profile') renderPanel(); scrollDown(); }
        else if (ev === 'error') { textEl.classList.remove('typing'); textEl.textContent = (p.message || '出错了'); }
      }
    }
    if (!acc && !textEl.textContent) { textEl.classList.remove('typing'); textEl.textContent = '（没有回复）'; }
  } catch (e) { textEl.classList.remove('typing'); textEl.textContent = '连接失败：' + e.message; }
  state.busy = false; $('#send').disabled = false;
}

/* 对话内出图（写真作为艺术品出现在线程里）*/
async function createPhotoInline(prompt) {
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
    if (state.panel === 'photo') { await loadGallery(); paintGrid('photo'); }
  } else {
    textEl.textContent = '出图失败了：' + ((r.error && r.error.message) || '请重试');
  }
  scrollDown();
}
async function createMediaInline(kind, prompt) {
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
      if (state.panel === kind) { await loadGallery(); paintGrid(kind); }
    } else { textEl.textContent = '生成没成功，再试一次？'; }
  } catch (e) { textEl.classList.remove('typing'); textEl.textContent = '没能完成：' + e.message; }
  state.busy = false; $('#send').disabled = false;
  scrollDown();
}

/* ── 创作菜单（composer 的「＋」：对话内快速创作）── */
const CREATE_MENU = [
  { key: 'photo', icon: '📸', title: '写真', desc: '描述场景，直接在对话里出图' },
  { key: 'video', icon: '🎬', title: '视频', desc: '描述运镜，以最新写真为首帧' },
  { key: 'music', icon: '🎵', title: '音乐', desc: '描述一首歌，为 Ta 作词作曲' },
];
const MODES = {
  photo: { ph: '描述你想要的写真（场景/风格/情绪），回车生成…', hint: '写真模式 · 描述即可出图，再点「＋」退出' },
  video: { ph: '描述运镜与动作（如：轻轻转头浅笑），回车生成…', hint: '视频模式 · 以 Ta 最新写真为首帧，再点「＋」退出' },
  music: { ph: '描述一首歌（主题/情绪/曲风），回车生成…', hint: '音乐模式 · 描述即可作词作曲，再点「＋」退出' },
};
function openCreateMenu() {
  const menu = $('#cmenu');
  menu.innerHTML = CREATE_MENU.map((c) => `<button class="cmenu-item" data-key="${c.key}">
    <span class="cmenu-ic">${c.icon}</span><span class="cmenu-tx"><span class="cmenu-tt">${c.title}</span><span class="cmenu-ds">${c.desc}</span></span>
  </button>`).join('');
  const r = $('#composerPlus').getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.hidden = false;
  menu.style.top = (r.top - menu.getBoundingClientRect().height - 10) + 'px';
  menu.querySelectorAll('.cmenu-item').forEach((b) => b.addEventListener('click', () => { menu.hidden = true; enterMode(b.dataset.key); }));
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

const scrollDown = () => { const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; };
const setHint = (h) => { const el = $('#composerHint'); if (el) el.textContent = h || ''; };

/* ── 初始化 ── */
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }

/* ── 左栏底部·登录用户 ── */
const PROVIDER_LABEL = { google: 'Google 账号', apple: 'Apple 账号', password: '口令登录', oauth: '已登录', local: '已登录' };
async function loadMe() {
  const btn = $('#railUser'); if (!btn) return;
  const me = await api('/api/me');
  if (!me || (!me.email && !me.provider)) { btn.hidden = true; return; } // open 模式/未登录 → 不显示
  const email = me.email || '';
  $('#ruAv').textContent = (email ? email[0] : 'U').toUpperCase();
  $('#ruName').textContent = email ? email.split('@')[0] : '已登录';
  $('#ruSub').textContent = PROVIDER_LABEL[me.provider] || '已登录';
  btn.hidden = false;
  btn.onclick = (e) => { e.stopPropagation(); openUserMenu(me); };
}
function openUserMenu(me) {
  const m = $('#umenu');
  if (!m.hidden) { m.hidden = true; return; }
  const head = me.email
    ? `<div class="umenu-head"><div class="umenu-email">${esc(me.email)}</div><div class="umenu-role">${PROVIDER_LABEL[me.provider] || ''}</div></div>`
    : `<div class="umenu-head"><div class="umenu-email">已登录</div><div class="umenu-role">${PROVIDER_LABEL[me.provider] || ''}</div></div>`;
  m.innerHTML = `${head}<button class="umenu-item" data-act="settings"><span>⚙️</span><span>设置 · API Key</span></button><button class="umenu-item danger" data-act="logout"><span>⎋</span><span>登出</span></button>`;
  m.hidden = false;
  const r = $('#railUser').getBoundingClientRect();
  m.style.left = r.left + 'px';
  m.style.top = 'auto';
  m.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  m.querySelector('[data-act="settings"]').onclick = () => { m.hidden = true; openSettings(); };
  m.querySelector('[data-act="logout"]').onclick = () => { location.href = '/logout'; };
}

/* ── 设置面板（按账号私有：API Key + 健康 + 本周用量 + 能力路由）──
   这是系统设置的唯一入口（原 studio 工作台已废止）。 */
async function openSettings() {
  let ov = $('#sxOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'sxOverlay';
    ov.className = 'sx-overlay';
    ov.innerHTML = `<div class="sx-panel" role="dialog" aria-modal="true">
        <div class="sx-head"><div class="sx-title">设置</div><button class="sx-close" id="sxClose" title="关闭">✕</button></div>
        <div class="sx-acct" id="sxAcct"></div>
        <div class="sx-scroll">
          <div class="sx-sec-title">API Key<span class="sx-usage" id="sxUsage"></span></div>
          <div class="sx-body" id="sxBody">加载中…</div>
          <details class="sx-adv">
            <summary>高级 · 能力路由（JSON）</summary>
            <p class="sx-adv-note">指定每个能力走哪个 Provider/模型与降级链，保存即热生效、无需重启。改错可能导致某能力不可用。</p>
            <textarea class="sx-config" id="sxConfig" spellcheck="false" rows="10" placeholder="加载中…"></textarea>
            <div class="sx-adv-bar"><button class="sx-save" id="sxConfigSave">保存路由</button><span class="sx-adv-msg" id="sxConfigMsg"></span></div>
          </details>
        </div>
        <div class="sx-foot">Key 与路由仅存服务端、按账号私有，只显示末四位。绿点＝该平台用你的 Key 实测在线。</div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.hidden = true; });
    $('#sxClose').onclick = () => { ov.hidden = true; };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) ov.hidden = true; });
  }
  ov.hidden = false;
  renderSettings();
}

async function renderSettings() {
  // 账号
  const me = await api('/api/me');
  const acct = $('#sxAcct');
  if (acct) acct.innerHTML = me && me.email
    ? `<span class="sx-acct-email">${esc(me.email)}</span><span class="sx-acct-note">私有配置仅本账号可见</span>`
    : '';
  // 本周用量（轻量，异步填充）
  api('/api/usage').then((u) => {
    const el = $('#sxUsage');
    if (el && u && !u.error) el.textContent = `本周 $${u.totalUsd}（文本 $${u.textUsd}）`;
  });
  // Key 列表
  const keys = await api('/api/config/keys');
  const body = $('#sxBody');
  if (body) {
    if (!keys || !Array.isArray(keys.keys)) {
      body.innerHTML = '<div class="sx-empty">无法加载 Key 列表</div>';
    } else {
      body.innerHTML = keys.keys.map((k) => `
        <div class="sx-row" data-prov="${esc(k.provider)}">
          <div class="sx-row-info">
            <div class="sx-row-prov">${esc(k.provider)}</div>
            <div class="sx-row-key">${esc(k.key)}</div>
            <div class="sx-row-status${k.configured ? ' ok' : ''}" data-tail="${esc(k.tail)}" data-cfg="${k.configured ? 1 : 0}">${k.configured ? '已配置 ****' + esc(k.tail) : '未配置'}</div>
          </div>
          <input class="sx-input" type="password" data-key="${esc(k.key)}" placeholder="粘贴新 Key 回车保存" autocomplete="off">
        </div>`).join('');
      body.querySelectorAll('input[data-key]').forEach((inp) => {
        inp.addEventListener('keydown', async (e) => {
          if (e.key !== 'Enter' || !inp.value.trim()) return;
          const r = await api('/api/config/keys', { key: inp.dataset.key, value: inp.value.trim() });
          if (r && r.error) { toast((r.error.message) || '保存失败'); return; }
          inp.value = '';
          toast('Key 已保存');
          renderSettings();
        });
      });
      // 健康探测（按你的 Key 实测，可能耗时几秒）→ 异步回填状态
      api('/api/health').then((h) => {
        if (!h || !Array.isArray(h.providers)) return;
        const byLabel = {};
        h.providers.forEach((p) => { byLabel[p.label] = p; });
        document.querySelectorAll('#sxBody .sx-row').forEach((row) => {
          const p = byLabel[row.dataset.prov];
          const st = row.querySelector('.sx-row-status');
          if (!p || !st) return;
          const tail = st.dataset.tail;
          st.classList.remove('ok', 'err');
          if (p.state === 'online') { st.classList.add('ok'); st.textContent = `● 在线${tail ? ' · ****' + tail : ''}`; }
          else if (p.state === 'error') { st.classList.add('err'); st.textContent = '● 连接失败（检查 Key/配额）'; }
          else if (p.state === 'unconfigured') { st.textContent = '未配置'; }
          else { st.textContent = st.dataset.cfg === '1' ? '已配置 · 探测中…' : '未配置'; }
        });
      });
    }
  }
  // 能力路由 JSON
  const cfg = await api('/api/config');
  const ta = $('#sxConfig');
  if (ta && cfg && !cfg.error) ta.value = JSON.stringify(cfg, null, 2);
  const saveBtn = $('#sxConfigSave');
  if (saveBtn && !saveBtn._wired) {
    saveBtn._wired = true;
    saveBtn.onclick = async () => {
      const msg = $('#sxConfigMsg');
      let next;
      try { next = JSON.parse($('#sxConfig').value); }
      catch { if (msg) { msg.textContent = 'JSON 格式错误'; msg.className = 'sx-adv-msg err'; } return; }
      const r = await api('/api/config', next, 'PUT');
      if (r && r.error) { if (msg) { msg.textContent = (r.error.message) || '保存失败'; msg.className = 'sx-adv-msg err'; } return; }
      if (msg) { msg.textContent = '已保存，热生效'; msg.className = 'sx-adv-msg ok'; }
    };
  }
}

function init() {
  $('#newArtist').addEventListener('click', startCreate);
  $('#rpanelBack').addEventListener('click', () => setPanel('profile'));
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
  document.addEventListener('click', (e) => { const m = $('#umenu'); if (m && !m.hidden && !m.contains(e.target) && !$('#railUser').contains(e.target)) m.hidden = true; });
  loadMe();
  loadArtists().then(() => { if (state.artists.length) openArtist(state.artists[0].id); });
}
window.addEventListener('DOMContentLoaded', init);
