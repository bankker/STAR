import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './src/lib/env.js';
import { safeJoin } from './src/lib/files.js';
import { ROOT_DIR, PROTOTYPE_DIR, GENERATED_DIR, ENV_FILE } from './src/lib/paths.js';
import { registerRoutes, json, jsonError, readJsonBody } from './src/api/routes.js';

loadEnv(ENV_FILE);
const PORT = Number(process.env.PORT || 3100);

const exact = new Map();
const dynamic = []; // { method, segments:['api','jobs',':id'], handler }
function route(key, handler) {
  const [method, p] = key.split(' ');
  if (p.includes('/:')) dynamic.push({ method, segments: p.split('/').filter(Boolean), handler });
  else exact.set(key, handler);
}
function matchDynamic(method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const r of dynamic) {
    if (r.method !== method || r.segments.length !== segs.length) continue;
    const params = {};
    let ok = true;
    r.segments.forEach((s, i) => {
      if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(segs[i]);
      else if (s !== segs[i]) ok = false;
    });
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8',
};

function serveStatic(res, pathname) {
  const root = pathname.startsWith('/generated/') ? GENERATED_DIR : PROTOTYPE_DIR;
  const rel = pathname.startsWith('/generated/') ? pathname.slice('/generated/'.length) : (pathname === '/' ? 'index.html' : pathname);
  const full = safeJoin(root, rel);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}

registerRoutes(route);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    const handler = exact.get(`${req.method} ${pathname}`);
    if (handler) return await handler(req, res, { url, readJsonBody: () => readJsonBody(req, pathname) });
    const dyn = matchDynamic(req.method, pathname);
    if (dyn) return await dyn.handler(req, res, { url, params: dyn.params, readJsonBody: () => readJsonBody(req, pathname) });
    if (pathname.startsWith('/api/')) return jsonError(res, 'not_found', `未知端点: ${pathname}`);
    if (req.method === 'GET') return serveStatic(res, pathname);
    res.writeHead(405).end();
  } catch (err) {
    if (err.message === 'JSON 解析失败' || err.message === '请求体过大') return json(res, { error: { code: 'bad_request', message: err.message } }, 400);
    console.error('[server] 未捕获异常', err);
    json(res, { error: { code: 'internal', message: '服务器内部错误' } }, 500);
  }
});

server.listen(PORT, () => console.log(`AI Star Studio v3 → http://127.0.0.1:${PORT} （根目录 ${ROOT_DIR}）`));
