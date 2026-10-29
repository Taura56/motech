import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../config/env.js';

test('M-Pesa sandbox variables map to the existing Daraja service configuration', () => {
  const parsed = validateEnvironment({
    ...process.env,
    MPESA_ENVIRONMENT: 'sandbox',
    MPESA_CONSUMER_KEY: 'test-key',
    MPESA_CONSUMER_SECRET: 'test-secret',
    MPESA_SHORTCODE: '174379',
    MPESA_PASSKEY: 'test-passkey',
    MPESA_CALLBACK_URL: ''
  });
  assert.equal(parsed.DARAJA_ENV, 'sandbox');
  assert.equal(parsed.DARAJA_CONSUMER_KEY, 'test-key');
  assert.equal(parsed.DARAJA_CONSUMER_SECRET, 'test-secret');
  assert.equal(parsed.DARAJA_SHORTCODE, '174379');
  assert.equal(parsed.DARAJA_PASSKEY, 'test-passkey');
  assert.equal(parsed.DARAJA_CALLBACK_URL, '');
});

test('invalid environment, incomplete credentials, and non-HTTPS callbacks are rejected', () => {
  assert.throws(() => validateEnvironment({
    ...process.env,
    MPESA_ENVIRONMENT: 'live'
  }), /Invalid environment configuration/);

  assert.throws(() => validateEnvironment({
    ...process.env,
    MPESA_CONSUMER_KEY: 'test-key',
    MPESA_CONSUMER_SECRET: '',
    MPESA_SHORTCODE: '',
    MPESA_PASSKEY: ''
  }), /Provide all four M-Pesa credentials together/);

  assert.throws(() => validateEnvironment({
    ...process.env,
    MPESA_CALLBACK_URL: 'http://localhost:3000/api/payments/daraja/callback'
  }), /MPESA_CALLBACK_URL must use HTTPS/);
});
