import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initJobs, submitJob, getJob, listJobs } from '../src/gateway/jobs.js';
import { gatewayError } from '../src/gateway/errors.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssjob-')), 'jobs.json');

async function waitFor(jobId, status, ms = 2000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (getJob(jobId)?.status === status) return getJob(jobId);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等待 ${status} 超时，当前 ${getJob(jobId)?.status}`);
}

test('submit→running→done，进度可见', async () => {
  initJobs({
    file: tmpFile(), concurrency: 2,
    executeFn: async (cap, req, { onProgress }) => {
      onProgress('提交平台', 30);
      await new Promise((r) => setTimeout(r, 50));
      onProgress('下载产物', 90);
      return { files: [{ url: '/generated/x.mp4' }], provider: 'p', model: 'm', usage: { seconds: 5 } };
    },
  });
  const { id } = submitJob('video', { prompt: 'x' }, { estimate: { estimatedUsd: 0.5 } });
  const done = await waitFor(id, 'done');
  assert.equal(done.progress, 100);
  assert.equal(done.result.files[0].url, '/generated/x.mp4');
  assert.equal(done.costEstimate.estimatedUsd, 0.5);
});

test('失败落 error 并可序列化', async () => {
  initJobs({ file: tmpFile(), executeFn: async () => { throw gatewayError('quota', '配额用尽', { providerId: 'p' }); } });
  const { id } = submitJob('music', {}, {});
  const failed = await waitFor(id, 'failed');
  assert.equal(failed.error.code, 'quota');
});

test('并发上限排队', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  initJobs({ file: tmpFile(), concurrency: 1, executeFn: async () => { await gate; return { files: [] }; } });
  const a = submitJob('video', {}, {});
  const b = submitJob('video', {}, {});
  await waitFor(a.id, 'running');
  assert.equal(getJob(b.id).status, 'queued');
  release();
  await waitFor(b.id, 'done');
});

test('重启恢复：running → interrupted', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify([{ id: 'job_x', capability: 'video', status: 'running', request: {}, createdAt: new Date().toISOString() }]));
  initJobs({ file, executeFn: async () => ({ files: [] }) });
  assert.equal(getJob('job_x').status, 'interrupted');
  assert.equal(listJobs()[0].id, 'job_x');
});

test('长字符串请求字段持久化时被截断', async () => {
  const file = tmpFile();
  initJobs({ file, executeFn: async () => ({ files: [] }) });
  const { id } = submitJob('video', { imageRef: 'data:image/png;base64,' + 'A'.repeat(50000) }, {});
  await waitFor(id, 'done');
  await new Promise((r) => setTimeout(r, 1100)); // 等待节流写盘
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(JSON.stringify(persisted).length < 20000);
});
