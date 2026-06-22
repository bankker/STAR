// 请求级上下文（AsyncLocalStorage）。
// 多租户的关键：把「当前登录用户」与「该用户的有效环境变量（process.env 叠加其私有 key）」
// 绑定到当前请求的异步链上。能力网关读 key 时调用 currentEnv()，无上下文时回落到 process.env，
// 因此 open/password 模式与既有行为完全一致（零破坏）。
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

// store 形如 { userId, user, env }
export function runWithContext(store, fn) {
  return als.run(store || {}, fn);
}

export function getContext() {
  return als.getStore() || null;
}

// 当前请求的有效环境：登录用户 → process.env 叠加其私有 key；否则 → 全局 process.env
export function currentEnv() {
  const s = als.getStore();
  return s && s.env ? s.env : process.env;
}

export function currentUserId() {
  const s = als.getStore();
  return s && s.userId ? s.userId : null;
}
