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
}
window.addEventListener('DOMContentLoaded', boot);
