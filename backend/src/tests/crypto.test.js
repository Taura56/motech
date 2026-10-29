import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, tokenHash, createPublicToken } from '../utils/crypto.js';

test('encrypted access credentials round-trip without storing plaintext', () => {
  const plaintext = 'generated-test-password';
  const encrypted = encryptSecret(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptSecret(encrypted), plaintext);
});

test('public payment tokens are high entropy and hashed to fixed-length identifiers', () => {
  const token = createPublicToken();
  assert.ok(token.length >= 40);
  assert.notEqual(tokenHash(token), token);
  assert.equal(tokenHash(token).length, 64);
});
