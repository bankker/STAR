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
  $('#health-refresh').addEventListener('click', () => renderHealth(true));
  renderJobs(); setInterval(renderJobs, 3000);
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
