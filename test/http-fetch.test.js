import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { fetchJson, fetchBuffer } from '../src/lib/http-fetch.js';

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

test('成功请求返回解析后的 JSON', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"hello":"world"}');
  });
  const port = await listen(server);
  const data = await fetchJson(`http://127.0.0.1:${port}/x`, { method: 'GET' });
  assert.equal(data.hello, 'world');
  server.close();
});

test('非 2xx 抛 GatewayError（429→quota）', async () => {
  const server = http.createServer((req, res) => { res.writeHead(429); res.end('slow down'); });
  const port = await listen(server);
  await assert.rejects(
    () => fetchJson(`http://127.0.0.1:${port}/x`, { method: 'GET', providerId: 'p' }),
    (e) => e.code === 'quota' && e.providerId === 'p',
  );
  server.close();
});

test('超时抛 timeout', async () => {
  const server = http.createServer(() => { /* 永不响应 */ });
  const port = await listen(server);
  await assert.rejects(
    () => fetchJson(`http://127.0.0.1:${port}/x`, { method: 'GET', timeoutMs: 200 }),
    (e) => e.code === 'timeout',
  );
  server.close();
});

test('连接拒绝抛 network', async () => {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((r) => server.close(r)); // 拿到一个刚释放的端口，连接必被拒绝
  await assert.rejects(
    () => fetchJson(`http://127.0.0.1:${port}/x`, { method: 'GET', timeoutMs: 1000 }),
    (e) => e.code === 'network',
  );
});

test('配置 proxy 时向代理发起 CONNECT', async () => {
  let sawConnect = '';
  const proxy = net.createServer((socket) => {
    socket.once('data', (buf) => { sawConnect = buf.toString().split('\r\n')[0]; socket.destroy(); });
  });
  const port = await listen(proxy);
  await assert.rejects(
    () => fetchJson('https://example.com/api', { method: 'GET', proxy: `http://127.0.0.1:${port}`, timeoutMs: 1000 }),
  );
  assert.match(sawConnect, /^CONNECT example\.com:443/);
  proxy.close();
});

test('fetchBuffer 返回二进制内容', async () => {
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(bytes);
  });
  const port = await listen(server);
  const buf = await fetchBuffer(`http://127.0.0.1:${port}/bin`, { method: 'GET' });
  assert.deepEqual(buf, bytes);
  server.close();
});

test('代理 CONNECT 返回非 200 抛 network', async () => {
  const proxy = net.createServer((socket) => {
    socket.once('data', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  });
  const port = await listen(proxy);
  await assert.rejects(
    () => fetchJson('https://example.com/api', { method: 'GET', proxy: `http://127.0.0.1:${port}`, timeoutMs: 2000 }),
    (e) => e.code === 'network' && /CONNECT 失败/.test(e.message),
  );
  proxy.close();
});

test('代理模式拒绝非 https 目标', async () => {
  await assert.rejects(
    () => fetchJson('http://example.com/api', { method: 'GET', proxy: 'http://127.0.0.1:1' }),
    (e) => e.code === 'bad_request',
  );
});
