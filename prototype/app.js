const $ = (sel) => document.querySelector(sel);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  if (err.attempts) s += '\n' + err.attempts.map((a) => `· ${a.provider}: [${a.code}] ${a.message}`).join('\n');
  return s;
}

const STATE_LABEL = { online: '在线', error: '故障', unconfigured: '未接入', unknown: '探测中' };

async function renderHealth(refresh) {
  const data = await api('/api/health' + (refresh ? '?refresh=1' : ''));
  if (data.error || !Array.isArray(data.providers)) return;
  $('#health-grid').innerHTML = data.providers.map((p) =>
    `<span class="badge ${esc(p.state)}" title="${esc(p.detail)} ${(p.capabilities || []).map(esc).join('/')}">` +
    `<i class="dot"></i>${esc(p.label)} · ${STATE_LABEL[p.state] || esc(p.state)}` +
    (p.latencyMs ? ` · ${p.latencyMs}ms` : '') + '</span>').join('');
}

async function renderRoutes() {
  const cfg = await api('/api/config');
  if (cfg.error) return;
  document.querySelectorAll('.route').forEach((el) => {
    const r = cfg[el.dataset.cap];
    el.textContent = r ? `→ ${r.provider}/${r.model}` : '→ 未配置路由';
  });
  const editor = $('#config-editor');
  if (editor && !editor.value) editor.value = JSON.stringify(cfg, null, 2);
}

function initChat() {
  $('#chat-send').addEventListener('click', async () => {
    const content = $('#chat-input').value.trim();
    if (!content) return;
    const btn = $('#chat-send'); btn.disabled = true;
    $('#chat-out').textContent = '生成中…';
    const r = await api('/api/ai/chat', { messages: [{ role: 'user', content }], maxTokens: 512 });
    btn.disabled = false;
    $('#chat-out').textContent = r.error ? errText(r.error) : `${r.text}\n—— ${r.provider}/${r.model}`;
  });
}

function boot() {
  renderHealth();
  setInterval(() => renderHealth(), 10000);
  renderRoutes();
  initChat();
  initImage();
  initMusic();
  initVideo();
  initTts();
  initAsr();
  $('#health-refresh').addEventListener('click', () => renderHealth(true));
  renderJobs(); setInterval(renderJobs, 3000);
  renderUsage(); setInterval(renderUsage, 30000);
  initSettings();
  initArtistStudio();
  initChatView();
}
window.addEventListener('DOMContentLoaded', boot);

const JOB_STATE = { queued: '排队', running: '生成中', done: '完成', failed: '失败', interrupted: '已中断' };

function mediaHtml(f) {
  const url = esc(f.url);
  if (/\.(png|jpe?g|webp)$/i.test(f.url)) return `<img src="${url}" alt="">`;
  if (/\.mp4$/i.test(f.url)) return `<video controls src="${url}"></video>`;
  if (/\.(mp3|wav)$/i.test(f.url)) return `<audio controls src="${url}"></audio>`;
  return `<a href="${url}" target="_blank">${url}</a>`;
}

async function renderJobs() {
  const data = await api('/api/jobs');
  if (data.error || !Array.isArray(data.jobs)) return;
  $('#jobs-list').innerHTML = data.jobs.map((j) => `
    <div class="job">
      <div>${esc(j.capability)} · ${JOB_STATE[j.status] || esc(j.status)} · ${esc(j.stage || '')}
        ${j.costEstimate ? `· 预估 $${esc(j.costEstimate.estimatedUsd)}` : ''}
        ${j.costActual != null ? `· 实际 $${esc(j.costActual)}` : ''}</div>
      <div class="bar"><i style="width:${Number(j.progress) || 0}%"></i></div>
      ${j.status === 'done' && j.result ? j.result.files.map(mediaHtml).join('') : ''}
      ${j.status === 'failed' && j.error ? `<div class="out">${esc(errText(j.error))}</div>` : ''}
      ${(j.status === 'failed' || j.status === 'interrupted') ? `<button onclick="retryJobClick('${esc(j.id)}')">重试</button>` : ''}
    </div>`).join('') || '<div class="out">暂无任务</div>';
}

window.retryJobClick = async (id) => {
  const r = await api(`/api/jobs/${encodeURIComponent(id)}/retry`, {}, 'POST');
  if (r.error) alert(errText(r.error));
  renderJobs();
};

async function renderUsage() {
  const u = await api('/api/usage');
  if (u.error) return;
  $('#usage-summary').textContent =
    `本周 AI 成本 $${u.totalUsd}（文本 $${u.textUsd} / 红线 $${u.textBudgetUsd}）${u.textWarn ? ' ⚠️ 接近红线' : ''}`;
}

let confirmOpen = false;

function confirmCost(estimate) {
  if (confirmOpen) return Promise.resolve(false);
  confirmOpen = true;
  return new Promise((resolve) => {
    $('#confirm-text').textContent =
      `将由 ${estimate.provider}/${estimate.model} 生成 ${estimate.capability}，预估成本 $${estimate.estimatedUsd}。继续？`;
    $('#confirm-modal').classList.remove('hidden');
    const ok = $('#confirm-ok'); const cancel = $('#confirm-cancel');
    const done = (v) => {
      confirmOpen = false;
      $('#confirm-modal').classList.add('hidden');
      ok.removeEventListener('click', yes); cancel.removeEventListener('click', no);
      resolve(v);
    };
    const yes = () => done(true); const no = () => done(false);
    ok.addEventListener('click', yes); cancel.addEventListener('click', no);
  });
}

// 重媒体卡片公用：先拿 confirm_required 的报价 → 弹窗确认 → 带 confirm 重发
async function submitWithConfirm(path, payload, outEl) {
  outEl.textContent = '估算成本…';
  const first = await api(path, payload);
  if (first.error && first.error.code === 'confirm_required') {
    if (!(await confirmCost(first.error.estimate))) { outEl.textContent = '已取消'; return null; }
    const second = await api(path, { ...payload, confirm: true });
    if (second.error) { outEl.textContent = errText(second.error); return null; }
    outEl.textContent = `已提交任务 ${second.jobId}，进度见下方任务列表`;
    renderJobs();
    return second;
  }
  if (first.error) { outEl.textContent = errText(first.error); return null; }
  return first;
}

function fileToDataUrl(input) {
  return new Promise((resolve) => {
    const f = input.files && input.files[0];
    if (!f) return resolve(null);
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(f);
  });
}

function initVideo() {
  $('#video-send').addEventListener('click', async () => {
    const prompt = $('#video-prompt').value.trim();
    const imageRef = await fileToDataUrl($('#video-ref'));
    if (!prompt && !imageRef) return;
    const btn = $('#video-send'); btn.disabled = true;
    await submitWithConfirm('/api/ai/video', { prompt, imageRef, durationSec: Number($('#video-duration').value) }, $('#video-out'));
    btn.disabled = false;
  });
}

function initMusic() {
  $('#music-send').addEventListener('click', async () => {
    const title = $('#music-title').value.trim();
    const style = $('#music-style').value.trim();
    const lyrics = $('#music-lyrics').value.trim();
    if (!title && !style && !lyrics) return;
    const btn = $('#music-send'); btn.disabled = true;
    await submitWithConfirm('/api/ai/music', { title, style, lyrics }, $('#music-out'));
    btn.disabled = false;
  });
}

function initImage() {
  $('#image-send').addEventListener('click', async () => {
    const prompt = $('#image-prompt').value.trim();
    if (!prompt) return;
    const btn = $('#image-send'); btn.disabled = true;
    $('#image-out').textContent = '生成中…（目标 ≤60s）';
    const ref = await fileToDataUrl($('#image-ref'));
    const r = await api('/api/ai/image', { prompt, refImages: ref ? [ref] : [] });
    btn.disabled = false;
    $('#image-out').innerHTML = r.error
      ? esc(errText(r.error)).replace(/\n/g, '<br>')
      : r.files.map(mediaHtml).join('') + `<div>—— ${esc(r.provider)}/${esc(r.model)}</div>`;
  });
}

function initTts() {
  $('#tts-send').addEventListener('click', async () => {
    const text = $('#tts-text').value.trim();
    if (!text) return;
    const btn = $('#tts-send'); btn.disabled = true;
    $('#tts-out').textContent = '合成中…';
    const r = await api('/api/ai/tts', { text, voice: $('#tts-voice').value.trim() || undefined });
    btn.disabled = false;
    $('#tts-out').innerHTML = r.error
      ? esc(errText(r.error)).replace(/\n/g, '<br>')
      : r.files.map(mediaHtml).join('') + `<div>—— ${esc(r.provider)}/${esc(r.model)}</div>`;
  });
}

function initAsr() {
  $('#asr-send').addEventListener('click', async () => {
    const audio = await fileToDataUrl($('#asr-file'));
    if (!audio) { $('#asr-out').textContent = '请先选择音频文件'; return; }
    const btn = $('#asr-send'); btn.disabled = true;
    $('#asr-out').textContent = '转写中…';
    const r = await api('/api/ai/asr', { audio });
    btn.disabled = false;
    $('#asr-out').textContent = r.error ? errText(r.error) : `${r.text}\n—— ${r.provider}/${r.model}`;
  });
}

async function renderKeys() {
  const data = await api('/api/config/keys');
  if (data.error || !Array.isArray(data.keys)) return;
  $('#keys-list').innerHTML = data.keys.map((k) => `
    <div class="key-row">
      <label>${esc(k.provider)} · ${esc(k.key)} ${k.configured ? `（已配 ****${esc(k.tail)}）` : '（未配）'}</label>
      <input type="password" data-key="${esc(k.key)}" placeholder="粘贴新 key 后回车提交">
    </div>`).join('');
  document.querySelectorAll('#keys-list input').forEach((input) => {
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const r = await api('/api/config/keys', { key: input.dataset.key, value: input.value.trim() });
      if (r.error) { alert(errText(r.error)); return; }
      input.value = '';
      renderKeys(); renderHealth(true); renderRoutes();
    });
  });
}

function initSettings() {
  renderKeys();
  $('#config-save').addEventListener('click', async () => {
    let next;
    try { next = JSON.parse($('#config-editor').value); }
    catch { $('#config-msg').textContent = 'JSON 格式错误'; return; }
    const r = await api('/api/config', next, 'PUT');
    $('#config-msg').textContent = r.error ? errText(r.error) : '已保存，路由即时生效';
    renderRoutes();
  });
}

let interviewHistory = [];

function artistCardHtml(a) {
  const cover = a.portraits?.[0]?.url;
  return `<div class="artist-card" data-id="${esc(a.id)}">
    ${cover ? `<img src="${esc(cover)}" alt="">` : '<img alt="">'}
    <div class="nm">${esc(a.name)}</div><div class="ps">${esc(a.persona || '')} ${esc(a.positioning || '')}</div>
  </div>`;
}

async function renderArtists() {
  const data = await api('/api/artists');
  if (data.error || !Array.isArray(data.artists)) return;
  $('#artist-list').innerHTML = data.artists.map(artistCardHtml).join('') || '<div class="ps">还没有艺人，点右上角创设一个。</div>';
  document.querySelectorAll('#artist-list .artist-card').forEach((el) =>
    el.addEventListener('click', () => showArtistDetail(el.dataset.id)));
}

function renderInterview() {
  $('#interview-log').innerHTML = interviewHistory.map((m) =>
    `<div class="bubble ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.content)}</div>`).join('');
  $('#interview-log').scrollTop = $('#interview-log').scrollHeight;
}

async function sendInterview() {
  const text = $('#interview-input').value.trim();
  if (!text) return;
  interviewHistory.push({ role: 'user', content: text });
  $('#interview-input').value = ''; renderInterview();
  const r = await api('/api/artist/interview', { messages: interviewHistory });
  if (r.error) {
    renderInterview();
    $('#interview-log').insertAdjacentHTML('beforeend', `<div class="bubble ai">${esc(errText(r.error))}</div>`);
    $('#interview-log').scrollTop = $('#interview-log').scrollHeight;
    return;
  }
  interviewHistory.push({ role: 'assistant', content: r.reply });
  renderInterview();
}

function fillDraft(d) {
  const set = (f, v) => { const el = document.querySelector(`#draft-box [data-f="${f}"]`); if (el) el.value = v ?? ''; };
  set('name', d.name); set('gender', d.gender); set('persona', d.persona); set('positioning', d.positioning);
  set('coreAppeal', d.coreAppeal); set('speakingStyle', d.speakingStyle);
  set('voiceDescription', d.voiceProfile?.description); set('musicStyle', d.musicStyle);
  set('personality', Array.isArray(d.personality) ? d.personality.join('，') : '');
  set('backstory', d.backstory); set('visualIdentity', d.visualIdentity);
  $('#draft-box').classList.remove('hidden');
}

function readDraft() {
  const g = (f) => document.querySelector(`#draft-box [data-f="${f}"]`).value.trim();
  return {
    name: g('name'), gender: g('gender'), persona: g('persona'), positioning: g('positioning'),
    coreAppeal: g('coreAppeal'), speakingStyle: g('speakingStyle'),
    voiceProfile: { description: g('voiceDescription') }, musicStyle: g('musicStyle'),
    personality: g('personality') ? g('personality').split(/[，,]/).map((s) => s.trim()).filter(Boolean) : [],
    backstory: g('backstory'), visualIdentity: g('visualIdentity'),
  };
}

async function finalizeInterview() {
  if (!interviewHistory.length) return;
  $('#create-msg').textContent = '';
  const btn = $('#interview-finalize'); btn.disabled = true; btn.textContent = '生成中…';
  const r = await api('/api/artist/finalize', { transcript: interviewHistory });
  btn.disabled = false; btn.textContent = '根据对话生成档案';
  if (r.error) { $('#interview-log').insertAdjacentHTML('beforeend', `<div class="bubble ai">${esc(errText(r.error))}</div>`); return; }
  fillDraft(r.draft);
}

async function saveArtist() {
  const profile = readDraft();
  if (!profile.name) { $('#create-msg').textContent = '艺名必填'; $('#create-msg').style.color = 'var(--err)'; return; }
  const r = await api('/api/artist', { profile });
  if (r.error) { $('#create-msg').textContent = errText(r.error); $('#create-msg').style.color = 'var(--err)'; return; }
  $('#create-msg').style.color = 'var(--ok)'; $('#create-msg').textContent = `已创建 ${r.artist.name}`;
  $('#artist-create').classList.add('hidden');
  renderArtists();
  showArtistDetail(r.id);
}

async function showArtistDetail(id) {
  const r = await api(`/api/artist/${encodeURIComponent(id)}`);
  if (r.error) return;
  const a = r.artist;
  $('#artist-detail').classList.remove('hidden');
  $('#artist-detail').innerHTML = `
    <h3>${esc(a.name)} <span class="ps">${esc(a.persona)} · ${esc(a.positioning)}</span></h3>
    <div class="ps">${esc(a.backstory)}</div>
    <div class="ps">声线：${esc(a.voiceProfile?.description || '')}　音乐：${esc(a.musicStyle || '')}</div>
    <div class="ps">视觉：${esc(a.visualIdentity || '')}</div>
    <div class="portraits">${(a.portraits || []).map((p) => `<img src="${esc(p.url)}" alt="">`).join('')}</div>
    <button id="gen-portrait" data-id="${esc(a.id)}">出定妆照</button>
    <button id="open-chat" data-id="${esc(a.id)}">💬 聊天</button> <button id="del-artist" data-id="${esc(a.id)}">删除艺人</button>
    <span id="portrait-msg" class="ps"></span>`;
  $('#gen-portrait').addEventListener('click', async (e) => {
    const btn = e.target; btn.disabled = true; $('#portrait-msg').textContent = '生成中…（目标 ≤60s）';
    const pr = await api(`/api/artist/${encodeURIComponent(btn.dataset.id)}/portrait`, {});
    btn.disabled = false;
    $('#portrait-msg').textContent = pr.error ? errText(pr.error) : '已生成';
    if (!pr.error) { showArtistDetail(btn.dataset.id); renderArtists(); }
  });
  $('#del-artist').addEventListener('click', async (e) => {
    if (!confirm('确认删除该艺人？')) return;
    await api(`/api/artist/${encodeURIComponent(e.target.dataset.id)}`, undefined, 'DELETE');
    $('#artist-detail').classList.add('hidden');
    renderArtists();
  });
  $('#open-chat').addEventListener('click', (e) => openChat(e.target.dataset.id, a.name));
}

function initArtistStudio() {
  renderArtists();
  $('#artist-new').addEventListener('click', () => {
    interviewHistory = []; renderInterview();
    $('#draft-box').classList.add('hidden'); $('#create-msg').textContent = '';
    $('#artist-create').classList.remove('hidden'); $('#artist-detail').classList.add('hidden');
  });
  $('#interview-send').addEventListener('click', sendInterview);
  $('#interview-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendInterview(); });
  $('#interview-finalize').addEventListener('click', finalizeInterview);
  $('#artist-save').addEventListener('click', saveArtist);
}

let chatArtistId = null;

function chatBubble(role, content) {
  return `<div class="bubble ${role === 'user' ? 'me' : 'ai'}">${esc(content)}</div>`;
}

async function openChat(id, name) {
  chatArtistId = id;
  $('#chat-view').classList.remove('hidden');
  $('#chat-title').textContent = `与 ${name} 聊天`;
  const data = await api(`/api/artist/${encodeURIComponent(id)}/chat`);
  if (!data.error) {
    $('#chat-log').innerHTML = (data.messages || []).map((m) => chatBubble(m.role, m.content)).join('');
    renderChatState(data.state);
  }
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
}

function renderChatState(s) {
  if (s) $('#chat-state').textContent = `心情：${esc(s.mood)} · 亲密度 ${esc(s.affinity)}/100`;
}

async function sendChat() {
  const text = $('#chat-msg').value.trim();
  if (!text || !chatArtistId) return;
  $('#chat-msg').value = '';
  $('#chat-log').insertAdjacentHTML('beforeend', chatBubble('user', text));
  const aiBubbleId = `b${Date.now()}`;
  $('#chat-log').insertAdjacentHTML('beforeend', `<div class="bubble ai" id="${aiBubbleId}"></div>`);
  const aiEl = document.getElementById(aiBubbleId);
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  try {
    const res = await fetch(`/api/artist/${encodeURIComponent(chatArtistId)}/chat/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let carry = '', acc = '';
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
        const payload = JSON.parse(dataLine);
        if (ev === 'token') { acc += payload.t; aiEl.textContent = acc; $('#chat-log').scrollTop = $('#chat-log').scrollHeight; }
        else if (ev === 'done') { aiEl.textContent = payload.reply || acc; renderChatState(payload.state); }
        else if (ev === 'error') { aiEl.textContent = errText(payload); }
      }
    }
    if (!acc && !aiEl.textContent) aiEl.textContent = '（无回复）';
  } catch (e) {
    aiEl.textContent = `连接失败：${e.message}`;
  }
}

function initChatView() {
  $('#chat-send2').addEventListener('click', sendChat);
  $('#chat-msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  $('#chat-close').addEventListener('click', () => { $('#chat-view').classList.add('hidden'); chatArtistId = null; });
}
