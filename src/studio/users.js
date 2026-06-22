// 本地用户库：邮箱+密码注册/登录，每用户自带私有 API key 集合。
// 持久化到 data/users.json（原子写）。密码用 scrypt 加盐哈希，永不明文存储。
// key 仅存服务端、不回显完整值，与全局 .env 的安全约束一致。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let usersFile = null;

export function initUsers(file) {
  usersFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch {} }
}

function readUsers() {
  if (!usersFile || !fs.existsSync(usersFile)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeUsers(arr) {
  const tmp = `${usersFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, usersFile);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function safeEqHex(a, b) {
  const x = Buffer.from(String(a), 'hex'); const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// 对外安全投影：永不含 hash/salt，key 只给末四位状态
export function safeUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name || '', provider: 'local', createdAt: u.createdAt };
}

export function getUserById(id) { return readUsers().find((u) => u.id === id) || null; }
export function getUserByEmail(email) {
  const e = normalizeEmail(email);
  return readUsers().find((u) => u.email === e) || null;
}

export function createUser({ email, name, password }) {
  const e = normalizeEmail(email);
  if (!EMAIL_RE.test(e)) throw new Error('邮箱格式不正确');
  if (typeof password !== 'string' || password.length < 6) throw new Error('密码至少 6 位');
  const arr = readUsers();
  if (arr.some((u) => u.email === e)) throw new Error('该邮箱已注册');
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const user = {
    id: `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    email: e,
    name: String(name || '').trim() || e.split('@')[0],
    salt,
    hash: hashPassword(password, salt),
    keys: {},
    createdAt: now,
    updatedAt: now,
  };
  arr.push(user);
  writeUsers(arr);
  return user;
}

// 校验登录，成功返回用户记录，失败返回 null（不区分「邮箱不存在」与「密码错误」以防枚举）
export function verifyLogin(email, password) {
  const u = getUserByEmail(email);
  if (!u) return null;
  if (!safeEqHex(u.hash, hashPassword(password, u.salt))) return null;
  return u;
}

// —— 每用户 key ——
export function getUserKeys(id) {
  const u = getUserById(id);
  return u && u.keys ? { ...u.keys } : {};
}

export function setUserKey(id, key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`非法环境变量名: ${key}`);
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('值不合法');
  const arr = readUsers();
  const i = arr.findIndex((u) => u.id === id);
  if (i === -1) throw new Error('用户不存在');
  arr[i].keys = arr[i].keys || {};
  const v = value.trim();
  if (v) arr[i].keys[key] = v; else delete arr[i].keys[key];
  arr[i].updatedAt = new Date().toISOString();
  writeUsers(arr);
  return v ? v.slice(-4) : '';
}
