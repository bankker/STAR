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
  'shorts': '短片/短剧',
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
  const r = await api('/api/artist/interview', { messages: state.interviewHistory });
  if (btn) btn.disabled = false;
  if (r.error) {
    const log = $('#interview-log');
    if (log) log.insertAdjacentHTML('beforeend', `<div class="bubble ai">${esc(errText(r.error))}</div>`);
    return;
  }
  state.interviewHistory.push({ role: 'assistant', content: r.reply });
  renderInterview();
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
  filter: 'all',   // 'all' | 'favorite'
  generating: false,
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

function mediaTileHtml(asset) {
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
        <button class="tile-btn tile-fav${isFav ? ' faved' : ''}" data-id="${id}" title="${isFav ? '取消收藏' : '收藏'}">★</button>
        <button class="tile-btn tile-redo" data-id="${id}" data-shot="${shot}" data-aspect="${aspect}" title="重抽">↻</button>
        <button class="tile-btn tile-del" data-id="${id}" title="删除">🗑</button>
      </div>
    </div>
    <div class="media-tile-meta">${shot ? shot + (aspect ? ' · ' + aspect : '') : aspect}</div>
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

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="icon">🖼️</div>
      <div class="title">${photoState.filter === 'favorite' ? '还没有收藏' : '还没有写真'}</div>
      <div class="desc">${photoState.filter === 'favorite' ? '点击★收藏任意写真。' : '左侧设置参数后点生成。'}</div>
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

/* ── Boot ── */
function boot() {
  initRouter();
  initArtistPicker();
  initArtistStudio();
  initChatView();
  initSettings();
  initPhotoStudio();
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
