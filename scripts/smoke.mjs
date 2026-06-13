import { spawn } from 'node:child_process';

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;

const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};

async function call(path, body, method) {
  const res = await fetch(`${BASE}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function waitReady(ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`${BASE}/api/ping`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('服务器启动超时');
}

// Windows: use ['inherit','inherit','ignore'] to suppress libuv assertion abort on server.kill()
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['inherit', 'inherit', 'ignore'],
  detached: true,
});
server.unref();
try {
  await waitReady();

  const health = await call('/api/health');
  ok('health 返回 provider 三态', health.status === 200 && Array.isArray(health.data.providers)
    && health.data.providers.every((p) => ['online', 'error', 'unconfigured', 'unknown'].includes(p.state)),
    health.data.providers?.map((p) => `${p.id}:${p.state}`).join(' '));

  const cfg = await call('/api/config');
  ok('config 可读', cfg.status === 200 && Boolean(cfg.data.chat?.provider));

  const onlineSet = new Set((health.data.providers || []).filter((p) => p.state === 'online').map((p) => p.id));
  for (const [path, cap] of [['/api/ai/chat', 'chat'], ['/api/ai/content', 'content'], ['/api/ai/world', 'world'], ['/api/ai/plan', 'plan']]) {
    const routed = [cfg.data[cap], ...(cfg.data[cap]?.fallback || [])].some((e) => e && onlineSet.has(e.provider));
    const r = await call(path, { messages: [{ role: 'user', content: '回复 OK 两个字母即可' }], maxTokens: 16 });
    if (routed) ok(`${cap} 真实调用`, r.status === 200 && Boolean(r.data.text), r.data.text?.slice(0, 40) || JSON.stringify(r.data.error));
    else ok(`${cap} 未接入时结构化降级`, r.status === 200 && r.data.error?.code === 'unconfigured', JSON.stringify(r.data.error));
  }

  const est = await call('/api/estimate', { capability: 'video', request: { durationSec: 10 } });
  ok('estimate 返回预估', est.status === 200 && typeof est.data.estimatedUsd === 'number', `$${est.data?.estimatedUsd}`);

  const noConfirm = await call('/api/ai/video', { prompt: 'smoke' });
  ok('video 未确认时 confirm_required 或 unconfigured', noConfirm.status === 200
    && ['confirm_required', 'unconfigured'].includes(noConfirm.data.error?.code), noConfirm.data.error?.code);

  const usage = await call('/api/usage');
  ok('usage 周聚合', usage.status === 200 && typeof usage.data.totalUsd === 'number');

  const jobs = await call('/api/jobs');
  ok('jobs 列表', jobs.status === 200 && Array.isArray(jobs.data.jobs));

  const keys = await call('/api/config/keys');
  ok('keys 不回显完整 key', keys.status === 200
    && keys.data.keys.every((k) => !('value' in k) && (!k.tail || k.tail.length <= 4)));

  const home = await fetch(`${BASE}/`);
  const homeText = await home.text();
  ok('工作台首页', home.status === 200 && homeText.includes('工作台'));

  const traversal = await fetch(`${BASE}/..%2f.env`);
  ok('路径穿越被拦截', traversal.status === 404);

  const badJson = await fetch(`${BASE}/api/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  ok('坏 JSON → 400', badJson.status === 400);

  // —— 艺人创设（S1）——
  const iv = await call('/api/artist/interview', { messages: [{ role: 'user', content: '冷艳电子歌手' }] });
  ok('artist interview 路由可用', iv.status === 200 && (Boolean(iv.data.reply) || Boolean(iv.data.error)), iv.data.error?.code || 'ok');

  const fin = await call('/api/artist/finalize', { transcript: '冷艳电子歌手' });
  ok('artist finalize 路由可用', fin.status === 200 && (Boolean(fin.data.draft) || Boolean(fin.data.error)), fin.data.error?.code || 'ok');

  const created = await call('/api/artist', { profile: { name: 'SMOKE艺人', persona: '冷艳', visualIdentity: '银发' } });
  ok('artist 创建', created.status === 200 && created.data.id?.startsWith('art_'), created.data.id);

  const listed = await call('/api/artists');
  ok('artist 列表含新建', listed.status === 200 && listed.data.artists.some((a) => a.id === created.data.id));

  const got = await call(`/api/artist/${created.data.id}`);
  ok('artist 详情', got.status === 200 && got.data.artist?.persona === '冷艳');

  const updated = await call(`/api/artist/${created.data.id}`, { profile: { name: 'SMOKE艺人改名' } }, 'PUT');
  ok('artist 更新', updated.status === 200 && updated.data.artist?.name === 'SMOKE艺人改名', updated.data.artist?.name);

  const badCreate = await call('/api/artist', { profile: { name: '' } });
  ok('空艺名被拒', badCreate.status === 200 && badCreate.data.error?.code === 'bad_request', badCreate.data.error?.code);

  const del = await call(`/api/artist/${created.data.id}`, undefined, 'DELETE');
  ok('artist 删除', del.status === 200 && del.data.ok === true);
} catch (e) {
  ok('smoke 执行', false, e.message);
} finally {
  // Windows: SIGTERM triggers a libuv assertion crash; use taskkill /F to avoid the crash
  // propagating a non-zero exit code to the parent. Fall back to server.kill() on non-Windows.
  if (process.platform === 'win32' && server.pid) {
    const { spawnSync } = await import('node:child_process');
    spawnSync('taskkill', ['/PID', String(server.pid), '/F', '/T'], { stdio: 'ignore' });
  } else {
    server.kill();
  }
  server.unref();
}
console.log(failures ? `\nsmoke 失败 ${failures} 项` : '\nsmoke 全部通过');
process.exit(failures ? 1 : 0);
