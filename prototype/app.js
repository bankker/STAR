/* ========================================================
   AI Star Studio — P1 Frontend
   Vanilla JS, zero deps. All backend endpoints preserved.
   ======================================================== */

/* ── Helpers ── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ error: { code: 'bad_response', message: `HTTP ${res.status}` } }));
}

function errText(err) {
  let s = `[${err.code}] ${err.message}`;
  if (err.hint) s += `（${err.hint}）`;
  if (err.attempts)
    s += '\n' + err.attempts.map((a) => `· ${a.provider}: [${a.code}] ${a.message}`).join('\n');
  return s;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── App State ── */
const state = {
  currentView: 'artist-creation',
  currentArtistId: null,
  artists: [],
  interviewHistory: [],
  chatArtistId: null,
  confirmOpen: false,
};

/* ── View Router ── */
const VIEW_TITLES = {
  'artist-creation': '艺人创设',
  'dashboard': '仪表盘',
  'companion': '对话陪伴',
  'photo-video': '写真/视频',
  'music': '音乐工坊',
  'interview': '访谈成片',
  'drama': '短剧工坊',
  'deepiv': '深度访谈',
  'health': '能力健康',
  'cost': '成本账本',
  'settings': '设置',
  'design-system': '设计系统',
};

function switchView(viewId) {
  // hide all views
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const el = $(`#view-${viewId}`);
  if (el) el.classList.remove('hidden');

  // update nav active state
  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  const navItem = $(`.nav-item[data-view="${viewId}"]`);
  if (navItem) navItem.classList.add('active');

  // update breadcrumb
  const title = VIEW_TITLES[viewId] || viewId;
  $('#topbar-title').textContent = title;

  state.currentView = viewId;

  // trigger view-specific data loads
  if (viewId === 'health') renderHealth();
  if (viewId === 'cost') { renderUsage(); renderCostJobs(); }
  if (viewId === 'settings') { renderKeys(); renderRoutes(); }
  if (viewId === 'dashboard') renderDashboard();
  if (viewId === 'companion') renderCompanionView();
  if (viewId === 'artist-creation') renderArtists();
  if (viewId === 'photo-video') { updatePhotoArtistCard(); loadGallery(); }
  if (viewId === 'music') {
    const noArtist = $('#music-no-artist');
    const studioArea = $('#music-studio-area');
    if (state.currentArtistId) {
      if (noArtist) noArtist.classList.add('hidden');
      if (studioArea) studioArea.classList.remove('hidden');
      loadMusicLibrary();
    } else {
      if (noArtist) noArtist.classList.remove('hidden');
      if (studioArea) studioArea.classList.add('hidden');
    }
  }
  if (viewId === 'interview') {
    const noArtist = $('#interview-no-artist');
    const studioArea = $('#interview-studio-area');
    if (state.currentArtistId) {
      if (noArtist) noArtist.classList.add('hidden');
      if (studioArea) studioArea.classList.remove('hidden');
      loadInterviewLibrary();
    } else {
      if (noArtist) noArtist.classList.remove('hidden');
      if (studioArea) studioArea.classList.add('hidden');
    }
  }
  if (viewId === 'drama') {
    const noArtist = $('#drama-no-artist');
    const studioArea = $('#drama-studio-area');
    if (state.currentArtistId) {
      if (noArtist) noArtist.classList.add('hidden');
      if (studioArea) studioArea.classList.remove('hidden');
      enterDramaProjectList();
    } else {
      if (noArtist) noArtist.classList.remove('hidden');
      if (studioArea) studioArea.classList.add('hidden');
    }
  }
  if (viewId === 'deepiv') {
    const noArtist = $('#deepiv-no-artist');
    const studioArea = $('#deepiv-studio-area');
    if (state.currentArtistId) {
      if (noArtist) noArtist.classList.add('hidden');
      if (studioArea) studioArea.classList.remove('hidden');
      enterDeepivSetup();
    } else {
      if (noArtist) noArtist.classList.remove('hidden');
      if (studioArea) studioArea.classList.add('hidden');
    }
  }
}

function initRouter() {
  $$('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });
  // dashboard entry cards
  $$('.entry-card[data-view]').forEach((card) => {
    card.addEventListener('click', () => switchView(card.dataset.view));
  });
}

/* ── Provider Status Bar ── */
const STATE_LABEL = {
  online: '在线',
  error: '故障',
  unconfigured: '未接入',
  unknown: '探测中',
};

function updateProviderBar(providers) {
  if (!Array.isArray(providers)) return;
  const segs = $$('#provider-segments .seg');
  let configured = 0;
  providers.forEach((p, i) => {
    const seg = segs[i];
    if (!seg) return;
    seg.className = 'seg';
    if (p.state === 'online') { seg.classList.add('ok'); configured++; }
    else if (p.state === 'error') seg.classList.add('err');
    else if (p.state === 'unconfigured') seg.classList.add('warn');
    else seg.classList.add('unknown');
  });
  $('#providers-count').textContent = `${configured} / ${providers.length} 已配置`;
  const keyless = configured === 0;
  $('#keyless-badge').classList.toggle('hidden', !keyless);
}

/* ── Health View ── */
async function renderHealth(refresh) {
  const data = await api('/api/health' + (refresh ? '?refresh=1' : ''));
  if (data.error || !Array.isArray(data.providers)) return;

  updateProviderBar(data.providers);

  // update sidebar segment counts for dashboard too
  const onlineCount = data.providers.filter((p) => p.state === 'online').length;
  $('#dash-providers').textContent = `${onlineCount} / ${data.providers.length}`;

  const grid = $('#health-grid');
  if (!grid) return;
  grid.innerHTML = data.providers
    .map((p) => {
      const dotClass =
        p.state === 'online' ? 'ok' :
        p.state === 'error' ? 'err' :
        p.state === 'unconfigured' ? 'warn' : 'dim';
      const pillClass =
        p.state === 'online' ? 'ok' :
        p.state === 'error' ? '' :
        p.state === 'unconfigured' ? 'warn' : 'dim';
      const pillStyle =
        p.state === 'error'
          ? 'background:rgba(255,107,107,.1);color:var(--err);border-color:rgba(255,107,107,.25)'
          : '';
      const caps = (p.capabilities || []).map((c) => `<span class="tag">${esc(c)}</span>`).join('');
      return `<div class="health-row">
        <div class="health-dot ${dotClass}"></div>
        <div class="health-provider">${esc(p.label)}</div>
        <span class="pill ${pillClass}" style="${pillStyle}">${STATE_LABEL[p.state] || esc(p.state)}</span>
        ${p.latencyMs ? `<span class="health-latency">${esc(p.latencyMs)}ms</span>` : ''}
        <div class="health-caps">${caps}</div>
        ${p.detail ? `<span class="health-detail text-xs">${esc(p.detail)}</span>` : ''}
      </div>`;
    })
    .join('');
}

/* ── Routes / Config ── */
async function renderRoutes() {
  const cfg = await api('/api/config');
  if (cfg.error) return;
  $$('.route').forEach((el) => {
    const r = cfg[el.dataset.cap];
    el.textContent = r ? `→ ${r.provider}/${r.model}` : '→ 未配置路由';
  });
  const editor = $('#config-editor');
  if (editor && !editor.value) editor.value = JSON.stringify(cfg, null, 2);
}

function initSettings() {
  const saveBtn = $('#config-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      let next;
      try { next = JSON.parse($('#config-editor').value); }
      catch { setConfigMsg('JSON 格式错误', 'err'); return; }
      const r = await api('/api/config', next, 'PUT');
      if (r.error) { setConfigMsg(errText(r.error), 'err'); return; }
      setConfigMsg('已保存，路由即时生效', 'ok');
      renderRoutes();
    });
  }
}

function setConfigMsg(text, type) {
  const el = $('#config-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `config-msg${type ? ' ' + type : ''}`;
}

async function renderKeys() {
  const data = await api('/api/config/keys');
  if (data.error || !Array.isArray(data.keys)) return;
  const list = $('#keys-list');
  if (!list) return;
  list.innerHTML = data.keys
    .map(
      (k) => `<div class="key-row">
        <div class="key-row-label">
          <div class="key-provider">${esc(k.provider)}</div>
          <div class="key-name">${esc(k.key)}</div>
          <div class="key-status ${k.configured ? 'configured' : 'unconfigured'}">
            ${k.configured ? `已配置 ****${esc(k.tail)}` : '未配置'}
          </div>
        </div>
        <input type="password" data-key="${esc(k.key)}" placeholder="粘贴新 key 后回车提交">
      </div>`
    )
    .join('');
  list.querySelectorAll('input[data-key]').forEach((input) => {
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const r = await api('/api/config/keys', { key: input.dataset.key, value: input.value.trim() });
      if (r.error) { toast(errText(r.error), 'err'); return; }
      input.value = '';
      toast('Key 已保存', 'ok');
      renderKeys();
      renderHealth(true);
      renderRoutes();
    });
  });
}

/* ── Usage / Cost ── */
async function renderUsage() {
  const u = await api('/api/usage');
  if (u.error) return;

  // topbar / dashboard
  const costStr = `$${u.totalUsd}`;
  const dashCost = $('#dash-cost');
  if (dashCost) dashCost.textContent = costStr;
  const dashSub = $('#dash-cost-sub');
  if (dashSub) dashSub.textContent = `文本 $${u.textUsd}`;

  // cost view
  const ctotal = $('#cost-total');
  if (ctotal) ctotal.textContent = `$${u.totalUsd}`;
  const ctext = $('#cost-text');
  if (ctext) ctext.textContent = `$${u.textUsd}`;
  const cbudget = $('#cost-budget');
  if (cbudget) cbudget.textContent = `$${u.textBudgetUsd}`;
  const cwarn = $('#cost-warn');
  if (cwarn) cwarn.textContent = u.textWarn ? '⚠ 接近红线' : '';
  if (cwarn) cwarn.style.color = u.textWarn ? 'var(--warn)' : '';
}

/* ── Jobs ── */
const JOB_STATE = {
  queued: '排队',
  running: '生成中',
  done: '完成',
  failed: '失败',
  interrupted: '已中断',
};

function mediaHtml(f) {
  const url = esc(f.url);
  if (/\.(png|jpe?g|webp)$/i.test(f.url)) return `<img src="${url}" alt="" style="max-width:100%;border-radius:8px;margin-top:6px;">`;
  if (/\.mp4$/i.test(f.url)) return `<video controls src="${url}" style="max-width:100%;border-radius:8px;margin-top:6px;"></video>`;
  if (/\.(mp3|wav)$/i.test(f.url)) return `<audio controls src="${url}" style="margin-top:6px;"></audio>`;
  return `<a href="${url}" target="_blank" style="color:var(--brand-2)">${url}</a>`;
}

function jobCardHtml(j) {
  const isRunning = j.status === 'running' || j.status === 'queued';
  const spinner = isRunning ? '<div class="job-spinner"></div>' : '';
  const progress = Number(j.progress) || 0;
  return `<div class="job-card" style="flex-direction:column;align-items:stretch;margin-bottom:8px;">
    <div style="display:flex;align-items:center;gap:10px;">
      ${spinner}
      <div class="job-info">
        <div class="job-cap">${esc(j.capability)} · ${JOB_STATE[j.status] || esc(j.status)}</div>
        ${j.stage ? `<div class="job-stage">${esc(j.stage)}</div>` : ''}
      </div>
      ${j.costEstimate ? `<div class="job-cost">预估 $${esc(j.costEstimate.estimatedUsd)}</div>` : ''}
      ${j.costActual != null ? `<div class="job-cost">实际 $${esc(j.costActual)}</div>` : ''}
      ${(j.status === 'failed' || j.status === 'interrupted')
        ? `<button class="btn btn-secondary btn-sm" onclick="retryJobClick('${esc(j.id)}')">重试</button>` : ''}
    </div>
    <div class="job-progress">
      <div class="progress-bar"><div class="fill" style="width:${progress}%"></div></div>
    </div>
    ${j.status === 'done' && j.result ? j.result.files.map(mediaHtml).join('') : ''}
    ${j.status === 'failed' && j.error ? `<div class="out">${esc(errText(j.error))}</div>` : ''}
  </div>`;
}

async function renderJobs() {
  const data = await api('/api/jobs');
  if (data.error || !Array.isArray(data.jobs)) return;
  // legacy hidden element kept for compat
  const legacyList = document.getElementById('jobs-list');
  if (legacyList) legacyList.innerHTML = '';
  return data.jobs;
}

async function renderCostJobs() {
  const data = await api('/api/jobs');
  if (data.error || !Array.isArray(data.jobs)) return;
  const el = $('#cost-jobs-list');
  if (!el) return;
  if (!data.jobs.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><div class="title">暂无任务</div></div>';
    return;
  }
  el.innerHTML = data.jobs.map(jobCardHtml).join('');
}

window.retryJobClick = async (id) => {
  const r = await api(`/api/jobs/${encodeURIComponent(id)}/retry`, {}, 'POST');
  if (r.error) toast(errText(r.error), 'err');
  else toast('已重新排队');
  renderCostJobs();
};

/* ── Artist Picker ── */
function buildPickerAvatar(artist) {
  const cover = artist && artist.portraits && artist.portraits[0];
  if (cover) {
    return `<img class="picker-avatar" src="${esc(cover.url)}" alt="${esc(artist.name)}">`;
  }
  return `<div class="picker-avatar placeholder">🎭</div>`;
}

function renderArtistPicker(artists) {
  const btn = $('#artist-picker-btn');
  if (!btn) return;
  const current = artists.find((a) => a.id === state.currentArtistId) || artists[0] || null;
  if (current && !state.currentArtistId) {
    state.currentArtistId = current.id;
  }

  if (current) {
    const cover = current.portraits && current.portraits[0];
    const avatarEl = $('#picker-avatar');
    if (avatarEl) {
      if (cover) {
        avatarEl.outerHTML = `<img class="picker-avatar" id="picker-avatar" src="${esc(cover.url)}" alt="${esc(current.name)}">`;
      } else {
        const el = document.getElementById('picker-avatar');
        if (el) { el.className = 'picker-avatar placeholder'; el.textContent = '🎭'; }
      }
    }
    const nameEl = $('#picker-name');
    if (nameEl) nameEl.textContent = current.name || '未命名';
    const personaEl = $('#picker-persona');
    if (personaEl) personaEl.textContent = current.persona || current.positioning || '虚拟艺人';
  } else {
    const nameEl = $('#picker-name');
    if (nameEl) nameEl.textContent = '未选择艺人';
    const personaEl = $('#picker-persona');
    if (personaEl) personaEl.textContent = '请创设或选择';
  }

  // build dropdown list
  const list = $('#picker-artist-list');
  if (list) {
    list.innerHTML = artists
      .map((a) => {
        const cover = a.portraits && a.portraits[0];
        const imgHtml = cover
          ? `<img src="${esc(cover.url)}" alt="${esc(a.name)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`
          : `<div style="width:32px;height:32px;border-radius:50%;background:var(--panel-2);display:flex;align-items:center;justify-content:center;font-size:14px;">🎭</div>`;
        const isActive = a.id === state.currentArtistId;
        return `<div class="picker-item${isActive ? ' active' : ''}" data-artist-id="${esc(a.id)}">
          ${imgHtml}
          <div class="picker-item-info">
            <div class="nm">${esc(a.name)}</div>
            <div class="ps">${esc(a.persona || a.positioning || '')}</div>
          </div>
        </div>`;
      })
      .join('');
    list.querySelectorAll('.picker-item').forEach((item) => {
      item.addEventListener('click', () => {
        state.currentArtistId = item.dataset.artistId;
        closeArtistPicker();
        renderArtistPicker(state.artists);
        if (state.currentView === 'companion') renderCompanionView();
        if (state.currentView === 'photo-video') { updatePhotoArtistCard(); loadGallery(); }
        if (state.currentView === 'music') { switchView('music'); }
        if (state.currentView === 'interview') { switchView('interview'); }
      });
    });
  }
}

function openArtistPicker() {
  $('#artist-picker-dropdown').classList.remove('hidden');
}
function closeArtistPicker() {
  const dd = $('#artist-picker-dropdown');
  if (dd) dd.classList.add('hidden');
}

function initArtistPicker() {
  $('#artist-picker-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('#artist-picker-dropdown');
    if (dd.classList.contains('hidden')) openArtistPicker();
    else closeArtistPicker();
  });
  $('#picker-goto-create').addEventListener('click', () => {
    closeArtistPicker();
    switchView('artist-creation');
  });
  document.addEventListener('click', (e) => {
    if (!$('#artist-picker-wrap').contains(e.target)) closeArtistPicker();
  });
  $('#topbar-new-btn').addEventListener('click', () => {
    switchView('artist-creation');
    startNewInterview();
  });
  initTheme();
}

/* ── 主题切换：制片棚(默认) ↔ 野兽派 ── */
function applyTheme(t) {
  const fauvist = t === 'fauvist';
  document.documentElement.dataset.theme = fauvist ? 'fauvist' : '';
  const btn = $('#topbar-theme-btn');
  if (btn) btn.textContent = fauvist ? '🌙 制片棚' : '🎨 野兽派';
}
function initTheme() {
  let saved = '';
  try { saved = localStorage.getItem('ui-theme') || ''; } catch {}
  applyTheme(saved);
  const btn = $('#topbar-theme-btn');
  if (btn) btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'fauvist' ? '' : 'fauvist';
    applyTheme(next);
    try { localStorage.setItem('ui-theme', next); } catch {}
  });
}

/* ── Dashboard ── */
async function renderDashboard() {
  const data = await api('/api/artists');
  if (!data.error && Array.isArray(data.artists)) {
    const countEl = $('#dash-artist-count');
    if (countEl) countEl.textContent = data.artists.length;
  }
  await renderUsage();

  const jobData = await api('/api/jobs');
  const dbJobs = $('#dashboard-jobs');
  if (!dbJobs) return;
  if (!jobData.error && Array.isArray(jobData.jobs) && jobData.jobs.length) {
    dbJobs.innerHTML = jobData.jobs.slice(0, 5).map(jobCardHtml).join('');
  } else {
    dbJobs.innerHTML = `<div class="empty-state">
      <div class="icon">📋</div>
      <div class="title">暂无任务</div>
      <div class="desc">开启生产线后任务将在此显示</div>
    </div>`;
  }
}

/* ── Artist Studio (S1) ── */
function artistCardHtml(a) {
  const cover = a.portraits && a.portraits[0];
  const tags = (a.personality || [])
    .slice(0, 3)
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join('');
  const coverHtml = cover
    ? `<img class="artist-card-cover" src="${esc(cover.url)}" alt="${esc(a.name)}">`
    : `<div class="artist-card-cover placeholder">🎭</div>`;
  return `<div class="artist-card" data-id="${esc(a.id)}">
    ${coverHtml}
    <div class="artist-card-body">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <div class="artist-card-name">${esc(a.name)}</div>
        <span class="lock-badge">⬡ 锁脸</span>
      </div>
      <div class="artist-card-persona">${esc(a.persona || a.positioning || '')}</div>
      ${tags ? `<div class="artist-card-tags">${tags}</div>` : ''}
    </div>
  </div>`;
}

async function renderArtists() {
  const data = await api('/api/artists');
  if (data.error || !Array.isArray(data.artists)) return;
  state.artists = data.artists;
  renderArtistPicker(state.artists);

  const list = $('#artist-list');
  if (!list) return;
  if (!data.artists.length) {
    list.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🎭</div>
      <div class="title">还没有艺人</div>
      <div class="desc">点击上方「创设新艺人」，通过对话访谈创建你的第一位虚拟艺人。</div>
    </div>`;
    return;
  }
  list.innerHTML = data.artists.map(artistCardHtml).join('');
  list.querySelectorAll('.artist-card').forEach((el) =>
    el.addEventListener('click', () => showArtistDetail(el.dataset.id))
  );
}

function renderInterview() {
  const log = $('#interview-log');
  if (!log) return;
  log.innerHTML = state.interviewHistory
    .map((m) => `<div class="bubble ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.content)}</div>`)
    .join('');
  log.scrollTop = log.scrollHeight;
  const pill = $('#interview-status-pill');
  if (pill) {
    pill.className = 'pill ' + (state.interviewHistory.length > 0 ? 's2' : 'dim');
    pill.textContent = state.interviewHistory.length > 0 ? '访谈中' : '等待开始';
  }
}

async function sendInterview() {
  const input = $('#interview-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  state.interviewHistory.push({ role: 'user', content: text });
  input.value = '';
  renderInterview();
  const btn = $('#interview-send');
  if (btn) btn.disabled = true;
  const log = $('#interview-log');
  const aiId = `iv${Date.now()}`;
  if (log) {
    log.insertAdjacentHTML('beforeend', `<div class="bubble ai typing" id="${aiId}"></div>`);
    log.scrollTop = log.scrollHeight;
  }
  const aiEl = document.getElementById(aiId);
  let acc = '';
  try {
    const res = await fetch('/api/artist/interview/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.interviewHistory }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let carry = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      let i;
      while ((i = carry.indexOf('\n\n')) >= 0) {
        const block = carry.slice(0, i); carry = carry.slice(i + 2);
        const ev = (block.match(/^event: (.*)$/m) || [])[1];
        const dataLine = (block.match(/^data: (.*)$/m) || [])[1];
        if (!dataLine) continue;
        let payload; try { payload = JSON.parse(dataLine); } catch { continue; }
        if (ev === 'token') {
          acc += payload.t;
          if (aiEl) aiEl.textContent = acc;
          if (log) log.scrollTop = log.scrollHeight;
        } else if (ev === 'done') {
          state.interviewHistory.push({ role: 'assistant', content: payload.reply || acc });
          renderInterview();   // 用历史重渲，去掉临时 typing 气泡
        } else if (ev === 'error') {
          if (aiEl) { aiEl.textContent = errText(payload); aiEl.classList.remove('typing'); }
        }
      }
    }
  } catch (e) {
    if (aiEl) { aiEl.textContent = `网络错误：${e.message}`; aiEl.classList.remove('typing'); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function finalizeInterview() {
  if (!state.interviewHistory.length) {
    toast('请先进行访谈对话', 'err');
    return;
  }
  const btn = $('#interview-finalize');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  const msg = $('#interview-msg');
  if (msg) { msg.classList.remove('hidden'); msg.textContent = '正在生成档案…'; }
  const r = await api('/api/artist/finalize', { transcript: state.interviewHistory });
  if (btn) { btn.disabled = false; btn.textContent = '✦ 生成档案'; }
  if (r.error) {
    if (msg) { msg.textContent = errText(r.error); msg.style.color = 'var(--err)'; }
    return;
  }
  if (msg) msg.classList.add('hidden');
  fillDraft(r.draft);
  const pill = $('#draft-status-pill');
  if (pill) { pill.className = 'pill s1'; pill.textContent = 'AI 已补全'; }
}

function fillDraft(d) {
  const set = (f, v) => {
    const el = document.querySelector(`#draft-box [data-f="${f}"]`);
    if (el) el.value = v ?? '';
  };
  set('name', d.name);
  set('gender', d.gender);
  set('persona', d.persona);
  set('positioning', d.positioning);
  set('coreAppeal', d.coreAppeal);
  set('speakingStyle', d.speakingStyle);
  set('voiceDescription', d.voiceProfile?.description);
  set('musicStyle', d.musicStyle);
  set('personality', Array.isArray(d.personality) ? d.personality.join('，') : '');
  set('backstory', d.backstory);
  set('visualIdentity', d.visualIdentity);
  const genBtn = $('#gen-portrait-draft');
  if (genBtn) genBtn.disabled = false;
}

function readDraft() {
  const g = (f) => document.querySelector(`#draft-box [data-f="${f}"]`)?.value?.trim() ?? '';
  return {
    name: g('name'),
    gender: g('gender'),
    persona: g('persona'),
    positioning: g('positioning'),
    coreAppeal: g('coreAppeal'),
    speakingStyle: g('speakingStyle'),
    voiceProfile: { description: g('voiceDescription') },
    musicStyle: g('musicStyle'),
    personality: g('personality')
      ? g('personality').split(/[，,]/).map((s) => s.trim()).filter(Boolean)
      : [],
    backstory: g('backstory'),
    visualIdentity: g('visualIdentity'),
  };
}

async function saveArtist() {
  const profile = readDraft();
  if (!profile.name) {
    const msg = $('#create-msg');
    if (msg) { msg.textContent = '艺名必填'; msg.className = 'out msg-err'; }
    return;
  }
  const btn = $('#artist-save');
  if (btn) btn.disabled = true;
  const r = await api('/api/artist', { profile });
  if (btn) btn.disabled = false;
  if (r.error) {
    const msg = $('#create-msg');
    if (msg) { msg.textContent = errText(r.error); msg.className = 'out msg-err'; }
    return;
  }
  const msg = $('#create-msg');
  if (msg) { msg.textContent = `已创建 ${r.artist.name}`; msg.className = 'out msg-ok'; }
  toast(`艺人「${r.artist.name}」已创建！`, 'ok');
  await renderArtists();

  // Select the new artist
  state.currentArtistId = r.id || r.artist?.id;
  renderArtistPicker(state.artists);

  // Enable portrait button with new artist id
  const genBtn = $('#gen-portrait-draft');
  if (genBtn) {
    genBtn.disabled = false;
    genBtn.dataset.artistId = r.id || r.artist?.id;
  }
  showArtistDetail(r.id || r.artist?.id);
}

async function showArtistDetail(id) {
  const r = await api(`/api/artist/${encodeURIComponent(id)}`);
  if (r.error) return;
  const a = r.artist;
  const panel = $('#artist-detail-panel');
  const content = $('#artist-detail-content');
  if (!panel || !content) return;

  const portraits = (a.portraits || [])
    .map((p) => `<img class="portrait-thumb" src="${esc(p.url)}" alt="">`)
    .join('');

  const tags = (a.personality || [])
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join(' ');

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
      <div>
        <div style="font-size:18px;font-weight:800;">${esc(a.name)}</div>
        <div class="text-sm text-ink-3 mt-8">${esc(a.persona || '')} ${a.positioning ? '· ' + esc(a.positioning) : ''}</div>
        ${tags ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">${tags}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-accent btn-sm" id="detail-gen-portrait" data-id="${esc(a.id)}">出定妆照</button>
        <button class="btn btn-primary btn-sm" id="detail-open-chat" data-id="${esc(a.id)}" data-name="${esc(a.name)}">💬 对话陪伴</button>
        <button class="btn btn-danger btn-sm" id="detail-del" data-id="${esc(a.id)}">删除</button>
      </div>
    </div>
    ${a.backstory ? `<p class="text-sm" style="color:var(--ink-2);margin:0 0 12px;">${esc(a.backstory)}</p>` : ''}
    <div class="g2 mb-12" style="font-size:13px;color:var(--ink-2);">
      ${a.voiceProfile?.description ? `<div><span class="text-ink-3">声线：</span>${esc(a.voiceProfile.description)}</div>` : ''}
      ${a.musicStyle ? `<div><span class="text-ink-3">音乐：</span>${esc(a.musicStyle)}</div>` : ''}
      ${a.visualIdentity ? `<div style="grid-column:1/-1;"><span class="text-ink-3">视觉档案：</span>${esc(a.visualIdentity)}</div>` : ''}
    </div>
    ${portraits ? `<div class="portrait-grid">${portraits}</div>` : ''}
    <div id="portrait-msg" class="out" style="margin-top:8px;"></div>
  `;

  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  $('#detail-gen-portrait').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const pmsg = $('#portrait-msg');
    if (pmsg) pmsg.textContent = '生成中…（约 60s）';
    const pr = await api(`/api/artist/${encodeURIComponent(btn.dataset.id)}/portrait`, {});
    btn.disabled = false;
    if (pr.error) {
      if (pmsg) pmsg.textContent = errText(pr.error);
      toast(errText(pr.error), 'err');
    } else {
      if (pmsg) pmsg.textContent = '定妆照已生成！';
      toast('定妆照已生成', 'ok');
      showArtistDetail(btn.dataset.id);
      renderArtists();
    }
  });

  $('#detail-open-chat').addEventListener('click', (e) => {
    const artistId = e.currentTarget.dataset.id;
    state.currentArtistId = artistId;
    renderArtistPicker(state.artists);
    switchView('companion');
  });

  $('#detail-del').addEventListener('click', async (e) => {
    if (!confirm(`确认删除艺人「${a.name}」？此操作不可恢复。`)) return;
    await api(`/api/artist/${encodeURIComponent(e.currentTarget.dataset.id)}`, undefined, 'DELETE');
    panel.classList.add('hidden');
    if (state.currentArtistId === e.currentTarget.dataset.id) state.currentArtistId = null;
    toast('艺人已删除');
    renderArtists();
  });
}

function startNewInterview() {
  state.interviewHistory = [];
  renderInterview();
  const draftPill = $('#draft-status-pill');
  if (draftPill) { draftPill.className = 'pill warn'; draftPill.textContent = '草稿'; }
  const msg = $('#create-msg');
  if (msg) { msg.textContent = ''; msg.className = 'out'; }
  const genBtn = $('#gen-portrait-draft');
  if (genBtn) genBtn.disabled = true;
  // reset draft fields
  $$('#draft-box [data-f]').forEach((el) => { el.value = ''; });
  $('#artist-detail-panel').classList.add('hidden');
}

function initArtistStudio() {
  renderArtists();
  const newBtn = $('#artist-new');
  if (newBtn) newBtn.addEventListener('click', startNewInterview);
  const sendBtn = $('#interview-send');
  if (sendBtn) sendBtn.addEventListener('click', sendInterview);
  const input = $('#interview-input');
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendInterview(); });
  const finBtn = $('#interview-finalize');
  if (finBtn) finBtn.addEventListener('click', finalizeInterview);
  const saveBtn = $('#artist-save');
  if (saveBtn) saveBtn.addEventListener('click', saveArtist);

  // "出定妆照" button in draft panel (before artist created)
  const genDraftBtn = $('#gen-portrait-draft');
  if (genDraftBtn) {
    genDraftBtn.addEventListener('click', async () => {
      const artistId = genDraftBtn.dataset.artistId || state.currentArtistId;
      if (!artistId) { toast('请先确认创建艺人', 'err'); return; }
      genDraftBtn.disabled = true;
      const msg = $('#create-msg');
      if (msg) { msg.textContent = '生成定妆照中…'; msg.className = 'out'; }
      const r = await api(`/api/artist/${encodeURIComponent(artistId)}/portrait`, {});
      genDraftBtn.disabled = false;
      if (r.error) {
        if (msg) { msg.textContent = errText(r.error); msg.className = 'out msg-err'; }
        toast(errText(r.error), 'err');
      } else {
        if (msg) { msg.textContent = '定妆照已生成'; msg.className = 'out msg-ok'; }
        toast('定妆照已生成', 'ok');
        showArtistDetail(artistId);
        renderArtists();
      }
    });
  }
}

/* ── Companion / Chat (S2) ── */
function renderCompanionView() {
  const noArtist = $('#companion-no-artist');
  const chatArea = $('#companion-chat-area');
  if (!state.currentArtistId) {
    if (noArtist) noArtist.classList.remove('hidden');
    if (chatArea) chatArea.classList.add('hidden');
    return;
  }
  if (noArtist) noArtist.classList.add('hidden');
  if (chatArea) chatArea.classList.remove('hidden');
  state.chatArtistId = state.currentArtistId;
  loadChat(state.currentArtistId);
}

async function loadChat(id) {
  const data = await api(`/api/artist/${encodeURIComponent(id)}/chat`);
  if (!data.error) {
    const log = $('#chat-log');
    if (log) {
      log.innerHTML = (data.messages || [])
        .map((m) => `<div class="bubble ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.content)}</div>`)
        .join('');
      log.scrollTop = log.scrollHeight;
    }
    renderChatState(data.state);
  }
}

function renderChatState(s) {
  if (!s) return;
  const mood = $('#companion-mood');
  if (mood) mood.textContent = esc(s.mood || '—');
  const affinity = s.affinity ?? 0;
  const aff = $('#companion-affinity');
  if (aff) aff.textContent = affinity;
  const bar = $('#companion-affinity-bar');
  if (bar) bar.style.width = `${Math.min(100, affinity)}%`;
}

async function sendChat() {
  const input = $('#chat-msg');
  const text = input ? input.value.trim() : '';
  if (!text || !state.chatArtistId) return;
  if (input) input.value = '';

  const log = $('#chat-log');
  if (log) {
    log.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(text)}</div>`);
    const aiBubbleId = `b${Date.now()}`;
    log.insertAdjacentHTML('beforeend', `<div class="bubble ai typing" id="${aiBubbleId}"></div>`);
    log.scrollTop = log.scrollHeight;

    const aiEl = document.getElementById(aiBubbleId);
    try {
      const res = await fetch(
        `/api/artist/${encodeURIComponent(state.chatArtistId)}/chat/stream`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) }
      );
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let carry = '', acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += dec.decode(value, { stream: true });
        let i;
        while ((i = carry.indexOf('\n\n')) >= 0) {
          const block = carry.slice(0, i);
          carry = carry.slice(i + 2);
          const ev = (block.match(/^event: (.*)$/m) || [])[1];
          const dataLine = (block.match(/^data: (.*)$/m) || [])[1];
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine);
          if (ev === 'token') {
            acc += payload.t;
            if (aiEl) { aiEl.textContent = acc; aiEl.classList.add('typing'); }
            log.scrollTop = log.scrollHeight;
          } else if (ev === 'done') {
            if (aiEl) { aiEl.textContent = payload.reply || acc; aiEl.classList.remove('typing'); }
            renderChatState(payload.state);
          } else if (ev === 'error') {
            if (aiEl) { aiEl.textContent = errText(payload); aiEl.classList.remove('typing'); }
          }
        }
      }
      if (aiEl && !acc && !aiEl.textContent) {
        aiEl.textContent = '（无回复）';
        aiEl.classList.remove('typing');
      }
    } catch (e) {
      if (aiEl) { aiEl.textContent = `连接失败：${e.message}`; aiEl.classList.remove('typing'); }
    }
  }
}

function initChatView() {
  const sendBtn = $('#chat-send2');
  if (sendBtn) sendBtn.addEventListener('click', sendChat);
  const chatInput = $('#chat-msg');
  if (chatInput) chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
}

/* ── Legacy debug card handlers (hidden, keep backend wiring) ── */
function initChat() {
  const btn = $('#chat-send');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const content = $('#chat-input').value.trim();
    if (!content) return;
    btn.disabled = true;
    $('#chat-out').textContent = '生成中…';
    const r = await api('/api/ai/chat', { messages: [{ role: 'user', content }], maxTokens: 512 });
    btn.disabled = false;
    $('#chat-out').textContent = r.error ? errText(r.error) : `${r.text}\n—— ${r.provider}/${r.model}`;
  });
}

function initImage() {
  const btn = $('#image-send');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const prompt = $('#image-prompt').value.trim();
    if (!prompt) return;
    btn.disabled = true;
    $('#image-out').textContent = '生成中…（目标 ≤60s）';
    const ref = await fileToDataUrl($('#image-ref'));
    const r = await api('/api/ai/image', { prompt, refImages: ref ? [ref] : [] });
    btn.disabled = false;
    $('#image-out').innerHTML = r.error
      ? esc(errText(r.error)).replace(/\n/g, '<br>')
      : r.files.map(mediaHtml).join('') + `<div>—— ${esc(r.provider)}/${esc(r.model)}</div>`;
  });
}

function initMusic() {
  const btn = $('#music-send');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const title = $('#music-title').value.trim();
    const style = $('#music-style').value.trim();
    const lyrics = $('#music-lyrics').value.trim();
    if (!title && !style && !lyrics) return;
    btn.disabled = true;
    await submitWithConfirm('/api/ai/music', { title, style, lyrics }, $('#music-out'));
    btn.disabled = false;
  });
}

function initVideo() {
  const btn = $('#video-send');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const prompt = $('#video-prompt').value.trim();
    const imageRef = await fileToDataUrl($('#video-ref'));
    if (!prompt && !imageRef) return;
    btn.disabled = true;
    await submitWithConfirm(
      '/api/ai/video',
      { prompt, imageRef, durationSec: Number($('#video-duration').value) },
      $('#video-out')
    );
    btn.disabled = false;
  });
}

function initTts() {
  const btn = $('#tts-send');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const text = $('#tts-text').value.trim();
    if (!text) return;
    btn.disabled = true;
    $('#tts-out').textContent = '合成中…';
    const r = await api('/api/ai/tts', { text, voice: $('#tts-voice').value.trim() || undefined });
    btn.disabled = false;
    $('#tts-out').innerHTML = r.error
      ? esc(errText(r.error)).replace(/\n/g, '<br>')
      : r.files.map(mediaHtml).join('') + `<div>—— ${esc(r.provider)}/${esc(r.model)}</div>`;
  });
}

function initAsr() {
  const btn = $('#asr-send');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const audio = await fileToDataUrl($('#asr-file'));
    if (!audio) { $('#asr-out').textContent = '请先选择音频文件'; return; }
    btn.disabled = true;
    $('#asr-out').textContent = '转写中…';
    const r = await api('/api/ai/asr', { audio });
    btn.disabled = false;
    $('#asr-out').textContent = r.error ? errText(r.error) : `${r.text}\n—— ${r.provider}/${r.model}`;
  });
}

/* ── Cost Confirm Modal (preserved) ── */
function confirmCost(estimate) {
  if (state.confirmOpen) return Promise.resolve(false);
  state.confirmOpen = true;
  return new Promise((resolve) => {
    $('#confirm-text').textContent =
      `将由 ${estimate.provider}/${estimate.model} 生成 ${estimate.capability}，预估成本 $${estimate.estimatedUsd}。继续？`;
    $('#confirm-modal').classList.remove('hidden');
    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    const done = (v) => {
      state.confirmOpen = false;
      $('#confirm-modal').classList.add('hidden');
      ok.removeEventListener('click', yes);
      cancel.removeEventListener('click', no);
      resolve(v);
    };
    const yes = () => done(true);
    const no = () => done(false);
    ok.addEventListener('click', yes);
    cancel.addEventListener('click', no);
  });
}

async function submitWithConfirm(path, payload, outEl) {
  if (outEl) outEl.textContent = '估算成本…';
  const first = await api(path, payload);
  if (first.error && first.error.code === 'confirm_required') {
    if (!(await confirmCost(first.error.estimate))) {
      if (outEl) outEl.textContent = '已取消';
      return null;
    }
    const second = await api(path, { ...payload, confirm: true });
    if (second.error) { if (outEl) outEl.textContent = errText(second.error); return null; }
    if (outEl) outEl.textContent = `已提交任务 ${second.jobId}，进度见成本账本`;
    renderCostJobs();
    return second;
  }
  if (first.error) { if (outEl) outEl.textContent = errText(first.error); return null; }
  return first;
}

function fileToDataUrl(input) {
  return new Promise((resolve) => {
    const f = input && input.files && input.files[0];
    if (!f) return resolve(null);
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(f);
  });
}

/* ── Photo Studio (S3) ── */
const photoState = {
  shot: '近景',
  aspect: '3:4',
  count: 1,
  filter: 'all',   // 'all' | 'photo' | 'video' | 'favorite'
  generating: false,
};

/* ── Video Studio (P2b) ── */
const videoState = {
  durationSec: 5,
};

function initSegCtrl(id, onSelect) {
  const wrap = $(`#${id}`);
  if (!wrap) return;
  wrap.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(btn.dataset.val);
    });
  });
}

function photoArtistName() {
  const a = state.artists.find((x) => x.id === state.currentArtistId);
  return a ? a.name : null;
}

function updatePhotoArtistCard() {
  const textEl = $('#photo-lock-text');
  if (!textEl) return;
  const name = photoArtistName();
  textEl.textContent = name ? `锁脸基准：${name}` : '请先在顶部选择/创设一个艺人';
}

/* ── 灯箱：照片/视频全屏放大 + 前后浏览 ── */
const lbState = { items: [], idx: 0 };
function lbIsMp3(u) { return /\.mp3(\?|$)/i.test(u || ''); }
function lbIsVideo(it) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(it.url || '') || (!lbIsMp3(it.url) && ['video', 'drama', 'interview'].includes(it.type));
}
function openLightbox(items, idx) {
  if (!items || !items.length) return;
  lbState.items = items;
  lbState.idx = Math.max(0, Math.min(idx || 0, items.length - 1));
  const ov = $('#lightbox');
  if (!ov) return;
  ov.hidden = false;
  document.body.style.overflow = 'hidden';
  lbRender();
  document.addEventListener('keydown', lbKey);
}
function closeLightbox() {
  const ov = $('#lightbox');
  if (!ov) return;
  ov.hidden = true;
  const stage = $('#lb-stage');
  if (stage) stage.innerHTML = '';   // 卸载媒体，停止视频/音频播放
  document.body.style.overflow = '';
  document.removeEventListener('keydown', lbKey);
}
function lbStep(d) {
  if (lbState.items.length < 2) return;
  lbState.idx = (lbState.idx + d + lbState.items.length) % lbState.items.length;
  lbRender();
}
function lbRender() {
  const it = lbState.items[lbState.idx];
  const stage = $('#lb-stage');
  const cap = $('#lb-caption');
  if (!it || !stage) return;
  const u = esc(it.url);
  stage.innerHTML = lbIsMp3(it.url)
    ? `<audio src="${u}" controls autoplay class="lb-audio"></audio>`
    : lbIsVideo(it)
      ? `<video src="${u}" controls autoplay playsinline class="lb-media"></video>`
      : `<img src="${u}" alt="" class="lb-media">`;
  const label = it.title || it.shot || '';
  if (cap) cap.textContent = `${lbState.idx + 1} / ${lbState.items.length}${label ? ' · ' + label : ''}`;
  const multi = lbState.items.length > 1;
  const prev = $('#lb-prev'); const next = $('#lb-next');
  if (prev) prev.style.visibility = multi ? '' : 'hidden';
  if (next) next.style.visibility = multi ? '' : 'hidden';
}
function lbKey(e) {
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lbStep(-1);
  else if (e.key === 'ArrowRight') lbStep(1);
}
function initLightbox() {
  $('#lb-close')?.addEventListener('click', closeLightbox);
  $('#lb-prev')?.addEventListener('click', () => lbStep(-1));
  $('#lb-next')?.addEventListener('click', () => lbStep(1));
  // 点遮罩空白处关闭（点到媒体/按钮不关）
  $('#lightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'lightbox' || e.target.id === 'lb-stage') closeLightbox();
  });
}
// 从某 grid 的资产列表打开灯箱：list = 该 grid 当前渲染的资产数组，id = 被点资产 id
function openLightboxFromList(list, id) {
  const idx = list.findIndex((a) => String(a.id) === String(id));
  if (idx < 0) return;
  const items = list.map((a) => ({ url: a.url, type: a.type, title: a.title, shot: a.shot }));
  openLightbox(items, idx);
}

function mediaTileHtml(asset) {
  if (asset.type === 'video') return videoTileHtml(asset);
  if (asset.type === 'drama') return dramaTileHtml(asset);
  const url = esc(asset.url);
  const id = esc(asset.id);
  const shot = esc(asset.shot || '');
  const aspect = esc(asset.aspect || '');
  const isFav = asset.favorite;
  return `<div class="media-tile" data-asset-id="${id}">
    <div class="media-tile-img-wrap">
      <img src="${url}" alt="" loading="lazy">
      <span class="media-tile-lock lock-badge">⬡ 锁脸</span>
      <div class="media-tile-actions">
        <button class="tile-btn tile-max" data-id="${id}" title="放大浏览">⛶</button>
        <button class="tile-btn tile-fav${isFav ? ' faved' : ''}" data-id="${id}" title="${isFav ? '取消收藏' : '收藏'}">★</button>
        <button class="tile-btn tile-redo" data-id="${id}" data-shot="${shot}" data-aspect="${aspect}" title="重抽">↻</button>
        <button class="tile-btn tile-del" data-id="${id}" title="删除">🗑</button>
      </div>
    </div>
    <div class="media-tile-meta">${shot ? shot + (aspect ? ' · ' + aspect : '') : aspect}</div>
  </div>`;
}

function videoTileHtml(asset) {
  const url = esc(asset.url);
  const id = esc(asset.id);
  const dur = asset.durationSec ? `${esc(String(asset.durationSec))}s` : '';
  const isFav = asset.favorite;
  return `<div class="media-tile media-tile-video" data-asset-id="${id}">
    <div class="media-tile-img-wrap media-tile-video-wrap">
      <video src="${url}" controls preload="metadata" class="video-tile-player"></video>
      <span class="media-tile-lock lock-badge lock-badge-video">⬡ 锁脸</span>
      <div class="media-tile-actions">
        <button class="tile-btn tile-max" data-id="${id}" title="放大浏览">⛶</button>
        <button class="tile-btn tile-fav${isFav ? ' faved' : ''}" data-id="${id}" title="${isFav ? '取消收藏' : '收藏'}">★</button>
        <button class="tile-btn tile-del" data-id="${id}" title="删除">🗑</button>
      </div>
    </div>
    <div class="media-tile-meta">🎬 视频${dur ? ' · ' + dur : ''}</div>
  </div>`;
}

function dramaTileHtml(asset) {
  const url = esc(asset.url);
  const id = esc(asset.id);
  const dur = asset.durationSec ? `${esc(String(asset.durationSec))}s` : '';
  const title = esc(asset.title || '短剧');
  const isFav = asset.favorite;
  return `<div class="media-tile media-tile-video" data-asset-id="${id}">
    <div class="media-tile-img-wrap media-tile-video-wrap">
      <video src="${url}" controls preload="metadata" class="video-tile-player"></video>
      <span class="media-tile-lock lock-badge lock-badge-video">🎞️ 短剧</span>
      <div class="media-tile-actions">
        <button class="tile-btn tile-max" data-id="${id}" title="放大浏览">⛶</button>
        <button class="tile-btn tile-fav${isFav ? ' faved' : ''}" data-id="${id}" title="${isFav ? '取消收藏' : '收藏'}">★</button>
        <button class="tile-btn tile-del" data-id="${id}" title="删除">🗑</button>
      </div>
    </div>
    <div class="media-tile-meta">🎞️ ${title}${dur ? ' · ' + dur : ''}</div>
  </div>`;
}

function spinnerTileHtml() {
  return `<div class="media-tile media-tile-placeholder">
    <div class="media-tile-img-wrap">
      <div class="tile-spinner-wrap">
        <div class="job-spinner"></div>
        <div class="tile-spinner-label">生成中…</div>
      </div>
    </div>
    <div class="media-tile-meta">生成中</div>
  </div>`;
}

async function loadGallery() {
  if (!state.currentArtistId) {
    const grid = $('#photo-gallery-grid');
    if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">📸</div>
      <div class="title">请先选择艺人</div>
      <div class="desc">从顶部艺人选择器选择或创设一名艺人。</div>
    </div>`;
    return;
  }
  const data = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery`);
  if (data.error) return;
  renderGallery(data.assets || []);
}

function renderGallery(assets) {
  const grid = $('#photo-gallery-grid');
  if (!grid) return;

  let list = assets;
  if (photoState.filter === 'favorite') list = assets.filter((a) => a.favorite);
  else if (photoState.filter === 'photo') list = assets.filter((a) => a.type !== 'video');
  else if (photoState.filter === 'video') list = assets.filter((a) => a.type === 'video');

  const emptyTitles = { favorite: '还没有收藏', photo: '还没有写真', video: '还没有视频' };
  const emptyDescs = { favorite: '点击★收藏任意写真或视频。', photo: '左侧设置参数后点生成写真。', video: '左侧填写运镜后点生成视频。' };

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🖼️</div>
      <div class="title">${emptyTitles[photoState.filter] || '还没有内容'}</div>
      <div class="desc">${emptyDescs[photoState.filter] || '左侧设置参数后点生成。'}</div>
    </div>`;
    return;
  }

  grid.innerHTML = list.map(mediaTileHtml).join('');

  // bind tile actions
  grid.querySelectorAll('.tile-fav').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.currentArtistId) return;
      await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery/${encodeURIComponent(btn.dataset.id)}/favorite`, {});
      loadGallery();
    });
  });

  grid.querySelectorAll('.tile-redo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.currentArtistId) return;
      const genBtn = $('#photo-generate-btn');
      if (genBtn) genBtn.disabled = true;
      insertSpinners(1);
      const stylePrompt = $('#photo-style-prompt') ? $('#photo-style-prompt').value.trim() : '';
      const r = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/photo`, {
        shot: btn.dataset.shot || photoState.shot,
        aspect: btn.dataset.aspect || photoState.aspect,
        count: 1,
        stylePrompt,
      });
      if (genBtn) genBtn.disabled = false;
      if (r.error) { toast(errText(r.error), 'err'); loadGallery(); return; }
      loadGallery();
    });
  });

  grid.querySelectorAll('.tile-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.currentArtistId) return;
      if (!confirm('确认删除这张写真？')) return;
      await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery/${encodeURIComponent(btn.dataset.id)}`, undefined, 'DELETE');
      loadGallery();
    });
  });

  // 放大浏览：⛶ 按钮 + 点照片直接放大（浏览当前筛选后的列表）
  grid.querySelectorAll('.tile-max').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openLightboxFromList(list, btn.dataset.id); });
  });
  grid.querySelectorAll('.media-tile img').forEach((img) => {
    img.classList.add('lb-zoomable');
    img.addEventListener('click', () => openLightboxFromList(list, img.closest('.media-tile')?.dataset.assetId));
  });
}

function insertSpinners(n) {
  const grid = $('#photo-gallery-grid');
  if (!grid) return;
  // remove existing empty-state if present
  const empty = grid.querySelector('.empty-state');
  if (empty) empty.remove();
  const spinners = Array.from({ length: n }, spinnerTileHtml).join('');
  grid.insertAdjacentHTML('afterbegin', spinners);
}

async function generatePhoto() {
  if (!state.currentArtistId) {
    toast('请先选择一名艺人', 'err');
    return;
  }
  if (photoState.generating) return;
  photoState.generating = true;

  const genBtn = $('#photo-generate-btn');
  const msgEl = $('#photo-gen-msg');
  if (genBtn) genBtn.disabled = true;
  if (msgEl) { msgEl.textContent = ''; }

  const stylePrompt = $('#photo-style-prompt') ? $('#photo-style-prompt').value.trim() : '';
  insertSpinners(photoState.count);

  const r = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/photo`, {
    shot: photoState.shot,
    aspect: photoState.aspect,
    count: photoState.count,
    stylePrompt,
  });

  photoState.generating = false;
  if (genBtn) genBtn.disabled = false;

  if (r.error) {
    if (msgEl) { msgEl.textContent = errText(r.error); msgEl.style.color = 'var(--err)'; }
    toast(errText(r.error), 'err');
    loadGallery();
    return;
  }

  if (msgEl) msgEl.textContent = '';
  toast(`已生成 ${(r.assets || []).length} 张写真`, 'ok');
  loadGallery();
}

function initPhotoStudio() {
  // segmented controls
  initSegCtrl('ctrl-shot', (v) => { photoState.shot = v; });
  initSegCtrl('ctrl-aspect', (v) => { photoState.aspect = v; });
  initSegCtrl('ctrl-count', (v) => { photoState.count = Number(v); });

  // filter chips
  const filterRow = $('#photo-filter-row');
  if (filterRow) {
    filterRow.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        filterRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        photoState.filter = chip.dataset.filter;
        loadGallery();
      });
    });
  }

  // generate button
  const genBtn = $('#photo-generate-btn');
  if (genBtn) genBtn.addEventListener('click', generatePhoto);
}

/* ── Video Studio (P2b) ── */

/**
 * Render an inline JobCard inside cardWrap for the given job data.
 * Does not re-query the DOM for the wrap element — caller must pass it.
 */
function renderVideoJobCard(job, cardWrap) {
  const isRunning = job.status === 'running' || job.status === 'queued';
  const progress = Number(job.progress) || 0;
  cardWrap.innerHTML = `<div class="job-card video-job-card">
    <div style="display:flex;align-items:center;gap:10px;">
      ${isRunning ? '<div class="job-spinner"></div>' : ''}
      <div class="job-info">
        <div class="job-cap">视频生成 · ${JOB_STATE[job.status] || esc(job.status)}</div>
        ${job.stage ? `<div class="job-stage">${esc(job.stage)}</div>` : ''}
      </div>
      ${job.costEstimate ? `<div class="job-cost">预估 $${esc(String(job.costEstimate.estimatedUsd))}</div>` : ''}
    </div>
    <div class="job-progress">
      <div class="progress-bar"><div class="fill" style="width:${progress}%"></div></div>
    </div>
    ${job.status === 'failed' && job.error ? `<div class="out" style="color:var(--err);">${esc(errText(job.error))}</div>` : ''}
  </div>`;
}

/**
 * Poll /api/jobs/:jobId every ~3s.
 * On done: hide the card wrap, reload gallery.
 * On failed: show error in card.
 */
function pollVideoJob(jobId, cardWrap) {
  let pollErrs = 0;
  const intervalId = setInterval(async () => {
    const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (data.error || !data.job) {
      if (++pollErrs >= 5) { clearInterval(intervalId); }
      return;
    }
    pollErrs = 0;
    const job = data.job;
    renderVideoJobCard(job, cardWrap);
    if (job.status === 'done') {
      clearInterval(intervalId);
      toast('视频已生成，加载画廊…', 'ok');
      setTimeout(() => {
        cardWrap.classList.add('hidden');
        loadGallery();
      }, 1200);
    } else if (job.status === 'failed' || job.status === 'interrupted') {
      clearInterval(intervalId);
      toast('视频生成失败', 'err');
    }
  }, 3000);
}

function initVideoStudio() {
  // Duration segmented control
  initSegCtrl('ctrl-video-duration', (v) => { videoState.durationSec = Number(v); });

  const btn = $('#video-studio-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!state.currentArtistId) {
      toast('请先选择一名艺人', 'err');
      return;
    }

    // Require at least one photo in gallery
    const galleryData = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery`);
    const assets = (galleryData.error ? [] : galleryData.assets || []);
    const hasPhoto = assets.some((a) => a.type !== 'video');
    if (!hasPhoto) {
      const msgEl = $('#video-gen-msg');
      if (msgEl) { msgEl.textContent = '请先生成一张写真作为首帧'; msgEl.style.color = 'var(--warn)'; }
      toast('请先生成一张写真作为首帧', 'err');
      return;
    }

    const prompt = $('#video-motion-prompt') ? $('#video-motion-prompt').value.trim() : '';
    const msgEl = $('#video-gen-msg');
    const cardWrap = $('#video-job-card-wrap');

    btn.disabled = true;
    if (msgEl) { msgEl.textContent = ''; msgEl.style.color = ''; }
    if (cardWrap) cardWrap.classList.add('hidden');

    const result = await submitWithConfirm(
      `/api/artist/${encodeURIComponent(state.currentArtistId)}/video`,
      { prompt, durationSec: videoState.durationSec },
      msgEl
    );

    btn.disabled = false;

    if (!result || !result.jobId) return;

    // Show inline JobCard and start polling
    if (cardWrap) {
      cardWrap.classList.remove('hidden');
      // initial placeholder card
      cardWrap.innerHTML = `<div class="job-card video-job-card">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="job-spinner"></div>
          <div class="job-info">
            <div class="job-cap">视频生成 · 排队</div>
          </div>
        </div>
        <div class="job-progress">
          <div class="progress-bar"><div class="fill" style="width:0%"></div></div>
        </div>
      </div>`;
      pollVideoJob(result.jobId, cardWrap);
    }
    renderCostJobs();
  });
}

/* ── Music Studio (S4) ── */
const musicState = { blueprint: null };

/**
 * Render an inline JobCard for a song job.
 */
function renderSongJobCard(job, cardWrap) {
  const isRunning = job.status === 'running' || job.status === 'queued';
  const progress = Number(job.progress) || 0;
  cardWrap.innerHTML = `<div class="job-card song-job-card">
    <div style="display:flex;align-items:center;gap:10px;">
      ${isRunning ? '<div class="job-spinner"></div>' : ''}
      <div class="job-info">
        <div class="job-cap">音乐渲染 · ${JOB_STATE[job.status] || esc(job.status)}</div>
        ${job.stage ? `<div class="job-stage">${esc(job.stage)}</div>` : ''}
      </div>
      ${job.costEstimate ? `<div class="job-cost">预估 $${esc(String(job.costEstimate.estimatedUsd))}</div>` : ''}
    </div>
    <div class="job-progress">
      <div class="progress-bar"><div class="fill" style="width:${progress}%"></div></div>
    </div>
    ${job.status === 'failed' && job.error ? `<div class="out" style="color:var(--err);">${esc(errText(job.error))}</div>` : ''}
  </div>`;
}

/**
 * Poll /api/jobs/:jobId every ~3s for a song job.
 * On done: reload music library. On failed: show error in card.
 */
function pollSongJob(jobId, cardWrap) {
  let pollErrs = 0;
  const intervalId = setInterval(async () => {
    const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (data.error || !data.job) {
      if (++pollErrs >= 5) { clearInterval(intervalId); }
      return;
    }
    pollErrs = 0;
    const job = data.job;
    renderSongJobCard(job, cardWrap);
    if (job.status === 'done') {
      clearInterval(intervalId);
      toast('歌曲已生成，加载作品库…', 'ok');
      setTimeout(() => {
        cardWrap.classList.add('hidden');
        loadMusicLibrary();
      }, 1200);
    } else if (job.status === 'failed' || job.status === 'interrupted') {
      clearInterval(intervalId);
      toast('歌曲渲染失败', 'err');
    }
  }, 3000);
}

/**
 * Load song tiles from artist gallery (type === 'song') into the music library grid.
 */
async function loadMusicLibrary() {
  const grid = $('#music-library-grid');
  if (!grid) return;
  if (!state.currentArtistId) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🎵</div>
      <div class="title">请先选择艺人</div>
      <div class="desc">从顶部艺人选择器选择或创设一名艺人。</div>
    </div>`;
    return;
  }
  const data = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery`);
  if (data.error) return;
  const songs = (data.assets || []).filter((a) => a.type === 'song');
  if (!songs.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🎵</div>
      <div class="title">还没有歌曲</div>
      <div class="desc">填写创作诉求，生成作曲蓝图，确认渲染后歌曲将在此显示。</div>
    </div>`;
    return;
  }
  grid.innerHTML = songs.map((s) => {
    const id = esc(s.id);
    const url = esc(s.url);
    const title = esc(s.title || '未命名');
    const style = esc(s.style || '');
    const isFav = s.favorite;
    return `<div class="song-tile" data-asset-id="${id}">
      <div class="song-tile-header">
        <div class="song-tile-title" title="${title}">${title}</div>
        ${style ? `<span class="tag">${style}</span>` : ''}
        <div class="song-tile-actions">
          <button class="tile-btn tile-fav${isFav ? ' faved' : ''}" data-id="${id}" title="${isFav ? '取消收藏' : '收藏'}">★</button>
          <button class="tile-btn tile-del" data-id="${id}" title="删除">🗑</button>
        </div>
      </div>
      <audio controls src="${url}" preload="none"></audio>
    </div>`;
  }).join('');

  // Bind tile actions
  grid.querySelectorAll('.tile-fav').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.currentArtistId) return;
      await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery/${encodeURIComponent(btn.dataset.id)}/favorite`, {});
      loadMusicLibrary();
    });
  });
  grid.querySelectorAll('.tile-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.currentArtistId) return;
      if (!confirm('确认删除这首歌曲？')) return;
      await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery/${encodeURIComponent(btn.dataset.id)}`, undefined, 'DELETE');
      loadMusicLibrary();
    });
  });
}

/**
 * Fill the blueprint card fields from an object.
 */
function fillBlueprint(bp) {
  const set = (id, v) => { const el = $(id); if (el) el.value = v ?? ''; };
  set('#music-bp-title', bp.title);
  set('#music-bp-style', bp.style);
  set('#music-bp-structure', bp.structure);
  set('#music-bp-lyrics', bp.lyrics);
  set('#music-bp-production', bp.productionNotes);
}

/**
 * Read the blueprint card fields back into an object.
 */
function readBlueprint() {
  const g = (id) => $(id)?.value?.trim() ?? '';
  return {
    title: g('#music-bp-title'),
    style: g('#music-bp-style'),
    structure: g('#music-bp-structure'),
    lyrics: g('#music-bp-lyrics'),
    productionNotes: g('#music-bp-production'),
  };
}

function initMusicStudio() {
  // ── Blueprint generation ──
  const blueprintBtn = $('#music-blueprint-btn');
  if (blueprintBtn) {
    blueprintBtn.addEventListener('click', async () => {
      if (!state.currentArtistId) {
        toast('请先选择一名艺人', 'err');
        return;
      }
      const brief = $('#music-brief') ? $('#music-brief').value.trim() : '';
      const msgEl = $('#music-blueprint-msg');
      blueprintBtn.disabled = true;
      if (msgEl) { msgEl.textContent = '生成作曲蓝图中…'; msgEl.style.color = ''; }

      const r = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/song/blueprint`, { brief });
      blueprintBtn.disabled = false;

      if (r.error) {
        if (msgEl) { msgEl.textContent = errText(r.error); msgEl.style.color = 'var(--err)'; }
        toast(errText(r.error), 'err');
        return;
      }

      if (msgEl) { msgEl.textContent = ''; }
      musicState.blueprint = r.blueprint;
      fillBlueprint(r.blueprint);

      // Show Stage 2
      const card = $('#music-blueprint-card');
      if (card) card.classList.remove('hidden');
      const pill = $('#music-blueprint-pill');
      if (pill) { pill.className = 'pill warn'; pill.textContent = '待确认'; }

      toast('作曲蓝图已生成，可编辑后确认渲染', 'ok');
    });
  }

  // ── Render (cost gate) ──
  const renderBtn = $('#music-render-btn');
  if (renderBtn) {
    renderBtn.addEventListener('click', async () => {
      if (!state.currentArtistId) {
        toast('请先选择一名艺人', 'err');
        return;
      }
      const blueprint = readBlueprint();
      const msgEl = $('#music-render-msg');
      const cardWrap = $('#music-job-card-wrap');

      renderBtn.disabled = true;
      if (cardWrap) cardWrap.classList.add('hidden');

      const result = await submitWithConfirm(
        `/api/artist/${encodeURIComponent(state.currentArtistId)}/song`,
        { blueprint },
        msgEl
      );

      renderBtn.disabled = false;

      if (!result || !result.jobId) return;

      // Update pill
      const pill = $('#music-blueprint-pill');
      if (pill) { pill.className = 'pill s2'; pill.textContent = '渲染中'; }

      // Show inline JobCard and start polling
      if (cardWrap) {
        cardWrap.classList.remove('hidden');
        cardWrap.innerHTML = `<div class="job-card song-job-card">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="job-spinner"></div>
            <div class="job-info">
              <div class="job-cap">音乐渲染 · 排队</div>
            </div>
          </div>
          <div class="job-progress">
            <div class="progress-bar"><div class="fill" style="width:0%"></div></div>
          </div>
        </div>`;
        pollSongJob(result.jobId, cardWrap);
      }
      renderCostJobs();
    });
  }

  // ── Library refresh button ──
  const refreshBtn = $('#music-library-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadMusicLibrary());
  }
}

/* ── Interview Studio (S5) ── */
const interviewState = { plan: null, dialogue: null };

/**
 * The 5 pipeline stages in order (backend names).
 * Map: script (done once dialogue exists), audio, subtitle, visual, final.
 */
const INTERVIEW_STAGES = ['script', 'audio', 'subtitle', 'visual', 'final'];

/**
 * Update the stepper dots: done / cur / pending.
 * stagesDone = set of completed stage names.
 * curStage   = name of current active stage (or null).
 */
function updateInterviewStepper(stagesDone, curStage) {
  const steps = $$('#interview-stepper .stepper-step');
  let pastCur = false;
  steps.forEach((step) => {
    const s = step.dataset.stage;
    const dot = step.querySelector('.stepper-dot');
    dot.className = 'stepper-dot';
    if (stagesDone.has(s)) {
      dot.classList.add('done');
      dot.textContent = '✓';
    } else if (s === curStage && !pastCur) {
      dot.classList.add('cur');
      dot.textContent = '';
      pastCur = true;
    } else {
      dot.classList.add('pending');
      dot.textContent = '';
    }
  });
}

/**
 * Render the editable dialogue rows from an array of {speaker, text}.
 */
function renderDialogueRows(dialogue) {
  const container = $('#interview-dialogue-rows');
  if (!container) return;
  container.innerHTML = dialogue
    .map((line, i) => {
      const spk = esc(line.speaker);
      const txt = esc(line.text);
      return `<div class="dialogue-row" data-idx="${i}">
        <span class="dialogue-speaker-badge">${spk}</span>
        <textarea class="dialogue-text-input" rows="2" data-idx="${i}">${txt}</textarea>
        <button class="tile-btn dialogue-del-btn" data-idx="${i}" title="删除">✕</button>
      </div>`;
    })
    .join('');

  // Bind delete buttons
  container.querySelectorAll('.dialogue-del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      interviewState.dialogue.splice(idx, 1);
      renderDialogueRows(interviewState.dialogue);
    });
  });
}

/**
 * Read current dialogue from the editable rows back into an array.
 */
function readDialogueRows() {
  const rows = $$('#interview-dialogue-rows .dialogue-row');
  const result = [];
  rows.forEach((row) => {
    const badge = row.querySelector('.dialogue-speaker-badge');
    const textarea = row.querySelector('.dialogue-text-input');
    if (!badge || !textarea) return;
    const text = textarea.value.trim();
    if (text) result.push({ speaker: badge.textContent, text });
  });
  return result;
}

/**
 * Load interview assets (type==='interview') into the library grid.
 */
async function loadInterviewLibrary() {
  const grid = $('#interview-library-grid');
  if (!grid) return;
  if (!state.currentArtistId) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🎬</div>
      <div class="title">请先选择艺人</div>
    </div>`;
    return;
  }
  const data = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery`);
  if (data.error) return;
  const interviews = (data.assets || []).filter((a) => a.type === 'interview');
  if (!interviews.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🎬</div>
      <div class="title">还没有成片</div>
      <div class="desc">完成上方流程后，成片将自动存入此处。</div>
    </div>`;
    return;
  }
  grid.innerHTML = interviews.map((v) => {
    const url = esc(v.url);
    const id = esc(v.id);
    const dur = v.durationSec ? `${esc(String(v.durationSec))}s` : '';
    const title = esc(v.title || '访谈成片');
    const isAudio = /\.mp3($|\?)/i.test(v.url || '');   // 语音对谈记录是 mp3，用 audio 播放器（否则黑屏）
    const player = isAudio
      ? `<audio src="${url}" controls preload="metadata" class="interview-tile-player" style="width:100%"></audio>`
      : `<video src="${url}" controls preload="metadata" class="interview-tile-player"></video>`;
    return `<div class="interview-video-tile">
      ${player}
      <div class="interview-tile-meta">
        <span class="interview-tile-title">${title}</span>
        ${dur ? `<span class="text-ink-3">${dur}</span>` : ''}
        ${isAudio ? '' : `<button class="tile-btn tile-max" data-id="${id}" title="放大浏览">⛶</button>`}
        <button class="tile-btn tile-del" data-id="${id}" title="删除">🗑</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.tile-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.currentArtistId) return;
      if (!confirm('确认删除这个成片？')) return;
      await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery/${encodeURIComponent(btn.dataset.id)}`, undefined, 'DELETE');
      loadInterviewLibrary();
    });
  });
  // 放大浏览：在访谈成片(视频)之间前后翻
  const lbList = interviews.filter((v) => !/\.mp3($|\?)/i.test(v.url || ''));
  grid.querySelectorAll('.tile-max').forEach((btn) => {
    btn.addEventListener('click', () => openLightboxFromList(lbList, btn.dataset.id));
  });
}

function initInterviewStudio() {
  // ── Plan generation ──
  const planBtn = $('#interview-plan-btn');
  if (planBtn) {
    planBtn.addEventListener('click', async () => {
      if (!state.currentArtistId) {
        toast('请先选择一名艺人', 'err');
        return;
      }
      const topic = $('#interview-topic') ? $('#interview-topic').value.trim() : '';
      if (!topic) {
        toast('请输入访谈主题', 'err');
        return;
      }
      const msgEl = $('#interview-plan-msg');
      planBtn.disabled = true;
      if (msgEl) { msgEl.textContent = '生成企划中…'; msgEl.style.color = ''; }

      const r = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/interview/plan`, { topic });
      planBtn.disabled = false;

      if (r.error) {
        if (msgEl) { msgEl.textContent = errText(r.error); msgEl.style.color = 'var(--err)'; }
        toast(errText(r.error), 'err');
        return;
      }

      if (msgEl) { msgEl.textContent = ''; }
      interviewState.plan = r.plan;

      // Fill 企划卡
      const angleEl = $('#interview-plan-angle');
      if (angleEl) angleEl.textContent = r.plan.angle || '';
      const qList = $('#interview-plan-questions');
      if (qList) {
        qList.innerHTML = (r.plan.questions || [])
          .map((q) => `<li>${esc(q)}</li>`)
          .join('');
      }

      // Show plan card
      const planCard = $('#interview-plan-card');
      if (planCard) planCard.classList.remove('hidden');

      toast('访谈企划已生成', 'ok');
    });
  }

  // ── Script generation ──
  const scriptBtn = $('#interview-script-btn');
  if (scriptBtn) {
    scriptBtn.addEventListener('click', async () => {
      if (!state.currentArtistId || !interviewState.plan) {
        toast('请先生成访谈企划', 'err');
        return;
      }
      const msgEl = $('#interview-script-msg');
      scriptBtn.disabled = true;
      if (msgEl) { msgEl.textContent = '生成脚本中…'; msgEl.style.color = ''; }

      const r = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/interview/script`, { plan: interviewState.plan });
      scriptBtn.disabled = false;

      if (r.error) {
        if (msgEl) { msgEl.textContent = errText(r.error); msgEl.style.color = 'var(--err)'; }
        toast(errText(r.error), 'err');
        return;
      }

      if (msgEl) { msgEl.textContent = ''; }
      interviewState.dialogue = r.dialogue || [];
      renderDialogueRows(interviewState.dialogue);

      // Show script card
      const scriptCard = $('#interview-script-card');
      if (scriptCard) scriptCard.classList.remove('hidden');

      toast('脚本已生成，可编辑后合成', 'ok');
    });
  }

  // ── Compose (SSE) ──
  const composeBtn = $('#interview-compose-btn');
  if (composeBtn) {
    composeBtn.addEventListener('click', async () => {
      if (!state.currentArtistId) {
        toast('请先选择一名艺人', 'err');
        return;
      }

      // Require at least one photo
      const galleryData = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery`);
      const assets = galleryData.error ? [] : (galleryData.assets || []);
      const hasPhoto = assets.some((a) => a.type === 'photo' || (a.type !== 'video' && a.type !== 'song' && a.type !== 'interview'));
      const noticeEl = $('#interview-photo-notice');
      if (!hasPhoto) {
        if (noticeEl) noticeEl.classList.remove('hidden');
        toast('请先在写真页生成一张写真作为画面', 'err');
        return;
      }
      if (noticeEl) noticeEl.classList.add('hidden');

      // Read edited dialogue from rows
      const dialogue = readDialogueRows();
      if (!dialogue.length) {
        toast('逐字稿为空，请先生成脚本', 'err');
        return;
      }

      const msgEl = $('#interview-compose-msg');
      composeBtn.disabled = true;
      if (msgEl) { msgEl.textContent = ''; }

      // Show stepper card, hide result card
      const stepperCard = $('#interview-stepper-card');
      const resultCard = $('#interview-result-card');
      if (stepperCard) stepperCard.classList.remove('hidden');
      if (resultCard) resultCard.classList.add('hidden');

      // Stage 0: script is already done (we have dialogue)
      const stagesDone = new Set(['script']);
      updateInterviewStepper(stagesDone, 'audio');
      const progressFill = $('#interview-progress-fill');
      const stageMsgEl = $('#interview-stage-msg');
      if (progressFill) progressFill.style.width = '20%';
      if (stageMsgEl) stageMsgEl.textContent = '脚本已就绪，开始配音…';

      try {
        const res = await fetch(
          `/api/artist/${encodeURIComponent(state.currentArtistId)}/interview/compose`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dialogue }) }
        );

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: { code: 'bad_response', message: `HTTP ${res.status}` } }));
          composeBtn.disabled = false;
          if (msgEl) { msgEl.textContent = errText(err.error || err); msgEl.style.color = 'var(--err)'; }
          if (stepperCard) stepperCard.classList.add('hidden');
          return;
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let carry = '';
        let done = false;

        // Stage → index map for progress calculation
        const stageOrder = { script: 0, audio: 1, subtitle: 2, visual: 3, final: 4 };
        const totalStages = 5;

        while (!done) {
          const { done: rdDone, value } = await reader.read();
          if (rdDone) break;
          carry += dec.decode(value, { stream: true });
          let i;
          while ((i = carry.indexOf('\n\n')) >= 0) {
            const block = carry.slice(0, i);
            carry = carry.slice(i + 2);
            const ev = (block.match(/^event: (.*)$/m) || [])[1];
            const dataLine = (block.match(/^data: (.*)$/m) || [])[1];
            if (!dataLine) continue;
            let payload;
            try { payload = JSON.parse(dataLine); } catch { continue; }

            if (ev === 'stage') {
              const stage = payload.stage;
              // Mark previous stages as done
              const idx = stageOrder[stage] ?? 0;
              for (const [s, si] of Object.entries(stageOrder)) {
                if (si < idx) stagesDone.add(s);
              }
              updateInterviewStepper(stagesDone, stage);
              const pct = Math.round(((idx + 0.5) / totalStages) * 100);
              if (progressFill) progressFill.style.width = `${pct}%`;
              if (stageMsgEl) stageMsgEl.textContent = payload.msg || stage;

            } else if (ev === 'done') {
              done = true;
              // All stages done
              INTERVIEW_STAGES.forEach((s) => stagesDone.add(s));
              updateInterviewStepper(stagesDone, null);
              if (progressFill) progressFill.style.width = '100%';
              if (stageMsgEl) stageMsgEl.textContent = '合成完成！';

              // Show result video
              const videoEl = $('#interview-result-video');
              if (videoEl && payload.url) videoEl.src = esc(payload.url);
              if (resultCard) resultCard.classList.remove('hidden');

              // Reload library
              await loadInterviewLibrary();
              toast('访谈成片已生成，已存入作品库', 'ok');

            } else if (ev === 'error') {
              done = true;
              composeBtn.disabled = false;
              if (msgEl) { msgEl.textContent = errText(payload); msgEl.style.color = 'var(--err)'; }
              if (stepperCard) stepperCard.classList.add('hidden');
              toast(payload.message || '合成失败', 'err');
            }
          }
        }

        composeBtn.disabled = false;

      } catch (e) {
        composeBtn.disabled = false;
        if (msgEl) { msgEl.textContent = `连接失败：${esc(e.message)}`; msgEl.style.color = 'var(--err)'; }
        if (stepperCard) stepperCard.classList.add('hidden');
        toast(`合成失败：${e.message}`, 'err');
      }
    });
  }

  // ── Library refresh ──
  const libRefreshBtn = $('#interview-library-refresh');
  if (libRefreshBtn) {
    libRefreshBtn.addEventListener('click', () => loadInterviewLibrary());
  }
}

/* ════════════════════════════════════════════════════════
   短剧工坊 (S6 Drama Studio) — 7-stage pipeline
   立项 → 剧本 → 选角 → 分镜 → 出片 → 成片 → 连播
   ════════════════════════════════════════════════════════ */

const dramaState = {
  drama: null,
  episodeCount: 2,
  durationSec: 30,
  busy: false,
};

const DRAMA_STAGES = ['project', 'script', 'cast', 'storyboard', 'compose', 'final', 'collection'];

/** Build the artist base path; null if no artist. */
function dramaBase() {
  if (!state.currentArtistId) return null;
  return `/api/artist/${encodeURIComponent(state.currentArtistId)}/drama`;
}

/** Derive a friendly filename from a url (strip query + path). */
function urlFilename(url) {
  if (!url) return '';
  try {
    const clean = String(url).split('?')[0].split('#')[0];
    const name = clean.substring(clean.lastIndexOf('/') + 1);
    return decodeURIComponent(name) || clean;
  } catch { return String(url); }
}

/**
 * 打开画廊选择器浮层：kind='song'|'photo'；onPick(asset) 选中回调（自动关闭）。复用 /gallery + 既有瓦片样式。
 * 点击背景或 ✕ 关闭（不选）；每次打开重建 grid + 用 cloneNode 清掉旧监听，避免泄漏。
 */
async function openGalleryPicker(kind, onPick) {
  const overlay = $('#gallery-picker');
  if (!overlay) return;
  const titleEl = overlay.querySelector('.gp-title');
  const grid = overlay.querySelector('.gp-grid');
  const closeBtn = overlay.querySelector('.gp-close');
  if (!grid || !state.currentArtistId) return;

  const isSong = kind === 'song';
  if (titleEl) titleEl.textContent = isSong ? '选择主题曲' : '选择写真';

  const close = () => {
    overlay.hidden = true;
    overlay.classList.remove('open');
    grid.innerHTML = '';
  };

  // Fresh backdrop / close listeners each open (no leak): clone-replace the close button.
  const newClose = closeBtn ? closeBtn.cloneNode(true) : null;
  if (closeBtn && newClose) closeBtn.replaceWith(newClose);
  if (newClose) newClose.addEventListener('click', close);
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  grid.innerHTML = '<div class="gp-empty">加载中…</div>';
  overlay.hidden = false;
  overlay.classList.add('open');

  const data = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery`);
  if (data.error) { grid.innerHTML = `<div class="gp-empty">${esc(errText(data.error))}</div>`; return; }
  const items = (data.assets || []).filter((a) => a.type === kind);

  if (!items.length) {
    grid.innerHTML = `<div class="gp-empty">${isSong
      ? '作品库还没有歌，先去音乐工坊创作'
      : '写真库还没有图，先去写真工作室生成'}</div>`;
    return;
  }

  grid.innerHTML = items.map((a, i) => {
    const url = esc(a.url || '');
    const name = esc(a.title || urlFilename(a.url) || (isSong ? '未命名' : '写真'));
    if (isSong) {
      return `<div class="gp-card gp-card-song" data-idx="${i}">
        <div class="gp-card-title" title="${name}">${name}</div>
        <audio controls preload="none" src="${url}"></audio>
      </div>`;
    }
    return `<div class="gp-card gp-card-photo" data-idx="${i}">
      <img src="${url}" alt="" loading="lazy">
      <div class="gp-card-cap" title="${name}">${name}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.gp-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      // 让 audio 控件本身可点击播放，不触发选中
      if (e.target.closest('audio')) return;
      const asset = items[Number(card.dataset.idx)];
      if (!asset) return;
      close();
      if (onPick) onPick(asset);
    });
  });
}

/**
 * Generic SSE POST reader (mirrors interview compose).
 * Resolves when the stream ends. Calls onStage(payload)/onDone(payload)/onError(payload).
 * Returns true if a `done` event was seen, false otherwise.
 */
async function dramaSSE(path, body, { onStage, onDone, onError } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    if (onError) onError({ code: 'network', message: e.message });
    return false;
  }
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: { code: 'bad_response', message: `HTTP ${res.status}` } }));
    if (onError) onError(err.error || err);
    return false;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let carry = '';
  let sawDone = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    let i;
    while ((i = carry.indexOf('\n\n')) >= 0) {
      const block = carry.slice(0, i);
      carry = carry.slice(i + 2);
      const ev = (block.match(/^event: (.*)$/m) || [])[1];
      const dataLine = (block.match(/^data: (.*)$/m) || [])[1];
      if (!dataLine) continue;
      let payload;
      try { payload = JSON.parse(dataLine); } catch { continue; }
      if (ev === 'stage') { if (onStage) onStage(payload); }
      else if (ev === 'done') { sawDone = true; if (onDone) await onDone(payload); }   // onDone 可能 async（成片后拉取最新 drama），需 await 以保证顺序
      else if (ev === 'error') { if (onError) onError(payload); }
    }
  }
  return sawDone;
}

/** Update the 7-stage stepper from current drama state. */
function updateDramaStepper(drama) {
  const done = new Set(['project']);
  let cur = 'script';
  if (drama) {
    done.add('project');
    if ((drama.episodes || []).length) done.add('script');
    // cast done if all non-lead cast have a portrait
    const support = (drama.cast || []).filter((c) => !c.isLead);
    const castDone = support.length > 0 && support.every((c) => c.portrait && c.portrait.current >= 0);
    if (castDone) done.add('cast');
    // storyboard done if every scene has a frame
    const eps = drama.episodes || [];
    const allScenes = eps.flatMap((e) => e.scenes || []);
    const sbDone = allScenes.length > 0 && allScenes.every((s) => s.frame && s.frame.current >= 0);
    if (sbDone) done.add('storyboard');
    // compose done if any episode composed
    const anyComposed = eps.some((e) => e.episodeUrl);
    if (anyComposed) { done.add('compose'); done.add('final'); }
    if (drama.collectionUrl) done.add('collection');
    // current = first not-done stage
    cur = DRAMA_STAGES.find((s) => !done.has(s)) || null;
  }
  const steps = $$('#drama-stepper .stepper-step');
  let pastCur = false;
  steps.forEach((step) => {
    const s = step.dataset.stage;
    const dot = step.querySelector('.stepper-dot');
    dot.className = 'stepper-dot';
    if (done.has(s)) { dot.classList.add('done'); dot.textContent = '✓'; }
    else if (s === cur && !pastCur) { dot.classList.add('cur'); dot.textContent = ''; pastCur = true; }
    else { dot.classList.add('pending'); dot.textContent = ''; }
  });
}

/** Show the project list / 立项 pane; hide the work pane. */
function enterDramaProjectList() {
  dramaState.drama = null;
  const proj = $('#drama-project-pane');
  const work = $('#drama-work-pane');
  if (proj) proj.classList.remove('hidden');
  if (work) work.classList.add('hidden');
  loadDramaList();
}

/** GET dramas list and render cards. */
async function loadDramaList() {
  const grid = $('#drama-list-grid');
  if (!grid) return;
  const base = dramaBase();
  if (!base) { grid.innerHTML = ''; return; }
  const data = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/dramas`);
  if (data.error) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="icon">🎞️</div><div class="title">${esc(errText(data.error))}</div></div>`; return; }
  const dramas = data.dramas || [];
  if (!dramas.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🎞️</div>
      <div class="title">还没有短剧</div>
      <div class="desc">在上方填写题材与集数，立项一部新短剧。</div>
    </div>`;
    return;
  }
  grid.innerHTML = dramas.map((d) => {
    const eps = (d.episodes || []).length;
    const composed = (d.episodes || []).filter((e) => e.episodeUrl).length;
    return `<div class="drama-list-card" data-did="${esc(d.id)}">
      <div class="drama-list-title">${esc(d.title || '未命名短剧')}</div>
      <div class="drama-list-meta">${esc(d.theme || '')}</div>
      <div class="drama-list-tags">
        <span class="pill dim">${eps} 集</span>
        ${composed ? `<span class="pill ok">已出片 ${composed}</span>` : '<span class="pill dim">未出片</span>'}
        ${d.collectionUrl ? '<span class="pill s2">已连播</span>' : ''}
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.drama-list-card').forEach((card) => {
    card.addEventListener('click', () => openDrama(card.dataset.did));
  });
}

/** GET drama detail and switch to work pane. */
async function openDrama(did) {
  const base = dramaBase();
  if (!base) return;
  const data = await api(`${base}/${encodeURIComponent(did)}`);
  if (data.error) { toast(errText(data.error), 'err'); return; }
  dramaState.drama = data.drama;
  const proj = $('#drama-project-pane');
  const work = $('#drama-work-pane');
  if (proj) proj.classList.add('hidden');
  if (work) work.classList.remove('hidden');
  renderDrama(data.drama);
}

/** Master render: header, stepper, and all stage panels. */
function renderDrama(drama) {
  dramaState.drama = drama;
  if (!drama) return;

  // Header
  const titleEl = $('#drama-work-title');
  if (titleEl) titleEl.textContent = drama.title || '未命名短剧';
  const themeEl = $('#drama-work-theme');
  if (themeEl) themeEl.textContent = drama.theme || '';
  const cpill = $('#drama-consistency-pill');
  if (cpill) {
    if (drama.consistencyMode === 'image_ref') cpill.textContent = '已启用图像参考锁脸';
    else cpill.textContent = '当前为描述级一致性';
  }

  updateDramaStepper(drama);
  renderDramaScript(drama);
  renderDramaCast(drama);
  renderDramaStoryboard(drama);
  renderDramaCompose(drama);
  renderDramaCollection(drama);
}

/* ── 剧本 stage ── */
function renderDramaScript(drama) {
  const loglineEl = $('#drama-edit-logline');
  if (loglineEl) loglineEl.value = drama.logline || '';

  // cast summary (read-only cards)
  const castWrap = $('#drama-cast-summary');
  if (castWrap) {
    castWrap.innerHTML = (drama.cast || []).map((c) => `
      <div class="drama-cast-card">
        <div class="drama-cast-name">${esc(c.name)} ${c.isLead ? '<span class="pill s2">主演</span>' : '<span class="pill dim">配角</span>'}</div>
        <div class="drama-cast-role">${esc(c.role || '')}</div>
        <div class="drama-cast-appearance">${esc(c.appearance || '')}</div>
      </div>`).join('');
  }

  // scenes editable
  const scenesWrap = $('#drama-scenes-edit');
  if (scenesWrap) {
    scenesWrap.innerHTML = (drama.episodes || []).map((ep) => `
      <div class="drama-ep-block">
        <div class="drama-ep-head">第 ${esc(String(ep.index))} 集 · ${esc(ep.title || '')}</div>
        ${(ep.scenes || []).map((sc) => `
          <div class="drama-scene-edit" data-eid="${esc(ep.id)}" data-sid="${esc(sc.id)}">
            <div class="drama-scene-head">场景 ${esc(String(sc.index))} · ${esc(sc.setting || '')}</div>
            <div class="field mb-8">
              <div class="label-upper">动作</div>
              <textarea class="dialogue-text-input drama-scene-action" rows="2">${esc(sc.action || '')}</textarea>
            </div>
            <div class="label-upper mb-4">台词</div>
            <div class="drama-lines">
              ${(sc.lines || []).map((ln, li) => `
                <div class="drama-line-row" data-li="${li}">
                  <span class="dialogue-speaker-badge">${esc(ln.character || '')}</span>
                  <textarea class="dialogue-text-input drama-line-text" rows="1">${esc(ln.text || '')}</textarea>
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>`).join('');
  }
}

/** Serialize edited script back into episodes/logline and PUT. */
async function saveDramaScript() {
  const drama = dramaState.drama;
  if (!drama) return;
  const base = dramaBase();
  if (!base) return;

  // Deep-ish clone episodes so we mutate a copy
  const episodes = JSON.parse(JSON.stringify(drama.episodes || []));
  const byScene = {};
  episodes.forEach((ep) => (ep.scenes || []).forEach((sc) => { byScene[`${ep.id}|${sc.id}`] = sc; }));

  $$('#drama-scenes-edit .drama-scene-edit').forEach((scEl) => {
    const key = `${scEl.dataset.eid}|${scEl.dataset.sid}`;
    const sc = byScene[key];
    if (!sc) return;
    const actEl = scEl.querySelector('.drama-scene-action');
    if (actEl) sc.action = actEl.value;
    const lineRows = scEl.querySelectorAll('.drama-line-row');
    lineRows.forEach((row) => {
      const li = Number(row.dataset.li);
      const txtEl = row.querySelector('.drama-line-text');
      if (sc.lines && sc.lines[li] && txtEl) sc.lines[li].text = txtEl.value;
    });
  });

  const loglineEl = $('#drama-edit-logline');
  const logline = loglineEl ? loglineEl.value : drama.logline;

  const msgEl = $('#drama-save-msg');
  const btn = $('#drama-save-script-btn');
  if (btn) btn.disabled = true;
  if (msgEl) { msgEl.textContent = '保存中…'; msgEl.style.color = ''; }

  const r = await api(`${base}/${encodeURIComponent(drama.id)}`, { logline, episodes }, 'PUT');
  if (btn) btn.disabled = false;
  if (r.error) { if (msgEl) { msgEl.textContent = errText(r.error); msgEl.style.color = 'var(--err)'; } toast(errText(r.error), 'err'); return; }
  if (msgEl) { msgEl.textContent = '已保存'; msgEl.style.color = 'var(--ok)'; }
  renderDrama(r.drama);
  toast('剧本已保存', 'ok');
}

/* ── 选角 stage ── */
function renderDramaCast(drama) {
  const notice = $('#drama-cast-notice');
  if (notice) {
    notice.textContent = drama.consistencyMode === 'image_ref'
      ? '已启用图像参考锁脸：主演沿用一致性包定妆照，配角按描述出图。'
      : '当前为描述级一致性：主演沿用一致性包，配角按描述出图。';
  }
  const wrap = $('#drama-cast-portraits');
  if (!wrap) return;
  wrap.innerHTML = (drama.cast || []).map((c) => {
    // portrait.current 是版本下标（-1 表示无）；取对应版本的 url
    const pv = c.portrait && c.portrait.current >= 0 ? c.portrait.versions[c.portrait.current] : null;
    const url = pv ? esc(pv.url) : '';
    const lead = c.isLead;
    return `<div class="drama-cast-card">
      <div class="drama-portrait-wrap">
        ${url ? `<img src="${url}" alt="" loading="lazy">` : `<div class="drama-portrait-empty">${lead ? '主演一致性包' : '待生成'}</div>`}
        ${lead ? '<span class="lock-badge drama-portrait-badge">⬡ 一致性</span>' : ''}
      </div>
      <div class="drama-cast-name">${esc(c.name)} ${lead ? '<span class="pill s2">主演</span>' : '<span class="pill dim">配角</span>'}</div>
      <div class="drama-cast-role">${esc(c.role || '')}</div>
      <div class="drama-cast-actions">
        <button class="tile-btn drama-cast-pick" data-cid="${esc(c.id)}" title="从写真库选定妆照">从写真库选</button>
      </div>
    </div>`;
  }).join('');

  // bind 「从写真库选」: 打开写真选择器 → 设为该角色定妆照
  wrap.querySelectorAll('.drama-cast-pick').forEach((btn) => {
    btn.addEventListener('click', () => pickCastPortrait(btn.dataset.cid));
  });
}

/** Open the photo picker and set the chosen photo as a cast member's portrait. */
function pickCastPortrait(cid) {
  if (!cid) return;
  openGalleryPicker('photo', async (asset) => {
    const base = dramaBase();
    const drama = dramaState.drama;
    if (!base || !drama) return;
    const r = await api(`${base}/${encodeURIComponent(drama.id)}/cast/${encodeURIComponent(cid)}/portrait`, { url: asset.url });
    if (r.error) { toast(errText(r.error), 'err'); return; }
    renderDrama(r.drama);
    toast('已设为定妆照', 'ok');
  });
}

/* ── 分镜 stage ── */
function renderDramaStoryboard(drama) {
  const wrap = $('#drama-storyboard-episodes');
  if (!wrap) return;
  wrap.innerHTML = (drama.episodes || []).map((ep) => {
    const scenesDone = (ep.scenes || []).filter((s) => s.frame && s.frame.current >= 0).length;
    const total = (ep.scenes || []).length;
    return `<div class="drama-ep-block" data-eid="${esc(ep.id)}">
      <div class="drama-ep-head">
        第 ${esc(String(ep.index))} 集 · ${esc(ep.title || '')}
        <span class="pill dim">${scenesDone}/${total} 分镜</span>
        <button class="btn btn-primary btn-sm drama-sb-gen-btn" data-eid="${esc(ep.id)}" style="margin-left:auto;">✦ 生成分镜</button>
      </div>
      <div class="drama-sb-grid">
        ${(ep.scenes || []).map((sc) => {
          const versions = (sc.frame && sc.frame.versions) || [];
          const curIdx = sc.frame ? sc.frame.current : -1;   // 版本下标（-1 无）
          const curUrl = curIdx >= 0 && versions[curIdx] ? esc(versions[curIdx].url) : '';
          return `<div class="drama-sb-cell" data-eid="${esc(ep.id)}" data-sid="${esc(sc.id)}">
            <div class="drama-sb-thumb">
              ${curUrl ? `<img src="${curUrl}" alt="" loading="lazy">` : '<div class="drama-sb-empty">无分镜</div>'}
              ${versions.length > 1 ? `<span class="drama-sb-vbadge">${curIdx >= 0 ? curIdx + 1 : 1}/${versions.length}</span>` : ''}
            </div>
            <div class="drama-sb-meta">${esc(sc.setting || ('场景 ' + sc.index))}</div>
            <div class="drama-sb-actions">
              ${versions.length > 1 ? `
                <button class="tile-btn drama-sb-prev" data-eid="${esc(ep.id)}" data-sid="${esc(sc.id)}" title="上一版">‹</button>
                <button class="tile-btn drama-sb-next" data-eid="${esc(ep.id)}" data-sid="${esc(sc.id)}" title="下一版">›</button>` : ''}
              <button class="tile-btn drama-sb-reframe" data-eid="${esc(ep.id)}" data-sid="${esc(sc.id)}" title="重抽">↻ 重抽</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  // bind storyboard buttons
  wrap.querySelectorAll('.drama-sb-gen-btn').forEach((btn) => {
    btn.addEventListener('click', () => generateStoryboard(btn.dataset.eid, btn));
  });
  wrap.querySelectorAll('.drama-sb-reframe').forEach((btn) => {
    btn.addEventListener('click', () => reframeScene(btn.dataset.eid, btn.dataset.sid, btn));
  });
  wrap.querySelectorAll('.drama-sb-prev').forEach((btn) => {
    btn.addEventListener('click', () => switchFrame(btn.dataset.eid, btn.dataset.sid, -1));
  });
  wrap.querySelectorAll('.drama-sb-next').forEach((btn) => {
    btn.addEventListener('click', () => switchFrame(btn.dataset.eid, btn.dataset.sid, +1));
  });
}

function findScene(drama, eid, sid) {
  const ep = (drama.episodes || []).find((e) => e.id === eid);
  if (!ep) return {};
  const sc = (ep.scenes || []).find((s) => s.id === sid);
  return { ep, sc };
}

async function reframeScene(eid, sid, btn) {
  const base = dramaBase();
  const drama = dramaState.drama;
  if (!base || !drama) return;
  if (btn) btn.disabled = true;
  toast('重抽分镜中…', '');
  const r = await api(`${base}/${encodeURIComponent(drama.id)}/episode/${encodeURIComponent(eid)}/scene/${encodeURIComponent(sid)}/reframe`, {});
  if (btn) btn.disabled = false;
  if (r.error) { toast(errText(r.error), 'err'); return; }
  renderDrama(r.drama);
  toast('已生成新版分镜', 'ok');
}

async function switchFrame(eid, sid, dir) {
  const base = dramaBase();
  const drama = dramaState.drama;
  if (!base || !drama) return;
  const { sc } = findScene(drama, eid, sid);
  if (!sc || !sc.frame) return;
  const versions = sc.frame.versions || [];
  if (versions.length < 2) return;
  let idx = sc.frame.current >= 0 ? sc.frame.current : 0;   // current 即版本下标
  idx = (idx + dir + versions.length) % versions.length;
  const r = await api(`${base}/${encodeURIComponent(drama.id)}/episode/${encodeURIComponent(eid)}/scene/${encodeURIComponent(sid)}/frame`, { index: idx });
  if (r.error) { toast(errText(r.error), 'err'); return; }
  renderDrama(r.drama);
}

async function generateStoryboard(eid, btn) {
  const base = dramaBase();
  const drama = dramaState.drama;
  if (!base || !drama) return;
  if (dramaState.busy) { toast('请等待当前任务完成', 'err'); return; }
  const path = `${base}/${encodeURIComponent(drama.id)}/episode/${encodeURIComponent(eid)}/storyboard`;

  // estimate (no confirm)
  const est = await api(path, {});
  if (est.error && est.error.code === 'confirm_required') {
    showCostConfirm('drama-sb', est.error.estimate, '生成分镜图', async () => {
      await runStoryboardSSE(path, btn);
    });
    return;
  }
  if (est.error) { toast(errText(est.error), 'err'); return; }
  // no confirm needed → run directly (unlikely, but handle)
  await runStoryboardSSE(path, btn);
}

async function runStoryboardSSE(path, btn) {
  dramaState.busy = true;
  if (btn) btn.disabled = true;
  toast('分镜出图中…', '');
  let lastErr = null;
  await dramaSSE(path, { confirm: true }, {
    onStage: (p) => { /* progress per scene */ },
    onDone: (p) => { if (p.drama) renderDrama(p.drama); },
    onError: (p) => { lastErr = p; },
  });
  dramaState.busy = false;
  if (btn) btn.disabled = false;
  if (lastErr) { toast(lastErr.message || '分镜生成失败', 'err'); return; }
  toast('分镜已生成', 'ok');
}

/* ── 出片 + 成片 stage ── */
// 缓存一次画廊歌曲列表，用于把 themeSongUrl 解析成友好曲名（出片阶段渲染时拉取）
let dramaSongCache = [];

/** Friendly theme-song name for a url: match cached gallery songs, else filename. */
function themeSongName(url) {
  if (!url) return '';
  const hit = dramaSongCache.find((s) => s.url === url);
  if (hit) return hit.title || urlFilename(url);
  return urlFilename(url);
}

function renderDramaCompose(drama) {
  const wrap = $('#drama-compose-episodes');
  if (!wrap) return;
  wrap.innerHTML = (drama.episodes || []).map((ep) => {
    const tier = ep.tier || 'low';
    const hasTheme = !!ep.themeSongUrl;
    const themeLabel = hasTheme ? esc(themeSongName(ep.themeSongUrl)) : '<span class="text-ink-3">无</span>';
    return `<div class="drama-ep-block" data-eid="${esc(ep.id)}">
      <div class="drama-ep-head">
        第 ${esc(String(ep.index))} 集 · ${esc(ep.title || '')}
        ${ep.episodeUrl ? '<span class="pill ok">已出片</span>' : '<span class="pill dim">未出片</span>'}
      </div>
      <div class="drama-theme-row">
        <span class="drama-theme-label">主题曲：</span>
        <span class="drama-theme-name">${themeLabel}</span>
        <button class="tile-btn drama-theme-pick" data-eid="${esc(ep.id)}">选主题曲</button>
        ${hasTheme ? `<button class="tile-btn drama-theme-clear" data-eid="${esc(ep.id)}">清除</button>` : ''}
      </div>
      <div class="drama-compose-row">
        <div class="tier-toggle" data-eid="${esc(ep.id)}">
          <button class="tier-btn${tier === 'low' ? ' active' : ''}" data-tier="low" data-eid="${esc(ep.id)}">低成本</button>
          <button class="tier-btn${tier === 'high' ? ' active' : ''}" data-tier="high" data-eid="${esc(ep.id)}">高质量</button>
        </div>
        <button class="btn btn-primary btn-sm drama-compose-btn" data-eid="${esc(ep.id)}">✦ 成片</button>
      </div>
      <div class="drama-compose-progress hidden" data-eid="${esc(ep.id)}">
        <div class="progress-bar mb-8"><div class="fill" style="width:0%"></div></div>
        <div class="drama-compose-stage-msg text-sm text-ink-3"></div>
      </div>
      ${ep.episodeUrl ? `<video class="drama-ep-player" src="${esc(ep.episodeUrl)}" controls preload="metadata"></video>` : ''}
    </div>`;
  }).join('');

  // tier toggles
  wrap.querySelectorAll('.tier-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const grp = btn.closest('.tier-toggle');
      grp.querySelectorAll('.tier-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  // compose buttons
  wrap.querySelectorAll('.drama-compose-btn').forEach((btn) => {
    btn.addEventListener('click', () => composeEpisode(btn.dataset.eid, btn));
  });
  // theme-song pick / clear
  wrap.querySelectorAll('.drama-theme-pick').forEach((btn) => {
    btn.addEventListener('click', () => pickEpisodeTheme(btn.dataset.eid));
  });
  wrap.querySelectorAll('.drama-theme-clear').forEach((btn) => {
    btn.addEventListener('click', () => setEpisodeTheme(btn.dataset.eid, null));
  });

  // refresh song cache once, then re-resolve names (only if it changed something)
  refreshDramaSongCache();
}

/** Fetch gallery songs once and re-render theme labels if names resolve. */
async function refreshDramaSongCache() {
  if (!state.currentArtistId) return;
  const data = await api(`/api/artist/${encodeURIComponent(state.currentArtistId)}/gallery`);
  if (data.error) return;
  const songs = (data.assets || []).filter((a) => a.type === 'song');
  dramaSongCache = songs;
  // update any rendered theme names in place (avoid full re-render churn)
  const drama = dramaState.drama;
  if (!drama) return;
  const wrap = $('#drama-compose-episodes');
  if (!wrap) return;
  (drama.episodes || []).forEach((ep) => {
    if (!ep.themeSongUrl) return;
    const block = wrap.querySelector(`.drama-ep-block[data-eid="${cssEsc(ep.id)}"] .drama-theme-name`);
    if (block) block.textContent = themeSongName(ep.themeSongUrl);
  });
}

/** Open the song picker and set the chosen song as this episode's theme. */
function pickEpisodeTheme(eid) {
  if (!eid) return;
  openGalleryPicker('song', (asset) => setEpisodeTheme(eid, asset.url));
}

/** Set (or clear, songUrl=null) an episode's theme song, then re-render. */
async function setEpisodeTheme(eid, songUrl) {
  const base = dramaBase();
  const drama = dramaState.drama;
  if (!base || !drama || !eid) return;
  const r = await api(`${base}/${encodeURIComponent(drama.id)}/episode/${encodeURIComponent(eid)}/theme`, { songUrl });
  if (r.error) { toast(errText(r.error), 'err'); return; }
  renderDrama(r.drama);
  toast(songUrl ? '已设为主题曲' : '已清除主题曲', 'ok');
}

function selectedTier(eid) {
  const wrap = $('#drama-compose-episodes');
  if (!wrap) return 'low';
  const active = wrap.querySelector(`.tier-toggle[data-eid="${cssEsc(eid)}"] .tier-btn.active`);
  return active ? active.dataset.tier : 'low';
}

/** CSS.escape fallback for attribute selectors (ids are safe but be defensive). */
function cssEsc(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}

async function composeEpisode(eid, btn) {
  const base = dramaBase();
  const drama = dramaState.drama;
  if (!base || !drama) return;
  if (dramaState.busy) { toast('请等待当前任务完成', 'err'); return; }
  const tier = selectedTier(eid);
  const path = `${base}/${encodeURIComponent(drama.id)}/episode/${encodeURIComponent(eid)}/compose`;

  if (tier === 'high') {
    const est = await api(path, { tier });
    if (est.error && est.error.code === 'confirm_required') {
      showCostConfirm('drama-cp', est.error.estimate, '高质量出片', async () => {
        await runComposeSSE(path, { tier, confirm: true }, eid, btn);
      });
      return;
    }
    if (est.error) { toast(errText(est.error), 'err'); return; }
    await runComposeSSE(path, { tier, confirm: true }, eid, btn);
  } else {
    // low tier runs immediately
    await runComposeSSE(path, { tier }, eid, btn);
  }
}

async function runComposeSSE(path, body, eid, btn) {
  dramaState.busy = true;
  if (btn) btn.disabled = true;
  const wrap = $('#drama-compose-episodes');
  const progBox = wrap ? wrap.querySelector(`.drama-compose-progress[data-eid="${cssEsc(eid)}"]`) : null;
  const fill = progBox ? progBox.querySelector('.fill') : null;
  const msgEl = progBox ? progBox.querySelector('.drama-compose-stage-msg') : null;
  if (progBox) progBox.classList.remove('hidden');
  if (fill) fill.style.width = '5%';
  if (msgEl) msgEl.textContent = '开始出片…';

  let lastErr = null;
  await dramaSSE(path, body, {
    onStage: (p) => {
      if (fill && typeof p.progress === 'number') fill.style.width = `${Math.max(0, Math.min(100, Math.round(p.progress)))}%`;
      if (msgEl) msgEl.textContent = p.msg || p.stage || '';
    },
    onDone: async (p) => {
      if (fill) fill.style.width = '100%';
      if (msgEl) msgEl.textContent = '出片完成！';
      // refresh drama detail to pick up episodeUrl（用 drama.id 直接拼，避免 split 脆弱）
      const fresh = await api(`${dramaBase()}/${dramaState.drama.id}`);
      if (!fresh.error && fresh.drama) renderDrama(fresh.drama);
    },
    onError: (p) => { lastErr = p; },
  });

  dramaState.busy = false;
  if (btn) btn.disabled = false;
  if (lastErr) { if (msgEl) { msgEl.textContent = errText(lastErr); } toast(lastErr.message || '出片失败', 'err'); return; }
  toast('本集已出片', 'ok');
  loadGallery();
}

/* ── 连播 stage ── */
function renderDramaCollection(drama) {
  const btn = $('#drama-collection-btn');
  const composed = (drama.episodes || []).filter((e) => e.episodeUrl).length;
  if (btn) btn.disabled = composed < 1;
  const result = $('#drama-collection-result');
  if (result) {
    result.innerHTML = drama.collectionUrl
      ? `<video class="drama-ep-player" src="${esc(drama.collectionUrl)}" controls preload="metadata"></video>`
      : '';
  }
  const msg = $('#drama-collection-msg');
  if (msg) msg.textContent = composed < 1 ? '至少出片 1 集后才能生成连播合集。' : `已出片 ${composed} 集，可生成连播合集。`;
}

async function generateCollection() {
  const base = dramaBase();
  const drama = dramaState.drama;
  if (!base || !drama) return;
  const btn = $('#drama-collection-btn');
  const msg = $('#drama-collection-msg');
  if (btn) btn.disabled = true;
  if (msg) { msg.textContent = '拼接连播合集中…'; msg.style.color = ''; }
  const r = await api(`${base}/${encodeURIComponent(drama.id)}/collection`, {});
  if (btn) btn.disabled = false;
  if (r.error) { if (msg) { msg.textContent = errText(r.error); msg.style.color = 'var(--err)'; } toast(errText(r.error), 'err'); return; }
  if (r.drama) renderDrama(r.drama);
  if (msg) { msg.textContent = '连播合集已生成，已存入作品库。'; msg.style.color = 'var(--ok)'; }
  toast('连播合集已生成', 'ok');
  loadGallery();
}

/* ── Inline cost-confirm bar helper ── */
/**
 * Show a cost-confirm bar by prefix (e.g. 'drama-cast'); on confirm run onConfirm().
 * Expects #<prefix>-confirm (bar), #<prefix>-confirm-text, #<prefix>-ok, #<prefix>-cancel.
 */
function showCostConfirm(prefix, estimate, label, onConfirm) {
  const bar = $(`#${prefix}-confirm`);
  const text = $(`#${prefix}-confirm-text`);
  const ok = $(`#${prefix}-ok`);
  const cancel = $(`#${prefix}-cancel`);
  if (!bar || !ok || !cancel) { if (onConfirm) onConfirm(); return; }
  const count = estimate && estimate.count != null ? estimate.count : '?';
  const usd = estimate && estimate.estimatedUsd != null ? estimate.estimatedUsd : '?';
  if (text) text.textContent = `${label}：约 ${count} 项，预估成本 $${usd}。确认继续？`;
  bar.classList.remove('hidden');
  const close = () => {
    bar.classList.add('hidden');
    ok.removeEventListener('click', yes);
    cancel.removeEventListener('click', no);
  };
  const yes = () => { close(); if (onConfirm) onConfirm(); };
  const no = () => { close(); };
  ok.addEventListener('click', yes);
  cancel.addEventListener('click', no);
}

/* ── 选角 generation ── */
async function generateCast() {
  const base = dramaBase();
  const drama = dramaState.drama;
  if (!base || !drama) return;
  if (dramaState.busy) { toast('请等待当前任务完成', 'err'); return; }
  const path = `${base}/${encodeURIComponent(drama.id)}/cast`;
  const est = await api(path, {});
  if (est.error && est.error.code === 'confirm_required') {
    showCostConfirm('drama-cast', est.error.estimate, '生成配角定妆照', async () => {
      await runCastSSE(path);
    });
    return;
  }
  if (est.error) { toast(errText(est.error), 'err'); return; }
  await runCastSSE(path);
}

async function runCastSSE(path) {
  dramaState.busy = true;
  const btn = $('#drama-cast-gen-btn');
  if (btn) btn.disabled = true;
  const progBox = $('#drama-cast-progress');
  const fill = $('#drama-cast-progress-fill');
  const msgEl = $('#drama-cast-stage-msg');
  if (progBox) progBox.classList.remove('hidden');
  if (fill) fill.style.width = '5%';
  if (msgEl) msgEl.textContent = '开始生成定妆照…';

  let lastErr = null;
  await dramaSSE(path, { confirm: true }, {
    onStage: (p) => {
      if (fill && typeof p.progress === 'number') fill.style.width = `${Math.max(0, Math.min(100, Math.round(p.progress)))}%`;
      if (msgEl) msgEl.textContent = p.msg || '';
    },
    onDone: (p) => {
      if (fill) fill.style.width = '100%';
      if (msgEl) msgEl.textContent = '定妆照已生成！';
      if (p.drama) renderDrama(p.drama);
    },
    onError: (p) => { lastErr = p; },
  });

  dramaState.busy = false;
  if (btn) btn.disabled = false;
  if (lastErr) { if (msgEl) msgEl.textContent = errText(lastErr); toast(lastErr.message || '定妆照生成失败', 'err'); return; }
  toast('配角定妆照已生成', 'ok');
}

/* ── 立项 (create script) ── */
async function createDrama() {
  const base = dramaBase();
  if (!base) { toast('请先选择一名艺人', 'err'); return; }
  const theme = $('#drama-theme') ? $('#drama-theme').value.trim() : '';
  if (!theme) { toast('请输入题材', 'err'); return; }
  const title = $('#drama-title') ? $('#drama-title').value.trim() : '';
  const logline = $('#drama-logline') ? $('#drama-logline').value.trim() : '';
  const brief = {
    theme,
    episodeCount: dramaState.episodeCount,
    durationSec: dramaState.durationSec,
  };
  if (title) brief.title = title;
  if (logline) brief.logline = logline;

  const btn = $('#drama-create-btn');
  const msg = $('#drama-create-msg');
  if (btn) btn.disabled = true;
  if (msg) { msg.textContent = '生成剧本中…'; msg.style.color = ''; }

  const r = await api(`${base}/script`, { brief });
  if (btn) btn.disabled = false;
  if (r.error) { if (msg) { msg.textContent = errText(r.error); msg.style.color = 'var(--err)'; } toast(errText(r.error), 'err'); return; }
  if (msg) msg.textContent = '';
  toast('剧本已生成，进入工作台', 'ok');
  // open the new drama
  const proj = $('#drama-project-pane');
  const work = $('#drama-work-pane');
  if (proj) proj.classList.add('hidden');
  if (work) work.classList.remove('hidden');
  renderDrama(r.drama);
}

function initDramaStudio() {
  initSegCtrl('ctrl-drama-episodes', (v) => { dramaState.episodeCount = Number(v); });
  initSegCtrl('ctrl-drama-duration', (v) => { dramaState.durationSec = Number(v); });

  const createBtn = $('#drama-create-btn');
  if (createBtn) createBtn.addEventListener('click', createDrama);

  const listRefresh = $('#drama-list-refresh');
  if (listRefresh) listRefresh.addEventListener('click', () => loadDramaList());

  const backBtn = $('#drama-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => enterDramaProjectList());

  const saveBtn = $('#drama-save-script-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveDramaScript);

  const castGenBtn = $('#drama-cast-gen-btn');
  if (castGenBtn) castGenBtn.addEventListener('click', generateCast);

  const collectionBtn = $('#drama-collection-btn');
  if (collectionBtn) collectionBtn.addEventListener('click', generateCollection);
}

/* ════════════════════════════════════════════════════════
   深度访谈 (S7) — 嘉宾管理 + 提纲 + 实时访谈室（麦克风录音）
   ════════════════════════════════════════════════════════ */

/* ── 麦克风录音器 ── */
let _rec = null, _recChunks = [], _recStream = null;
function micSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}
async function startRec() {
  if (!micSupported()) { toast('当前环境不支持麦克风录音', 'err'); return false; }
  try { _recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('无法访问麦克风，请在浏览器允许权限', 'err'); return false; }
  _recChunks = [];
  _rec = new MediaRecorder(_recStream);
  _rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) _recChunks.push(ev.data); };
  _rec.start();
  return true;
}
function stopRec() {
  return new Promise((resolve) => {
    if (!_rec) return resolve(null);
    const rec = _rec, stream = _recStream;
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(_recChunks, { type: rec.mimeType || 'audio/webm' });
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);   // data:audio/...;base64,...
      fr.readAsDataURL(blob);
    };
    _rec = null; _recStream = null;   // 立即清引用，避免二次 stop 抛 wrong-state
    rec.stop();
  });
}

// 取消并释放麦克风（离开/重入访谈时清理），不产出音频。
function cleanupRec() {
  try { if (_recStream) _recStream.getTracks().forEach((t) => t.stop()); } catch {}
  try { if (_rec && _rec.state !== 'inactive') { _rec.onstop = null; _rec.stop(); } } catch {}
  _rec = null; _recStream = null; _recChunks = [];
  deepState.recording = false;
}

/* ── 访谈状态 ── */
const deepState = { artistId: null, session: null, recording: false, busy: false };

function deepivGuestBase() {
  if (!state.currentArtistId) return null;
  return `/api/artist/${encodeURIComponent(state.currentArtistId)}`;
}

/** 取嘉宾当前定妆照 url（current 是版本下标，-1 表示无） */
function guestPortraitUrl(g) {
  const p = g && g.portrait;
  if (p && p.current >= 0 && p.versions && p.versions[p.current]) return p.versions[p.current].url;
  return '';
}

/* ── 进入设置面板（嘉宾名录） ── */
function enterDeepivSetup() {
  cleanupRec();   // 释放可能仍在录的麦克风 + 复位录音态
  deepState.session = null;
  const setup = $('#deepiv-setup-pane');
  const room = $('#deepiv-room-pane');
  if (setup) setup.classList.remove('hidden');
  if (room) room.classList.add('hidden');
  loadGuests();
}

/* ── 嘉宾名录渲染 ── */
async function loadGuests() {
  const grid = $('#deepiv-guest-grid');
  if (!grid) return;
  const base = deepivGuestBase();
  if (!base) { grid.innerHTML = ''; return; }
  const data = await api(`${base}/guests`);
  if (data.error) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="icon">🎙️</div><div class="title">${esc(errText(data.error))}</div></div>`;
    return;
  }
  const guests = data.guests || [];
  if (!guests.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🎙️</div>
      <div class="title">还没有嘉宾</div>
      <div class="desc">在上方登记一位真人嘉宾，再开始访谈。</div>
    </div>`;
    return;
  }
  grid.innerHTML = guests.map((g) => {
    const url = guestPortraitUrl(g);
    const meta = [g.title, g.company].filter(Boolean).map(esc).join(' · ');
    return `<div class="deepiv-guest-card" data-gid="${esc(g.id)}">
      <div class="deepiv-guest-portrait">
        ${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : '<div class="deepiv-guest-empty">无形象</div>'}
      </div>
      <div class="deepiv-guest-body">
        <div class="deepiv-guest-name">${esc(g.name || '嘉宾')}</div>
        ${meta ? `<div class="deepiv-guest-meta">${meta}</div>` : ''}
        ${g.persona ? `<div class="deepiv-guest-persona" title="${esc(g.persona)}">${esc(g.persona)}</div>` : ''}
        <div class="deepiv-guest-actions">
          <button class="btn btn-secondary btn-sm deepiv-portrait-ai" data-gid="${esc(g.id)}">✦ AI 形象</button>
          <button class="btn btn-secondary btn-sm deepiv-portrait-up" data-gid="${esc(g.id)}">⤒ 上传</button>
          <input type="file" class="deepiv-portrait-file" data-gid="${esc(g.id)}" accept="image/*" hidden>
          <button class="btn btn-primary btn-sm deepiv-start" data-gid="${esc(g.id)}">▶ 开始访谈</button>
        </div>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.deepiv-portrait-ai').forEach((btn) =>
    btn.addEventListener('click', () => guestPortraitAi(btn.dataset.gid, btn)));
  grid.querySelectorAll('.deepiv-portrait-up').forEach((btn) =>
    btn.addEventListener('click', () => {
      const f = grid.querySelector(`.deepiv-portrait-file[data-gid="${btn.dataset.gid}"]`);
      if (f) f.click();
    }));
  grid.querySelectorAll('.deepiv-portrait-file').forEach((inp) =>
    inp.addEventListener('change', () => guestPortraitUpload(inp.dataset.gid, inp)));
  grid.querySelectorAll('.deepiv-start').forEach((btn) =>
    btn.addEventListener('click', () => startInterview(btn.dataset.gid, btn)));
}

/* ── 新建嘉宾 ── */
async function createGuest() {
  const base = deepivGuestBase();
  if (!base) { toast('请先选择一名艺人', 'err'); return; }
  const name = $('#deepiv-guest-name') ? $('#deepiv-guest-name').value.trim() : '';
  if (!name) { toast('请输入嘉宾姓名', 'err'); return; }
  const body = {
    name,
    title: $('#deepiv-guest-title') ? $('#deepiv-guest-title').value.trim() : '',
    company: $('#deepiv-guest-company') ? $('#deepiv-guest-company').value.trim() : '',
    persona: $('#deepiv-guest-persona') ? $('#deepiv-guest-persona').value.trim() : '',
  };
  const btn = $('#deepiv-guest-create-btn');
  const msg = $('#deepiv-guest-create-msg');
  if (btn) btn.disabled = true;
  if (msg) { msg.textContent = '添加中…'; msg.style.color = ''; }
  const r = await api(`${base}/guests`, body);
  if (btn) btn.disabled = false;
  if (r.error) { if (msg) { msg.textContent = errText(r.error); msg.style.color = 'var(--err)'; } toast(errText(r.error), 'err'); return; }
  if (msg) msg.textContent = '';
  ['#deepiv-guest-name', '#deepiv-guest-title', '#deepiv-guest-company', '#deepiv-guest-persona']
    .forEach((s) => { const el = $(s); if (el) el.value = ''; });
  toast('嘉宾已添加', 'ok');
  loadGuests();
}

/* ── 嘉宾 AI 形象 ── */
async function guestPortraitAi(gid, btn) {
  const base = deepivGuestBase();
  if (!base || !gid) return;
  if (btn) btn.disabled = true;
  toast('正在生成 AI 形象，请稍候…');
  const r = await api(`${base}/guest/${encodeURIComponent(gid)}/portrait`, { mode: 'ai' });
  if (btn) btn.disabled = false;
  if (r.error) { toast(errText(r.error), 'err'); return; }
  toast('AI 形象已生成', 'ok');
  loadGuests();
}

/* ── 嘉宾上传形象 ── */
async function guestPortraitUpload(gid, input) {
  const base = deepivGuestBase();
  if (!base || !gid) return;
  const dataUrl = await fileToDataUrl(input);
  if (input) input.value = '';
  if (!dataUrl) { toast('未选择图片', 'err'); return; }
  toast('正在上传形象…');
  const r = await api(`${base}/guest/${encodeURIComponent(gid)}/portrait`, { mode: 'upload', dataUrl });
  if (r.error) { toast(errText(r.error), 'err'); return; }
  toast('形象已上传', 'ok');
  loadGuests();
}

/* ── 开始访谈：建会话 → 进入访谈室 ── */
async function startInterview(gid, btn) {
  const base = deepivGuestBase();
  if (!base || !gid) return;
  if (btn) btn.disabled = true;
  toast('正在生成访谈提纲…');
  const r = await api(`${base}/interview2`, { guestId: gid });
  if (btn) btn.disabled = false;
  if (r.error) { toast(errText(r.error), 'err'); return; }
  deepState.session = r.session;
  deepState.artistId = state.currentArtistId;
  enterInterviewRoom(r.session, gid);
}

/* ── 进入访谈室 ── */
function enterInterviewRoom(session, gid) {
  const setup = $('#deepiv-setup-pane');
  const room = $('#deepiv-room-pane');
  if (setup) setup.classList.add('hidden');
  if (room) room.classList.remove('hidden');
  // reset finish region; will be re-revealed below if session already done
  const finish = $('#deepiv-finish');
  if (finish) { finish.classList.add('hidden'); }

  // mic support notice + record button guard
  const micNotice = $('#deepiv-mic-notice');
  const recBtn = $('#deepiv-record-btn');
  if (micSupported()) {
    if (micNotice) micNotice.classList.add('hidden');
    if (recBtn) recBtn.disabled = false;
  } else {
    if (micNotice) micNotice.classList.remove('hidden');
    if (recBtn) recBtn.disabled = true;
  }

  renderRoomHeader(session, gid);
  renderOutline(session);
  renderTranscript(session);
  setDeepivStatus(session.status);

  // if session already ended (revisiting), reveal finish region with existing players
  if (session.status === 'done' && finish) {
    finish.classList.remove('hidden');
    renderFinishPlayers(session);
  }

  // fresh session with 0 turns → auto play opening
  if ((session.turns || []).length === 0 && session.status !== 'done') {
    askNext();
  }
}

function renderRoomHeader(session, gid) {
  // resolve guest name from cards data if available; fall back to fetch
  const titleEl = $('#deepiv-room-guest');
  const metaEl = $('#deepiv-room-meta');
  const base = deepivGuestBase();
  if (base && gid) {
    api(`${base}/guest/${encodeURIComponent(gid)}`).then((r) => {
      if (r.error || !r.guest) return;
      const g = r.guest;
      if (titleEl) titleEl.textContent = `访谈室 · ${g.name || '嘉宾'}`;
      if (metaEl) {
        const parts = [g.title, g.company].filter(Boolean).map(esc).join(' · ');
        metaEl.innerHTML = parts || (g.persona ? esc(g.persona) : '');
      }
    });
  } else if (titleEl) {
    titleEl.textContent = '访谈室';
  }
}

function renderOutline(session) {
  const outline = session.outline || { opening: '', questions: [] };
  const openEl = $('#deepiv-outline-opening');
  if (openEl) openEl.textContent = outline.opening || '';
  const list = $('#deepiv-outline-questions');
  if (list) list.innerHTML = (outline.questions || []).map((q) => `<li>${esc(q)}</li>`).join('');
}

function setDeepivStatus(status) {
  const pill = $('#deepiv-room-status');
  if (!pill) return;
  if (status === 'done') { pill.textContent = '已结束'; pill.className = 'pill ok'; }
  else { pill.textContent = '访谈中'; pill.className = 'pill s2'; }
}

/* ── 对话记录渲染 ── */
function renderTranscript(session) {
  const wrap = $('#deepiv-transcript');
  const turns = (session && session.turns) || [];
  const countEl = $('#deepiv-turn-count');
  if (countEl) countEl.textContent = `${turns.length} 轮`;
  if (!wrap) return;
  if (!turns.length) {
    wrap.innerHTML = '<div class="deepiv-transcript-empty">访谈即将开始，主持人将先说开场白。</div>';
  } else {
    wrap.innerHTML = turns.map((t) => {
      const isHost = t.speaker === 'host';
      const who = isHost ? '主持' : '嘉宾';
      const play = t.audioUrl
        ? `<button class="deepiv-bubble-play" data-url="${esc(t.audioUrl)}" title="播放">▶</button>`
        : '';
      return `<div class="deepiv-bubble-row ${isHost ? 'host' : 'guest'}">
        <div class="deepiv-bubble">
          <div class="deepiv-bubble-who">${who}${play}</div>
          <div class="deepiv-bubble-text">${esc(t.text || '')}</div>
        </div>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.deepiv-bubble-play').forEach((b) =>
      b.addEventListener('click', () => { new Audio(b.dataset.url).play().catch(() => {}); }));
    wrap.scrollTop = wrap.scrollHeight;
  }
  // current question display = last host turn (or first unanswered outline question)
  const lastHost = [...turns].reverse().find((t) => t.speaker === 'host');
  const curEl = $('#deepiv-current-q');
  if (curEl && lastHost) curEl.textContent = lastHost.text || '';
}

/* ── 控件启用/禁用 ── */
function setRoomBusy(busy) {
  deepState.busy = busy;
  const askBtn = $('#deepiv-ask-btn');
  const endBtn = $('#deepiv-end-btn');
  const recBtn = $('#deepiv-record-btn');
  if (askBtn) askBtn.disabled = busy;
  if (endBtn) endBtn.disabled = busy;
  // never enable mic if unsupported
  if (recBtn) recBtn.disabled = busy || !micSupported();
}

/* ── 主持提问（开场 / 追问） ── */
async function askNext() {
  const session = deepState.session;
  if (!session) return;
  if (deepState.busy || deepState.recording) return;
  const base = `/api/artist/${encodeURIComponent(deepState.artistId)}/interview2/${encodeURIComponent(session.id)}`;
  setRoomBusy(true);
  const msg = $('#deepiv-room-msg');
  if (msg) { msg.textContent = '主持人思考中…'; msg.style.color = ''; }
  const r = await api(`${base}/ask`, {});   // 传体强制 POST
  setRoomBusy(false);
  if (r.error) {
    if (msg) { msg.textContent = errText(r.error); msg.style.color = 'var(--err)'; }
    toast(errText(r.error), 'err');
    return;
  }
  if (msg) msg.textContent = '';
  if (r.turn) {
    session.turns = session.turns || [];
    session.turns.push(r.turn);
    renderTranscript(session);
    if (r.turn.audioUrl) new Audio(r.turn.audioUrl).play().catch(() => {});
  }
}

/* ── 录音作答 ── */
async function toggleRecord(btn) {
  const session = deepState.session;
  if (!session) return;
  if (deepState.busy) return;

  if (!deepState.recording) {
    const ok = await startRec();
    if (!ok) return;
    deepState.recording = true;
    setRecordingUI(true);
    return;
  }

  // stop + submit
  deepState.recording = false;
  setRecordingUI(false);
  setRoomBusy(true);
  const msg = $('#deepiv-room-msg');
  if (msg) { msg.textContent = '识别语音中…'; msg.style.color = ''; }

  const dataUrl = await stopRec();
  if (!dataUrl) { setRoomBusy(false); if (msg) msg.textContent = ''; toast('录音失败，请重试', 'err'); return; }

  const base = `/api/artist/${encodeURIComponent(deepState.artistId)}/interview2/${encodeURIComponent(session.id)}`;
  const r = await api(`${base}/answer`, { audio: dataUrl });
  setRoomBusy(false);
  if (r.error) {
    if (msg) { msg.textContent = errText(r.error); msg.style.color = 'var(--err)'; }
    toast(errText(r.error), 'err'); // 允许再次点击 🎤 重试
    return;
  }
  if (msg) msg.textContent = '';
  if (r.turn) {
    session.turns = session.turns || [];
    session.turns.push(r.turn);
    renderTranscript(session);
  }
  // 自动追问
  await askNext();
}

function setRecordingUI(recording) {
  const btn = $('#deepiv-record-btn');
  const label = $('#deepiv-record-label');
  if (btn) btn.classList.toggle('recording', recording);
  if (label) label.textContent = recording ? '⏹ 停止并提交' : '🎤 回答';
}

/* ── 结束访谈 ── */
async function endInterview() {
  const session = deepState.session;
  if (!session) return;
  if (deepState.recording) { toast('请先停止录音', 'err'); return; }
  if (deepState.busy) return;
  const base = `/api/artist/${encodeURIComponent(deepState.artistId)}/interview2/${encodeURIComponent(session.id)}`;
  setRoomBusy(true);
  const r = await api(`${base}/end`, {});   // 传体强制 POST
  setRoomBusy(false);
  if (r.error) { toast(errText(r.error), 'err'); return; }
  deepState.session = r.session;
  setDeepivStatus('done');
  // reveal Phase B finish region
  const finish = $('#deepiv-finish');
  if (finish) {
    finish.classList.remove('hidden');
    renderFinishPlayers(r.session);
  }
  toast('访谈已结束', 'ok');
}

/* ── 成片区：重新拉取 session ── */
async function refetchDeepSession() {
  const { artistId, session } = deepState;
  if (!artistId || !session) return null;
  const r = await api(`/api/artist/${encodeURIComponent(artistId)}/interview2/${encodeURIComponent(session.id)}`);
  if (r.error) return null;
  deepState.session = r.session || r;
  return deepState.session;
}

/* ── 成片区：渲染已有 players（revisit 时） ── */
function renderFinishPlayers(session) {
  if (!session) return;
  const recPlayer = $('#deepiv-record-player');
  if (recPlayer && session.recordUrl) {
    recPlayer.innerHTML = `<audio src="${esc(session.recordUrl)}" controls class="deepiv-audio-player"></audio>`;
  }
  const vidPlayer = $('#deepiv-video-player');
  if (vidPlayer && session.videoUrl) {
    vidPlayer.innerHTML = `<video src="${esc(session.videoUrl)}" controls class="deepiv-video-player" playsinline></video>
      <div class="text-sm text-ink-3 mt-6">影像已存入成片库</div>`;
  }
}

/* ── 成片区：生成语音对谈记录 ── */
async function generateDeepRecord() {
  const { artistId, session } = deepState;
  if (!artistId || !session) return;
  const path = `/api/artist/${encodeURIComponent(artistId)}/interview2/${encodeURIComponent(session.id)}/record`;

  const btn = $('#deepiv-record-gen-btn');
  const progBox = $('#deepiv-record-progress');
  const fill = $('#deepiv-record-progress-fill');
  const msgEl = $('#deepiv-record-stage-msg');
  const player = $('#deepiv-record-player');

  if (btn) btn.disabled = true;
  if (progBox) progBox.classList.remove('hidden');
  if (fill) fill.style.width = '5%';
  if (msgEl) msgEl.textContent = '正在合成语音…';

  let lastErr = null;
  await dramaSSE(path, {}, {
    onStage: (p) => {
      if (fill && typeof p.progress === 'number') fill.style.width = `${Math.max(5, Math.min(95, Math.round(p.progress)))}%`;
      if (msgEl) msgEl.textContent = p.msg || '';
    },
    onDone: async (p) => {
      if (fill) fill.style.width = '100%';
      if (msgEl) msgEl.textContent = '语音对谈记录已生成！';
      const sess = await refetchDeepSession();
      const url = (sess && sess.recordUrl) || (p && p.url);
      if (player && url) {
        player.innerHTML = `<audio src="${esc(url)}" controls class="deepiv-audio-player"></audio>`;
      }
      toast('语音对谈记录已生成', 'ok');
    },
    onError: (p) => { lastErr = p; },
  });

  if (btn) btn.disabled = false;
  if (lastErr) {
    if (msgEl) { msgEl.textContent = errText(lastErr); }
    toast(lastErr.message || '生成失败', 'err');
  }
}

/* ── 成片区：生成对口型影像 ── */
async function generateDeepVideo() {
  const { artistId, session } = deepState;
  if (!artistId || !session) return;
  const path = `/api/artist/${encodeURIComponent(artistId)}/interview2/${encodeURIComponent(session.id)}/video`;
  const gbtn = $('#deepiv-video-gen-btn');

  // First call: no confirm → check if cost gate fires（探针期间禁用按钮，防重复点）
  if (gbtn) gbtn.disabled = true;
  const est = await api(path, {});
  if (gbtn) gbtn.disabled = false;
  if (est.error && est.error.code === 'confirm_required') {
    showCostConfirm('deepiv-video', est.error.estimate, '生成对口型影像', async () => {
      await runDeepVideoSSE(path);
    });
    return;
  }
  if (est.error) {
    // Surface bad_request messages prominently (missing portraits, need record first, etc.)
    toast(est.error.message || errText(est.error), 'err');
    const msgEl = $('#deepiv-video-stage-msg');
    const progBox = $('#deepiv-video-progress');
    if (progBox) progBox.classList.remove('hidden');
    if (msgEl) { msgEl.textContent = est.error.message || errText(est.error); }
    return;
  }
  // If server went ahead without confirm (unexpected), run SSE directly
  await runDeepVideoSSE(path);
}

async function runDeepVideoSSE(path) {
  const btn = $('#deepiv-video-gen-btn');
  const progBox = $('#deepiv-video-progress');
  const fill = $('#deepiv-video-progress-fill');
  const msgEl = $('#deepiv-video-stage-msg');
  const player = $('#deepiv-video-player');

  if (btn) btn.disabled = true;
  if (progBox) progBox.classList.remove('hidden');
  if (fill) fill.style.width = '5%';
  if (msgEl) msgEl.textContent = '正在生成对口型影像…';

  let lastErr = null;
  await dramaSSE(path, { confirm: true }, {
    onStage: (p) => {
      if (fill && typeof p.progress === 'number') fill.style.width = `${Math.max(5, Math.min(95, Math.round(p.progress)))}%`;
      if (msgEl) msgEl.textContent = p.msg || '';
    },
    onDone: async (p) => {
      if (fill) fill.style.width = '100%';
      if (msgEl) msgEl.textContent = '对口型影像已生成！';
      const sess = await refetchDeepSession();
      const url = (sess && sess.videoUrl) || (p && p.url);
      if (player && url) {
        player.innerHTML = `<video src="${esc(url)}" controls class="deepiv-video-player" playsinline></video>
          <div class="text-sm text-ink-3 mt-6">影像已存入成片库</div>`;
      }
      toast('对口型影像已生成', 'ok');
    },
    onError: (p) => { lastErr = p; },
  });

  if (btn) btn.disabled = false;
  if (lastErr) {
    if (msgEl) { msgEl.textContent = lastErr.message || errText(lastErr); }
    toast(lastErr.message || '影像生成失败', 'err');
  }
}

function initDeepInterview() {
  const createBtn = $('#deepiv-guest-create-btn');
  if (createBtn) createBtn.addEventListener('click', createGuest);

  const refreshBtn = $('#deepiv-guest-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadGuests());

  const backBtn = $('#deepiv-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => enterDeepivSetup());

  const askBtn = $('#deepiv-ask-btn');
  if (askBtn) askBtn.addEventListener('click', () => askNext());

  const recBtn = $('#deepiv-record-btn');
  if (recBtn) recBtn.addEventListener('click', () => toggleRecord(recBtn));

  const endBtn = $('#deepiv-end-btn');
  if (endBtn) endBtn.addEventListener('click', () => endInterview());

  const recordGenBtn = $('#deepiv-record-gen-btn');
  if (recordGenBtn) recordGenBtn.addEventListener('click', generateDeepRecord);

  const videoGenBtn = $('#deepiv-video-gen-btn');
  if (videoGenBtn) videoGenBtn.addEventListener('click', generateDeepVideo);
}

/* ── Boot ── */
function boot() {
  initRouter();
  initArtistPicker();
  initArtistStudio();
  initChatView();
  initSettings();
  initPhotoStudio();
  initVideoStudio();
  initMusicStudio();
  initInterviewStudio();
  initDramaStudio();
  initDeepInterview();
  initLightbox();
  initChat();
  initImage();
  initMusic();
  initVideo();
  initTts();
  initAsr();

  // Health refresh button
  const healthRefresh = $('#health-refresh');
  if (healthRefresh) healthRefresh.addEventListener('click', () => renderHealth(true));

  // Initial data loads
  renderHealth();
  renderUsage();
  setInterval(() => renderHealth(), 10000);
  setInterval(() => renderUsage(), 30000);
  setInterval(() => renderJobs(), 3000);

  // Start on S1
  switchView('artist-creation');
}

window.addEventListener('DOMContentLoaded', boot);
