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
