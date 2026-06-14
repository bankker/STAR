import { test } from 'node:test';
import assert from 'node:assert/strict';
import { srtTime, buildSrt } from '../src/lib/ffmpeg.js';

test('srtTime 格式 HH:MM:SS,mmm', () => {
  assert.equal(srtTime(0), '00:00:00,000');
  assert.equal(srtTime(1.5), '00:00:01,500');
  assert.equal(srtTime(3661.25), '01:01:01,250');
});

test('buildSrt 逐段累加时间轴', () => {
  const srt = buildSrt([
    { text: '你好', durationSec: 1 },
    { text: '欢迎', durationSec: 2 },
  ]);
  assert.match(srt, /1\n00:00:00,000 --> 00:00:01,000\n你好/);
  assert.match(srt, /2\n00:00:01,000 --> 00:00:03,000\n欢迎/);
});
