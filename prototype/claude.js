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
  try { return await (await fetch(url, opt)).json(); } catch (e) { return { error: { message: String(e) } }; }
};
let toastTimer;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

const state = { artists: [], current: null, mode: 'chat', busy: false, panel: 'profile', chat: null, gallery: [] };

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
  state.current = a; state.mode = 'chat'; state.chat = null; state.gallery = [];
  exitMode();
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
  { panel: 'interview', icon: '🗞️', short: '访谈', title: '访谈成片' },
  { panel: 'deepiv', icon: '🎙️', short: '深访', title: '深度访谈' },
  { panel: 'drama', icon: '🎭', short: '短剧', title: '短剧' },
];
const PANEL_TITLE = { profile: '资料', photo: '写真', video: '视频', music: '音乐', interview: '访谈成片', deepiv: '深度访谈', drama: '短剧', create: '新建艺人' };

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
  if (k === 'photo' || k === 'video' || k === 'music' || k === 'interview') return renderCreator(body, k);
  if (k === 'deepiv') return renderDeepiv(body);
  if (k === 'drama') return renderDrama(body);
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
      <div class="profile-hero-cap">
        <div class="profile-hero-name">${esc(a.name || '未命名')}</div>
        <div class="profile-hero-line">
          ${aff != null ? `<span class="profile-chip rel">${esc(stageName(aff))} · ${aff}</span>` : ''}
          ${a.gender ? `<span class="profile-chip">${esc(a.gender)}</span>` : ''}
          ${a.positioning ? `<span class="profile-chip">${esc(a.positioning)}</span>` : ''}
        </div>
      </div>
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
  // 最近作品（异步填充，不阻塞资料渲染）
  const g = await loadGallery();
  const recent = g.filter((x) => isImg(x.url) || isVid(x.url)).slice(0, 8);
  if (recent.length && state.panel === 'profile') {
    $('#recentWrap').hidden = false;
    $('#recentStrip').innerHTML = recent.map((x) => `<div class="rs">${isVid(x.url) ? `<video src="${esc(x.url)}" muted></video>` : `<img src="${esc(x.url)}" alt="" loading="lazy">`}</div>`).join('');
  }
}

/* —— 写真/视频/音乐/访谈：右栏操作台 —— */
const CREATORS = {
  photo: { intro: '描述场景、风格与情绪，为 Ta 拍一组写真。', ph: '如：黄昏咖啡馆，暖光，浅景深，胶片质感…', match: (a) => a.type === 'photo' || isImg(a.url), aspect: true },
  video: { intro: '以 Ta 最新写真为首帧生成短视频，描述运镜与动作。', ph: '如：轻轻转头，对镜头微笑，发丝随风…', match: (a) => a.type === 'video' || isVid(a.url) && a.type !== 'interview' && a.type !== 'drama', wide: true },
  music: { intro: '描述一首歌的主题、情绪与曲风，为 Ta 作词作曲。', ph: '如：城市夜晚，慵懒爵士，关于久别重逢…', match: (a) => a.type === 'song' || isAud(a.url) },
  interview: { intro: '一键生成一档访谈节目（企划→脚本→配音合成）。需先有一张写真作画面。', ph: '访谈主题，如：新专辑背后的故事…', match: (a) => a.type === 'interview' && isVid(a.url), wide: true },
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
    } else if (kind === 'interview') {
      await runInterview(prompt);
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

/* 访谈成片：plan → script → compose(SSE) */
async function runInterview(topic) {
  const hasPhoto = state.gallery.some((a) => a.type === 'photo');
  if (!hasPhoto) { const g = await loadGallery(); if (!g.some((a) => a.type === 'photo')) throw new Error('请先到「写真」生成一张作为画面'); }
  const id = encodeURIComponent(state.current.id);
  setStatus('企划访谈提纲…', true);
  const pr = await api(`/api/artist/${id}/interview/plan`, { topic });
  if (pr.error) throw new Error(pr.error.message || '企划失败');
  setStatus('撰写访谈脚本…', true);
  const sr = await api(`/api/artist/${id}/interview/script`, { plan: pr.plan });
  if (sr.error || !(sr.dialogue && sr.dialogue.length)) throw new Error((sr.error && sr.error.message) || '脚本失败');
  setStatus('配音与合成…', true);
  await sseStream(`/api/artist/${id}/interview/compose`, { dialogue: sr.dialogue.slice(0, 30) }, (ev, p) => {
    if (ev === 'stage') setStatus(`${p.msg || '合成中'}… ${p.progress || 0}%`, true);
    else if (ev === 'error') throw new Error(p.message || '合成失败');
  });
  setStatus('访谈成片啦 ✨', false);
}

/* —— 深访 / 短剧：作品列表 + 原生制作台占位 —— */
async function renderDeepiv(body) {
  body.innerHTML = `<div class="rp-col">
    <div class="op-soon">
      <span class="badge">原生制作台 · 即将上线</span>
      <div class="op-soon-h">深度访谈 · 真人嘉宾 · 对口型</div>
      <p>实时麦克风访谈室、嘉宾管理与逐轮对口型影像，正在原生重写进这块面板。这一版先把历史成片放在下面随时回看。</p>
    </div>
    <div class="op-sub">访谈记录与对口型影像</div>
    <div id="opGrid"></div>
  </div>`;
  await loadGallery();
  const grid = $('#opGrid');
  const items = galleryBy((a) => a.type === 'interview');
  grid.className = 'op-grid';
  grid.innerHTML = items.length ? items.map((a) => opTile(a, true)).join('') : '<div class="op-empty"><span class="e-mark">🎙️</span>还没有深度访谈作品</div>';
}
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

/* —— 新建艺人（右栏表单，POST /api/artist）—— */
function renderCreate(body) {
  body.innerHTML = `<div class="rp-col">
    <p class="op-intro">填几项关键设定就能把 Ta 创设出来；之后可以继续在对话里养成。带 * 为必填。</p>
    <div class="cr-field"><label>艺名 *</label><input id="crName" type="text" placeholder="如：陈恩珠"></div>
    <div class="cr-field"><label>性别</label><input id="crGender" type="text" placeholder="如：女 / 男"></div>
    <div class="cr-field"><label>一句话人设</label><input id="crPersona" type="text" placeholder="如：清新邻家、灵动会发光的女孩"></div>
    <div class="cr-field"><label>定位</label><input id="crPos" type="text" placeholder="如：唱跳偶像 / 治愈系歌手"></div>
    <div class="cr-field"><label>性格标签（逗号分隔）</label><input id="crTags" type="text" placeholder="如：温柔, 俏皮, 倔强"></div>
    <div class="cr-field"><label>背景故事</label><textarea id="crBack" rows="3" placeholder="选填：Ta 的来历、梦想、小秘密…"></textarea></div>
    <div class="profile-actions">
      <button class="profile-btn primary" id="crSubmit">✦ 创建艺人</button>
      <button class="profile-btn" id="crCancel">取消</button>
    </div>
    <div class="op-status" id="opStatus"></div>
  </div>`;
  $('#crCancel').addEventListener('click', () => { if (state.current) setPanel('profile'); else { $('#rpanel').hidden = true; } });
  $('#crSubmit').addEventListener('click', createArtist);
  $('#crName').focus();
}
async function createArtist() {
  const name = $('#crName').value.trim();
  if (!name) { $('#crName').focus(); setStatus('请先填艺名', false, true); return; }
  const profile = {
    name,
    gender: $('#crGender').value.trim(),
    persona: $('#crPersona').value.trim(),
    positioning: $('#crPos').value.trim(),
    personality: $('#crTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    backstory: $('#crBack').value.trim(),
  };
  const btn = $('#crSubmit'); btn.disabled = true; setStatus('创建中…', true);
  const r = await api('/api/artist', { profile });
  btn.disabled = false;
  if (r.error || !r.id) { setStatus((r.error && r.error.message) || '创建失败', false, true); return; }
  toast('已创建 ' + name);
  await loadArtists();
  openArtist(r.id);
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
  if (!text || !state.current || state.busy) return;
  input.value = ''; autoGrow(); $('#suggest').innerHTML = '';
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
function init() {
  $('#newArtist').addEventListener('click', () => {
    $('#convEmpty').hidden = state.current ? true : false;
    setPanel('create');
  });
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
  loadArtists().then(() => { if (state.artists.length) openArtist(state.artists[0].id); });
}
window.addEventListener('DOMContentLoaded', init);
