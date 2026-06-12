import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayError, gatewayError, fromHttpStatus } from '../src/gateway/errors.js';

test('retriable 按错误码自动判定', () => {
  assert.equal(gatewayError('quota', 'x').retriable, true);
  assert.equal(gatewayError('timeout', 'x').retriable, true);
  assert.equal(gatewayError('network', 'x').retriable, true);
  assert.equal(gatewayError('provider_error', 'x').retriable, true);
  assert.equal(gatewayError('auth', 'x').retriable, false);
  assert.equal(gatewayError('bad_request', 'x').retriable, false);
  assert.equal(gatewayError('safety', 'x').retriable, false);
  assert.equal(gatewayError('unconfigured', 'x').retriable, false);
});

test('fromHttpStatus 映射', () => {
  assert.equal(fromHttpStatus(401, '', 'p').code, 'auth');
  assert.equal(fromHttpStatus(403, '', 'p').code, 'auth');
  assert.equal(fromHttpStatus(429, '', 'p').code, 'quota');
  assert.equal(fromHttpStatus(500, '', 'p').code, 'provider_error');
  assert.equal(fromHttpStatus(400, 'bad', 'p').code, 'bad_request');
  assert.equal(fromHttpStatus(400, '', 'p').providerId, 'p');
});

test('toJSON 不泄漏 cause', () => {
  const e = gatewayError('auth', 'm', { providerId: 'p', hint: 'h', cause: new Error('secret') });
  const j = JSON.parse(JSON.stringify(e));
  assert.deepEqual(j, { code: 'auth', message: 'm', providerId: 'p', hint: 'h' });
  assert.ok(e instanceof GatewayError);
});
