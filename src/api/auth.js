// 登录闸：三种模式由环境变量决定
//   google   —— 设了 GOOGLE_CLIENT_ID + ALLOWED_EMAILS：网页「使用 Google 登录」，后端校验 ID 令牌 + 邮箱白名单 + 会话 cookie
//   password —— 只设了 APP_PASSWORD：HTTP Basic Auth
//   open     —— 都没设：完全放行（本地开发默认）
// 任何模式下，设了 APP_PASSWORD 都额外认 Basic Auth（应急后门，方便脚本/兜底）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../lib/paths.js';

const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim();
const allowed = () => (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const appPassword = () => process.env.APP_PASSWORD || '';
const SESSION_TTL = 12 * 3600; // 会话有效期 12h

// 白名单留空或含 '*' → 放行任意「已验证」的 Google 账号；否则只放行名单内邮箱。
function emailAllowed(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  const list = allowed();
  return list.length === 0 || list.includes('*') || list.includes(e);
}

export function authMode() {
  if (clientId()) return 'google';
  if (appPassword()) return 'password';
  return 'open';
}

// ── 会话 cookie：HMAC 签名的 base64url(JSON) ───────────────────────────────
let cachedSecret = '';
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  const f = path.join(DATA_DIR, '.session_secret');
  try { cachedSecret = fs.readFileSync(f, 'utf8').trim(); } catch {}
  if (!cachedSecret) {
    cachedSecret = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, cachedSecret); } catch {}
  }
  return cachedSecret;
}
const b64url = (s) => Buffer.from(s).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url');
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

export function signSession(obj) {
  const body = b64url(JSON.stringify(obj));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export function verifySession(token) {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEq(mac, expect)) return null;
  let obj; try { obj = JSON.parse(fromB64url(body).toString('utf8')); } catch { return null; }
  if (!obj || typeof obj.exp !== 'number' || obj.exp < Math.floor(Date.now() / 1000)) return null;
  if (!emailAllowed(obj.email)) return null;
  return obj;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

// ── Google ID 令牌校验（RS256，零依赖，用 Google 的 X.509 证书）─────────────
let certCache = { exp: 0, keys: {} };
async function googleCerts() {
  if (Date.now() < certCache.exp && Object.keys(certCache.keys).length) return certCache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v1/certs');
  const keys = await r.json();
  const m = (r.headers.get('cache-control') || '').match(/max-age=(\d+)/);
  certCache = { exp: Date.now() + (m ? Number(m[1]) : 3600) * 1000, keys };
  return keys;
}
async function verifyGoogleIdToken(idToken) {
  const [h, p, s] = String(idToken || '').split('.');
  if (!h || !p || !s) return null;
  let header; try { header = JSON.parse(fromB64url(h).toString('utf8')); } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  const cert = (await googleCerts())[header.kid];
  if (!cert) return null;
  const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(crypto.createPublicKey(cert), fromB64url(s));
  if (!ok) return null;
  let payload; try { payload = JSON.parse(fromB64url(p).toString('utf8')); } catch { return null; }
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') return null;
  if (payload.aud !== clientId()) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (payload.email_verified !== true && payload.email_verified !== 'true') return null;
  return payload;
}

// ── 路由：登录页 / 令牌校验 / 登出（仅 google 模式启用）────────────────────
export async function handleAuthRoutes(req, res, pathname) {
  if (authMode() !== 'google') return false;
  if (req.method === 'GET' && pathname === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(loginPage(clientId())); return true;
  }
  if (req.method === 'GET' && pathname === '/logout') {
    res.writeHead(302, { 'Set-Cookie': 'ss_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', Location: '/login' });
    res.end(); return true;
  }
  if (req.method === 'POST' && pathname === '/api/auth/google') {
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 8192) break; }
    let cred = ''; try { cred = JSON.parse(raw).credential || ''; } catch {}
    const payload = await verifyGoogleIdToken(cred).catch(() => null);
    const email = String(payload?.email || '').toLowerCase();
    if (!payload || !allowed().includes(email)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '该 Google 账号未被授权访问' })); return true;
    }
    const token = signSession({ email, name: payload.name || '', exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
    res.writeHead(200, {
      'Set-Cookie': `ss_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`,
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({ ok: true, email })); return true;
  }
  return false;
}

export function isAuthed(req) {
  if (authMode() === 'open') return true;
  // 应急/通用：Basic Auth + APP_PASSWORD（任何模式都认）
  if (appPassword()) {
    const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
    if (m) {
      const pass = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
      if (safeEq(pass, appPassword())) return true;
    }
  }
  if (authMode() === 'google') return Boolean(verifySession(readCookie(req, 'ss_session')));
  return false;
}

export function denyAuth(req, res) {
  if (authMode() === 'google') {
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
      res.writeHead(302, { Location: '/login' }); res.end(); return;
    }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('需要登录'); return;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AI Star Studio", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('需要登录');
}

function loginPage(cid) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>登录 · Star</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
    background:radial-gradient(120% 120% at 50% 0%,#1a1030 0%,#0c0a18 55%,#070611 100%);color:#e8e6f0}
  .card{width:min(92vw,380px);padding:40px 32px;border-radius:20px;text-align:center;
    background:rgba(30,24,54,.55);border:1px solid rgba(150,120,255,.18);backdrop-filter:blur(14px);
    box-shadow:0 20px 60px rgba(0,0,0,.45)}
  .logo{font-size:30px;font-weight:800;letter-spacing:.04em;
    background:linear-gradient(100deg,#b69bff,#67e8f9);-webkit-background-clip:text;background-clip:text;color:transparent}
  .sub{margin:8px 0 28px;color:#a8a2c4;font-size:13px}
  #msg{margin-top:16px;min-height:18px;color:#ff9a9a;font-size:13px}
  .gi{display:flex;justify-content:center}
</style></head><body>
  <div class="card">
    <div class="logo">✦ Star Studio</div>
    <div class="sub">虚拟艺人制片棚 · 请用授权的 Google 账号登录</div>
    <div class="gi"><div id="g_id_onload" data-client_id="${cid}" data-callback="onCred" data-auto_prompt="false"></div>
    <div class="g_id_signin" data-type="standard" data-theme="filled_black" data-size="large" data-text="signin_with" data-shape="pill"></div></div>
    <div id="msg"></div>
  </div>
  <script src="https://accounts.google.com/gsi/client" async></script>
  <script>
    function onCred(resp){
      document.getElementById('msg').textContent='登录中…';
      fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:resp.credential})})
        .then(function(r){return r.ok?(location.href='/'):r.json().then(function(j){document.getElementById('msg').textContent=(j&&j.error)||'登录失败';});})
        .catch(function(){document.getElementById('msg').textContent='网络错误，请重试';});
    }
  </script>
</body></html>`;
}
