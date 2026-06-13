import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { gatewayError, fromHttpStatus, GatewayError } from '../gateway/errors.js';

export async function fetchJson(url, opts = {}) {
  const { status, text } = await rawFetch(url, normalizeOpts(url, opts));
  if (status < 200 || status >= 300) throw fromHttpStatus(status, text, opts.providerId);
  try { return text ? JSON.parse(text) : {}; }
  catch { throw gatewayError('provider_error', `响应不是合法 JSON: ${text.slice(0, 200)}`, { providerId: opts.providerId }); }
}

export async function fetchBuffer(url, opts = {}) {
  const o = { ...normalizeOpts(url, opts), wantBuffer: true };
  const { status, buffer } = await rawFetch(url, o);
  if (status < 200 || status >= 300) throw fromHttpStatus(status, buffer.toString('utf8'), opts.providerId);
  return buffer;
}

function normalizeOpts(url, opts) {
  const hasBody = opts.body !== undefined;
  const headers = { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) };
  const body = !hasBody ? undefined
    : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  return { method: opts.method || 'POST', headers, body, timeoutMs: opts.timeoutMs || 120000, proxy: opts.proxy, providerId: opts.providerId };
}

async function rawFetch(url, o) {
  if (o.proxy) return proxyFetch(url, o);
  let res;
  try {
    res = await fetch(url, { method: o.method, headers: o.headers, body: o.body, signal: AbortSignal.timeout(o.timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw gatewayError('timeout', `请求超时（${o.timeoutMs}ms）: ${url}`, { providerId: o.providerId });
    }
    throw gatewayError('network', `网络错误: ${err.cause?.code || err.message}`, { providerId: o.providerId, cause: err });
  }
  if (o.wantBuffer) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  return { status: res.status, text: await res.text() };
}

function proxyFetch(url, o) {
  const target = new URL(url);
  const p = new URL(o.proxy);
  if (target.protocol !== 'https:') {
    return Promise.reject(gatewayError('bad_request', '代理模式仅支持 https 目标', { providerId: o.providerId }));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };
    const fail = (code, msg, cause) => done(reject, cause instanceof GatewayError ? cause : gatewayError(code, msg, { providerId: o.providerId, cause }));

    const connectReq = http.request({
      host: p.hostname, port: Number(p.port) || 80, method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
    });
    // 超时统一用此定时器；connectReq.destroy() 会连带关闭已建立的隧道 socket
    const timer = setTimeout(() => {
      fail('timeout', `代理请求超时（${o.timeoutMs}ms）: ${url}`);
      connectReq.destroy();
    }, o.timeoutMs);

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return fail('network', `代理 CONNECT 失败: HTTP ${res.statusCode}`); }
      const req = https.request({
        host: target.hostname,
        path: target.pathname + target.search,
        method: o.method,
        headers: { ...o.headers, host: target.hostname },
        createConnection: () => tls.connect({ socket, servername: target.hostname }),
      }, (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const buffer = Buffer.concat(chunks);
          done(resolve, o.wantBuffer ? { status: resp.statusCode, buffer } : { status: resp.statusCode, text: buffer.toString('utf8') });
        });
        resp.on('error', (e) => fail('network', `代理响应流错误: ${e.message}`, e));
      });
      req.on('error', (e) => fail('network', `代理隧道请求失败: ${e.message}`, e));
      if (o.body) req.write(o.body);
      req.end();
    });
    connectReq.on('response', (res) => fail('network', `代理 CONNECT 失败: HTTP ${res.statusCode}`));
    connectReq.on('error', (e) => fail('network', `代理连接失败: ${e.message}`, e));
    connectReq.end();
  });
}
