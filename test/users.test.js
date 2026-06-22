import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SESSION_SECRET = 'test-secret-users';

import {
  initUsers, createUser, verifyLogin, getUserById, getUserByEmail,
  setUserKey, getUserKeys, safeUser, normalizeEmail,
} from '../src/studio/users.js';
import { authMode, isAuthed, currentUser, localUser, signSession } from '../src/api/auth.js';

const future = () => Math.floor(Date.now() / 1000) + 3600;
const cookieReq = (tok) => ({ headers: { cookie: `ss_session=${encodeURIComponent(tok)}` } });

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-users-'));
  initUsers(path.join(dir, 'users.json'));
});

test('createUser 加盐哈希存储，明文密码不落库', () => {
  const u = createUser({ email: 'A@Example.com', name: '小明', password: 'hunter2' });
  assert.equal(u.email, 'a@example.com');         // 邮箱归一化
  assert.equal(u.name, '小明');
  assert.ok(u.salt && u.hash);
  assert.notEqual(u.hash, 'hunter2');             // 不是明文
  assert.ok(!JSON.stringify(u.keys).includes('hunter2'));
});

test('createUser 校验：邮箱格式 / 密码长度 / 重复邮箱', () => {
  assert.throws(() => createUser({ email: 'bad', password: 'abcdef' }), /邮箱/);
  assert.throws(() => createUser({ email: 'x@y.com', password: '123' }), /密码至少/);
  createUser({ email: 'dup@y.com', password: 'abcdef' });
  assert.throws(() => createUser({ email: 'DUP@y.com', password: 'abcdef' }), /已注册/);
});

test('verifyLogin 正确放行、错误/不存在返回 null', () => {
  createUser({ email: 'u@y.com', password: 'goodpass' });
  assert.ok(verifyLogin('u@y.com', 'goodpass'));
  assert.equal(verifyLogin('u@y.com', 'wrong'), null);
  assert.equal(verifyLogin('nobody@y.com', 'goodpass'), null);
  assert.ok(verifyLogin('U@Y.COM', 'goodpass'));   // 大小写不敏感
});

test('每用户 key：写入只返回末四位、空值删除、互不影响', () => {
  const a = createUser({ email: 'a@y.com', password: 'abcdef' });
  const b = createUser({ email: 'b@y.com', password: 'abcdef' });
  const tail = setUserKey(a.id, 'DASHSCOPE_API_KEY', 'sk-1234567890ABCD');
  assert.equal(tail, 'ABCD');
  assert.equal(getUserKeys(a.id).DASHSCOPE_API_KEY, 'sk-1234567890ABCD');
  assert.deepEqual(getUserKeys(b.id), {});         // 互相隔离
  setUserKey(a.id, 'DASHSCOPE_API_KEY', '');        // 空值 → 删除
  assert.equal(getUserKeys(a.id).DASHSCOPE_API_KEY, undefined);
  assert.throws(() => setUserKey(a.id, 'bad key', 'x'), /非法/);
});

test('safeUser 不泄露 hash/salt/keys', () => {
  const u = createUser({ email: 's@y.com', password: 'abcdef' });
  setUserKey(u.id, 'DASHSCOPE_API_KEY', 'secret-value');
  const safe = safeUser(getUserById(u.id));
  assert.equal(safe.email, 's@y.com');
  assert.equal(safe.provider, 'local');
  assert.ok(!('hash' in safe) && !('salt' in safe) && !('keys' in safe));
});

test('local 模式：authMode/isAuthed/currentUser 按本地会话判定', () => {
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.APPLE_CLIENT_ID; delete process.env.APP_PASSWORD;
  process.env.LOCAL_AUTH = '1';
  assert.equal(authMode(), 'local');
  const u = createUser({ email: 'sess@y.com', password: 'abcdef' });
  const tok = signSession({ uid: u.id, email: u.email, provider: 'local', exp: future() });
  assert.equal(isAuthed(cookieReq(tok)), true);
  assert.equal(currentUser(cookieReq(tok)).email, 'sess@y.com');
  assert.equal(localUser(cookieReq(tok)).id, u.id);
  // 无/坏 cookie 被拦
  assert.equal(isAuthed({ headers: {} }), false);
  assert.equal(isAuthed(cookieReq(tok + 'x')), false);
  // 非 local provider 的票据不被 localUser 接受
  assert.equal(localUser(cookieReq(signSession({ email: 'g@y.com', provider: 'google', exp: future() }))), null);
  delete process.env.LOCAL_AUTH;
});

test('normalizeEmail 去空格转小写', () => {
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
});
