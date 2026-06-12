import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateRequest, costOfUsage, setPriceOverrides } from '../src/gateway/costs.js';

test('文本估算按 token 单价', () => {
  setPriceOverrides({ 'fake:m': { inputPerMTok: 3, outputPerMTok: 15 } });
  const usd = estimateRequest('chat', 'fake', 'm', { messages: [{ role: 'user', content: 'x'.repeat(3000) }], maxTokens: 1000 });
  // 输入约 3000/3=1000 tok → $0.003；输出 1000 tok → $0.015
  assert.ok(usd > 0.015 && usd < 0.03, String(usd));
});

test('视频按秒、音乐按首、图像按张', () => {
  setPriceOverrides({ 'v:m': { perSecond: 0.1 }, 's:m': { perSong: 0.4 }, 'i:m': { perImage: 0.12 } });
  assert.equal(estimateRequest('video', 'v', 'm', { durationSec: 10 }), 1);
  assert.equal(estimateRequest('music', 's', 'm', {}), 0.4);
  assert.equal(estimateRequest('image', 'i', 'm', {}), 0.12);
});

test('costOfUsage 按实际用量', () => {
  setPriceOverrides({ 'fake:m': { inputPerMTok: 3, outputPerMTok: 15, perImage: 0.1, perSecond: 0.2 } });
  assert.equal(costOfUsage('fake', 'm', { inputTokens: 1_000_000 }), 3);
  assert.equal(costOfUsage('fake', 'm', { outputTokens: 100_000 }), 1.5);
  assert.equal(costOfUsage('fake', 'm', { images: 2 }), 0.2);
  assert.equal(costOfUsage('fake', 'm', { seconds: 5 }), 1);
  assert.equal(costOfUsage('unknown', 'm', {}), 0);
});

test('通配符回退 provider:*', () => {
  setPriceOverrides({ 'agg:*': { perImage: 0.2 } });
  assert.equal(costOfUsage('agg', 'whatever-model', { images: 1 }), 0.2);
});
