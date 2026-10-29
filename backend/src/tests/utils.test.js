import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKenyanPhone } from '../utils/phone.js';
import { routerUptime, addSeconds } from '../utils/time.js';

test('Kenyan phone normalization accepts common supported formats', () => {
  assert.equal(normalizeKenyanPhone('0712 345 678'), '254712345678');
  assert.equal(normalizeKenyanPhone('+254 112 345 678'), '254112345678');
  assert.equal(normalizeKenyanPhone('712345678'), '254712345678');
});

test('Kenyan phone normalization rejects unsupported numbers', () => {
  assert.throws(() => normalizeKenyanPhone('0201234567'), { code: 'INVALID_PHONE' });
  assert.throws(() => normalizeKenyanPhone('25471234567'), { code: 'INVALID_PHONE' });
});

test('RouterOS uptime formatting and expiry arithmetic are deterministic', () => {
  assert.equal(routerUptime(90061), '1d1h1m1s');
  assert.equal(routerUptime(3600), '1h0s');
  assert.equal(addSeconds(new Date('2026-01-01T00:00:00Z'), 60).toISOString(), '2026-01-01T00:01:00.000Z');
});
