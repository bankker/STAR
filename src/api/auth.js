// 登录闸：模式由环境变量决定
//   oauth    —— 设了 GOOGLE_CLIENT_ID 和/或 APPLE_CLIENT_ID：网页第三方登录（Google / Apple）
//               后端零依赖校验各自的 RS256 ID 令牌（JWK 公钥）+ 邮箱白名单 + HMAC 签名会话 cookie
//   password —— 只设了 APP_PASSWORD：HTTP Basic Auth
//   open     —— 都没设：完全放行（本地开发默认）
// 任何模式下，设了 APP_PASSWORD 都额外认 Basic Auth（应急后门，方便脚本/兜底/中国网络）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../lib/paths.js';

const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim();
const appleClientId = () => (process.env.APPLE_CLIENT_ID || '').trim();
const appleRedirect = () => (process.env.APPLE_REDIRECT_URI || 'https://star.wangrui.computer/api/auth/apple/callback').trim();
const appleDomainAssoc = () => process.env.APPLE_DOMAIN_ASSOCIATION || '';
const allowed = () => (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const appPassword = () => process.env.APP_PASSWORD || '';
const SESSION_TTL = 12 * 3600; // 会话有效期 12h
const DBG = (...a) => { if (process.env.AUTH_DEBUG) console.error('[auth-debug]', ...a); };

// 白名单留空或含 '*' → 放行任意「已验证」的第三方账号；否则只放行名单内邮箱。
export function emailAllowed(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  const list = allowed();
  return list.length === 0 || list.includes('*') || list.includes(e);
}

export function authMode() {
  if (clientId() || appleClientId()) return 'oauth';
  if (appPassword()) return 'password';
  return 'open';
}

// ── HMAC 签名小票据（会话 cookie / oauth 临时态）─────────────────────────────
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

function hmacSign(obj) {
  const body = b64url(JSON.stringify(obj));
  return `${body}.${crypto.createHmac('sha256', secret()).update(body).digest('base64url')}`;
}
function hmacVerify(token) {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  if (!safeEq(mac, crypto.createHmac('sha256', secret()).update(body).digest('base64url'))) return null;
  let obj; try { obj = JSON.parse(fromB64url(body).toString('utf8')); } catch { return null; }
  if (!obj || typeof obj.exp !== 'number' || obj.exp < Math.floor(Date.now() / 1000)) return null;
  return obj;
}
export function signSession(obj) { return hmacSign(obj); }
export function verifySession(token) { const o = hmacVerify(token); if (!o) return null; if (!emailAllowed(o.email)) return null; return o; }

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

// ── 通用 RS256 ID 令牌校验（零依赖，用各家 JWK 公钥；按 url 缓存）─────────────
// 注意：必须用 JWK 端点。X.509 证书 crypto.createPublicKey 不吃、会抛错。
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';
const jwksCache = new Map(); // url -> { exp, keys }
async function fetchJwks(url) {
  const c = jwksCache.get(url);
  if (c && Date.now() < c.exp && c.keys.length) return c.keys;
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  const keys = Array.isArray(body.keys) ? body.keys : [];
  const m = (r.headers.get('cache-control') || '').match(/max-age=(\d+)/);
  if (keys.length) jwksCache.set(url, { exp: Date.now() + (m ? Number(m[1]) : 3600) * 1000, keys });
  return keys;
}
// 测试用：注入公钥（JWK 数组），跳过网络
export function __setGoogleKeysForTest(keys) { jwksCache.set(GOOGLE_JWKS, { exp: Date.now() + 3600000, keys: keys || [] }); }
export function __setAppleKeysForTest(keys) { jwksCache.set(APPLE_JWKS, { exp: Date.now() + 3600000, keys: keys || [] }); }

async function verifyRS256(idToken, jwksUrl, expIss, expAud) {
  const [h, p, s] = String(idToken || '').split('.');
  if (!h || !p || !s) return DBG('jwt parts'), null;
  let header; try { header = JSON.parse(fromB64url(h).toString('utf8')); } catch { return DBG('bad header'), null; }
  if (header.alg !== 'RS256' || !header.kid) return DBG('alg/kid', header.alg), null;
  const keys = await fetchJwks(jwksUrl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return DBG('kid not found', header.kid, 'have', keys.map((k) => k.kid)), null;
  let ok = false;
  try { ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(crypto.createPublicKey({ key: jwk, format: 'jwk' }), fromB64url(s)); }
  catch (e) { return DBG('verify threw', e.message), null; }
  if (!ok) return DBG('bad signature'), null;
  let payload; try { payload = JSON.parse(fromB64url(p).toString('utf8')); } catch { return DBG('bad payload'), null; }
  const isses = Array.isArray(expIss) ? expIss : [expIss];
  if (!isses.includes(payload.iss)) return DBG('iss', payload.iss), null;
  if (!expAud || payload.aud !== expAud) return DBG('aud', payload.aud, '!=', expAud), null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return DBG('exp', payload.exp), null;
  return payload;
}

export async function verifyGoogleIdToken(idToken) {
  const payload = await verifyRS256(idToken, GOOGLE_JWKS, ['accounts.google.com', 'https://accounts.google.com'], clientId());
  if (!payload) return null;
  if (payload.email_verified !== true && payload.email_verified !== 'true') return DBG('email_verified', payload.email_verified), null;
  return payload;
}
export async function verifyAppleIdToken(idToken) {
  return verifyRS256(idToken, APPLE_JWKS, 'https://appleid.apple.com', appleClientId());
}

function setSessionAndRedirect(res, email, provider, extraClear) {
  const token = signSession({ email, provider, exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
  const cookies = [`ss_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`];
  if (extraClear) cookies.push(extraClear);
  res.writeHead(302, { 'Set-Cookie': cookies, Location: '/' });
  res.end();
}

// ── 路由：登录页 / 第三方校验 / 登出 / Apple 域名验证文件 ────────────────────
export async function handleAuthRoutes(req, res, pathname) {
  // Apple 域名验证文件：只要配了内容就提供（与登录模式无关，配置阶段要用）
  if (req.method === 'GET' && pathname === '/.well-known/apple-developer-domain-association.txt' && appleDomainAssoc()) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(appleDomainAssoc()); return true;
  }
  if (authMode() !== 'oauth') return false;

  if (req.method === 'GET' && pathname === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(loginPage({ google: clientId(), apple: Boolean(appleClientId()) })); return true;
  }
  if (req.method === 'GET' && pathname === '/logout') {
    res.writeHead(302, { 'Set-Cookie': 'ss_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', Location: '/login' });
    res.end(); return true;
  }

  // ── Google：前端 GIS 拿到 credential 后 POST 过来 ──
  if (req.method === 'POST' && pathname === '/api/auth/google') {
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 8192) break; }
    let cred = ''; try { cred = JSON.parse(raw).credential || ''; } catch {}
    const payload = await verifyGoogleIdToken(cred).catch((e) => (DBG('google verify threw', e.message), null));
    const email = String(payload?.email || '').toLowerCase();
    if (!payload || !emailAllowed(email)) {
      DBG('google reject', { hasPayload: !!payload, email });
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '该 Google 账号未被授权访问' })); return true;
    }
    const token = signSession({ email, provider: 'google', exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
    res.writeHead(200, {
      'Set-Cookie': `ss_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`,
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({ ok: true, email })); return true;
  }

  // ── Apple：① 跳转到 Apple 授权页 ──
  if (req.method === 'GET' && pathname === '/api/auth/apple') {
    if (!appleClientId()) { res.writeHead(404).end(); return true; }
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const blob = hmacSign({ state, nonce, exp: Math.floor(Date.now() / 1000) + 600 });
    const params = new URLSearchParams({
      response_type: 'code id_token', response_mode: 'form_post',
      client_id: appleClientId(), redirect_uri: appleRedirect(), scope: 'name email', state, nonce,
    });
    // 跨站 form_post 回来时要带上临时态 → SameSite=None
    res.writeHead(302, {
      'Set-Cookie': `apple_oauth=${encodeURIComponent(blob)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600`,
      Location: `https://appleid.apple.com/auth/authorize?${params.toString()}`,
    });
    res.end(); return true;
  }
  // ── Apple：② 接收 Apple form_post 回调 ──
  if (req.method === 'POST' && pathname === '/api/auth/apple/callback') {
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 16384) break; }
    const form = new URLSearchParams(raw);
    const saved = hmacVerify(readCookie(req, 'apple_oauth'));
    const clearApple = 'apple_oauth=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0';
    if (!saved || saved.state !== form.get('state')) { DBG('apple state mismatch'); return res.writeHead(302, { 'Set-Cookie': clearApple, Location: '/login?err=apple_state' }).end(); }
    const payload = await verifyAppleIdToken(form.get('id_token') || '').catch((e) => (DBG('apple verify threw', e.message), null));
    if (!payload || payload.nonce !== saved.nonce) { DBG('apple token/nonce fail'); return res.writeHead(302, { 'Set-Cookie': clearApple, Location: '/login?err=apple_token' }).end(); }
    const email = String(payload.email || '').toLowerCase();
    if (!emailAllowed(email)) { DBG('apple email not allowed', email); return res.writeHead(302, { 'Set-Cookie': clearApple, Location: '/login?err=apple_email' }).end(); }
    return setSessionAndRedirect(res, email, 'apple', clearApple);
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
  if (authMode() === 'oauth') return Boolean(verifySession(readCookie(req, 'ss_session')));
  return false;
}

export function denyAuth(req, res) {
  if (authMode() === 'oauth') {
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
      res.writeHead(302, { Location: '/login' }); res.end(); return;
    }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('需要登录'); return;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AI Star Studio", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('需要登录');
}

function loginPage(opts) {
  const googleBlock = opts.google ? `
    <div class="gi"><div id="g_id_onload" data-client_id="${opts.google}" data-callback="onCred" data-auto_prompt="false"></div>
    <div class="g_id_signin" data-type="standard" data-theme="filled_black" data-size="large" data-text="signin_with" data-shape="pill"></div></div>` : '';
  const appleBlock = opts.apple ? `
    <a class="apple-btn" href="/api/auth/apple"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.365 1.43c0 1.14-.49 2.27-1.18 3.08-.74.9-1.99 1.57-2.98 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.2-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43zM20.93 17.14c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8-1.29-1.82-2.32-4.63-2.32-7.28 0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.67.95 3.6.95.86 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z"/></svg>使用 Apple 登录</a>` : '';
  const divider = (opts.google && opts.apple) ? '<div class="divider"><span>或</span></div>' : '';
  const gisScript = opts.google ? '<script src="https://accounts.google.com/gsi/client" async></script>' : '';
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
  .gi{display:flex;justify-content:center;margin-bottom:12px}
  .apple-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:22px;
    background:#000;color:#fff;text-decoration:none;font-size:15px;font-weight:500;border:1px solid #2a2a2a}
  .apple-btn:hover{background:#111}
  .divider{display:flex;align-items:center;gap:10px;color:#6b6688;font-size:12px;margin:14px 0}
  .divider::before,.divider::after{content:"";flex:1;height:1px;background:rgba(150,120,255,.18)}
  #msg{margin-top:16px;min-height:18px;color:#ff9a9a;font-size:13px}
</style></head><body>
  <div class="card">
    <div class="logo">✦ Star Studio</div>
    <div class="sub">虚拟艺人制片棚 · 请用授权的账号登录</div>
    ${googleBlock}${divider}${appleBlock}
    <div id="msg"></div>
  </div>
  ${gisScript}
  <script>
    function onCred(resp){
      document.getElementById('msg').textContent='登录中…';
      fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:resp.credential})})
        .then(function(r){return r.ok?(location.href='/'):r.json().then(function(j){document.getElementById('msg').textContent=(j&&j.error)||'登录失败';});})
        .catch(function(){document.getElementById('msg').textContent='网络错误，请重试';});
    }
    (function(){var e=new URLSearchParams(location.search).get('err');if(e){document.getElementById('msg').textContent='Apple 登录失败（'+e+'），请重试';}})();
  </script>
</body></html>`;
}
