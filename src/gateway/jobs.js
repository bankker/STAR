import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { costOfUsage } from './costs.js';

let jobsFile = null;
let executor = null;
let maxConcurrency = 2;
const jobs = new Map();
const queue = [];
let running = 0;
let persistTimer = null;

export function initJobs({ file, executeFn, concurrency }) {
  jobsFile = file;
  executor = executeFn;
  maxConcurrency = concurrency || Number(process.env.JOBS_CONCURRENCY || 2);
  jobs.clear(); queue.length = 0; running = 0;
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try {
      for (const j of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        if (j.status === 'running' || j.status === 'queued') { j.status = 'interrupted'; j.requestIntact = false; }
        jobs.set(j.id, j);
      }
    } catch (err) { console.error('[jobs] 持久化文件损坏，忽略', err.message); }
  }
}

export function submitJob(capability, request, { estimate = null } = {}) {
  const job = {
    id: `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    capability, request, requestIntact: true,
    status: 'queued', stage: '排队中', progress: 0,
    costEstimate: estimate, costActual: null, result: null, error: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  persistSoon();
  pump();
  return job;
}

export function getJob(id) { return jobs.get(id) || null; }

export function listJobs(limit = 50) {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(sanitize);
}

export function retryJob(id) {
  const job = jobs.get(id);
  if (!job) return { error: { code: 'not_found', message: `无此任务 ${id}` } };
  if (job.status !== 'failed' && job.status !== 'interrupted') return { error: { code: 'bad_request', message: '仅失败/中断任务可重试' } };
  if (!job.requestIntact) return { error: { code: 'retry_unavailable', message: '重启后原始请求已不完整，请在卡片重新提交' } };
  job.status = 'queued'; job.stage = '排队中'; job.progress = 0; job.error = null;
  queue.push(job);
  persistSoon();
  pump();
  return { ok: true };
}

function pump() {
  while (running < maxConcurrency && queue.length) runJob(queue.shift());
}

async function runJob(job) {
  running += 1;
  job.status = 'running'; job.stage = '执行中';
  touch(job);
  try {
    const result = await executor(job.capability, job.request, {
      onProgress: (stage, progress) => {
        if (job.status !== 'running') return; // 终态后迟到的进度回调不再生效
        job.stage = stage; if (progress != null) job.progress = progress; touch(job);
      },
    });
    job.status = 'done'; job.progress = 100;
    job.result = { files: result.files || [], provider: result.provider, model: result.model, durationSec: result.durationSec };
    if (result.provider) job.costActual = costOfUsage(result.provider, result.model, result.usage || {});
  } catch (e) {
    job.status = 'failed';
    job.error = e.toJSON ? e.toJSON() : { code: 'internal', message: e.message };
    if (e.attempts) job.error.attempts = e.attempts;
  } finally {
    running -= 1;
    touch(job, true);
    pump();
  }
}

function touch(job, immediate = false) {
  job.updatedAt = new Date().toISOString();
  persistSoon(immediate);
}

export function sanitize(job) {
  const { request, result, ...rest } = job;
  const safeResult = result
    ? { ...result, files: (result.files || []).map((f) => ({ url: f.url })) }
    : result;
  return {
    ...rest,
    result: safeResult,
    request: JSON.parse(JSON.stringify(request || {}, (k, v) =>
      typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 100)}…(${v.length} chars)` : v)),
  };
}

function persistSoon(immediate = false) {
  if (immediate) return persist();
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 1000);
  persistTimer.unref?.();
}

function persist() {
  if (!jobsFile) return;
  try { fs.writeFileSync(jobsFile, JSON.stringify([...jobs.values()].map(sanitize), null, 2)); }
  catch (err) { console.error('[jobs] 持久化失败', err.message); }
}
