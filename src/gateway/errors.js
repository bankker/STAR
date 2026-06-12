export const RETRIABLE_CODES = new Set(['quota', 'timeout', 'network', 'provider_error']);

export class GatewayError extends Error {
  constructor(code, message, { providerId = null, retriable = null, hint = '', cause = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.providerId = providerId;
    this.retriable = retriable === null ? RETRIABLE_CODES.has(code) : retriable;
    this.hint = hint;
    this.cause = cause;
  }
  toJSON() {
    return { code: this.code, message: this.message, providerId: this.providerId, hint: this.hint };
  }
}

export function gatewayError(code, message, opts = {}) {
  return new GatewayError(code, message, opts);
}

export function fromHttpStatus(status, bodyText, providerId) {
  const snippet = String(bodyText || '').slice(0, 300);
  if (status === 401 || status === 403) return gatewayError('auth', `HTTP ${status}`, { providerId, hint: '检查该平台 API key 是否有效' });
  if (status === 429) return gatewayError('quota', 'HTTP 429 限流', { providerId, hint: '稍后重试或检查平台配额/余额' });
  if (status >= 500) return gatewayError('provider_error', `HTTP ${status}: ${snippet}`, { providerId });
  return gatewayError('bad_request', `HTTP ${status}: ${snippet}`, { providerId });
}
