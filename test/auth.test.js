import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// 固定会话密钥，保证可重复
process.env.SESSION_SECRET = 'test-secret-xyz';

const { authMode, signSession, verifySession, isAuthed, verifyGoogleIdToken, __setGoogleKeysForTest, emailAllowed } = await import('../src/api/auth.js');

function clearEnv() {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.ALLOWED_EMAILS;
  delete process.env.APP_PASSWORD;
}
const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 10;
const basicReq = (user, pass) => ({ headers: { authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } });
const cookieReq = (tok) => ({ headers: { cookie: `ss_session=${encodeURIComponent(tok)}` } });

test('authMode 由环境变量决定', () => {
  clearEnv();
  assert.equal(authMode(), 'open');
  process.env.APP_PASSWORD = 'pw';
  assert.equal(authMode(), 'password');
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
  assert.equal(authMode(), 'google'); // 只要有 CLIENT_ID 就是 google（白名单可空）
  process.env.ALLOWED_EMAILS = 'a@b.com';
  assert.equal(authMode(), 'google');
  clearEnv();
});

test('白名单留空 → 放行任意已验证 Google 账号', () => {
  clearEnv();
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com'; // 无 ALLOWED_EMAILS
  assert.ok(verifySession(signSession({ email: 'anyone@gmail.com', exp: future() })));
  assert.ok(verifySession(signSession({ email: 'other@whatever.com', exp: future() })));
  assert.equal(verifySession(signSession({ email: '', exp: future() })), null); // 空邮箱仍不放行
  clearEnv();
});

test('会话签名往返：有效/被篡改/过期', () => {
  clearEnv();
  const tok = signSession({ email: 'a@b.com', exp: future() });
  assert.equal(verifySession(tok).email, 'a@b.com');
  assert.equal(verifySession(tok + 'x'), null);                 // 篡改 MAC
  assert.equal(verifySession(signSession({ email: 'a@b.com', exp: past() })), null); // 过期
  assert.equal(verifySession('garbage'), null);
});

test('会话校验复查邮箱白名单（移出白名单即失效）', () => {
  clearEnv();
  process.env.ALLOWED_EMAILS = 'ok@b.com';
  assert.ok(verifySession(signSession({ email: 'ok@b.com', exp: future() })));
  assert.equal(verifySession(signSession({ email: 'evil@b.com', exp: future() })), null);
  clearEnv();
});

test('open 模式全放行', () => {
  clearEnv();
  assert.equal(isAuthed({ headers: {} }), true);
});

test('emailAllowed：白名单空=放行任意非空邮箱；有名单=只放行名单内（修复登录 403 bug）', () => {
  clearEnv();
  // 白名单留空 → 任意非空邮箱放行
  assert.equal(emailAllowed('arofreedoor@gmail.com'), true);
  assert.equal(emailAllowed('anyone@example.com'), true);
  assert.equal(emailAllowed(''), false);
  // 有白名单 → 只放行名单内（大小写不敏感）
  process.env.ALLOWED_EMAILS = 'A@b.com, c@d.com';
  assert.equal(emailAllowed('a@b.com'), true);
  assert.equal(emailAllowed('C@D.com'), true);
  assert.equal(emailAllowed('x@y.com'), false);
  clearEnv();
});

test('verifyGoogleIdToken：用 JWK 验签真实结构的令牌（覆盖曾经的 403 bug）', async () => {
  clearEnv();
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }); jwk.kid = 'k1'; jwk.alg = 'RS256';
  __setGoogleKeysForTest([jwk]);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mint = (payload, kid = 'k1') => {
    const head = enc({ alg: 'RS256', kid });
    const body = enc(payload);
    const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const base = { iss: 'https://accounts.google.com', aud: 'cid.apps.googleusercontent.com', email: 'me@gmail.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 };
  assert.equal((await verifyGoogleIdToken(mint(base))).email, 'me@gmail.com'); // 有效令牌
  assert.equal(await verifyGoogleIdToken(mint({ ...base, aud: 'other' })), null); // aud 不符
  assert.equal(await verifyGoogleIdToken(mint({ ...base, email_verified: false })), null); // 邮箱未验证
  assert.equal(await verifyGoogleIdToken(mint({ ...base, exp: Math.floor(Date.now() / 1000) - 1 })), null); // 过期
  assert.equal(await verifyGoogleIdToken(mint(base, 'nope')), null); // kid 找不到
  const t = mint(base); assert.equal(await verifyGoogleIdToken(t.slice(0, -3) + 'xxx'), null); // 篡改签名
  clearEnv();
});

test('password 模式：Basic 正确放行、错误拦截', () => {
  clearEnv();
  process.env.APP_PASSWORD = 's3cret';
  assert.equal(isAuthed(basicReq('x', 's3cret')), true);
  assert.equal(isAuthed(basicReq('x', 'wrong')), false);
  assert.equal(isAuthed({ headers: {} }), false);
  clearEnv();
});

test('google 模式：有效 cookie 放行；APP_PASSWORD 作应急 Basic 后门', () => {
  clearEnv();
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
  process.env.ALLOWED_EMAILS = 'a@b.com';
  process.env.APP_PASSWORD = 'backdoor';
  // 有效会话 cookie
  assert.equal(isAuthed(cookieReq(signSession({ email: 'a@b.com', exp: future() }))), true);
  // 无 cookie 被拦
  assert.equal(isAuthed({ headers: {} }), false);
  // 应急 Basic 后门仍可用
  assert.equal(isAuthed(basicReq('x', 'backdoor')), true);
  assert.equal(isAuthed(basicReq('x', 'nope')), false);
  clearEnv();
});
