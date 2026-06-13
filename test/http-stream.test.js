import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { splitSSE, fetchStream } from '../src/lib/http-fetch.js';

test('splitSSE 解析完整 data 行，保留半行', () => {
  const r1 = splitSSE('data: a\ndata: b\ndata: ');
  assert.deepEqual(r1.datas, ['a', 'b']);
  assert.equal(r1.rest, 'data: ');
  const r2 = splitSSE(r1.rest + 'c\n');
  assert.deepEqual(r2.datas, ['c']);
  assert.equal(r2.rest, '');
});

test('splitSSE 忽略非 data 行与空 data', () => {
  const r = splitSSE(': comment\nevent: x\ndata:\ndata: ok\n');
  assert.deepEqual(r.datas, ['ok']);
});

function sseServer(frames) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const f of frames) res.write(f);
    res.end();
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

test('fetchStream 聚合 SSE data 负载', async () => {
  const { srv, port } = await sseServer(['data: a\n\n', 'data: b\n\n', 'data: [DONE]\n\n']);
  const got = [];
  await fetchStream(`http://127.0.0.1:${port}/`, { method: 'GET' }, (d) => got.push(d));
  assert.deepEqual(got, ['a', 'b', '[DONE]']);
  srv.close();
});

test('fetchStream 在 onChunk 抛错后释放 reader（不卡死）', async () => {
  const { srv, port } = await sseServer(['data: x\n\n', 'data: y\n\n']);
  await assert.rejects(
    () => fetchStream(`http://127.0.0.1:${port}/`, { method: 'GET' }, () => { throw new Error('boom'); }),
    /boom/,
  );
  srv.close();
});
