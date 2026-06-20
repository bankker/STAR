import { test } from 'node:test';
import assert from 'node:assert/strict';

// 固定会话密钥，保证可重复
process.env.SESSION_SECRET = 'test-secret-xyz';

const { authMode, signSession, verifySession, isAuthed } = await import('../src/api/auth.js');

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
  process.env.ALLOWED_EMAILS = 'a@b.com';
  assert.equal(authMode(), 'google'); // google 优先
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
