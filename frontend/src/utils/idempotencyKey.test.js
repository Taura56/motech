import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdempotencyKey } from './idempotencyKey.js';

test('creates a UUID v4 idempotency key without depending on crypto.randomUUID', () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (bytes) => bytes.fill(0x01) }
  });

  try {
    const key = createIdempotencyKey();
    assert.match(key, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    else delete globalThis.crypto;
  }
});

test('creates a UUID v4 idempotency key when Web Crypto is unavailable', () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });

  try {
    const key = createIdempotencyKey();
    assert.match(key, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    else delete globalThis.crypto;
  }
});
