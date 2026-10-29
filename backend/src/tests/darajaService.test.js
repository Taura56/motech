import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { config } from '../config/env.js';

test('Daraja OAuth, STK Push password/request and query use mocked HTTP only', async () => {
  const calls = [];
  let authFailure = false;
  let stkFailure = false;
  let stkRejected = false;
  let service;
  const originalCreate = axios.create;
  axios.create = () => ({
    get: async (url, options) => {
      calls.push({ method: 'GET', url, options });
      if (authFailure) throw new Error('private-credential-marker');
      return { data: { access_token: 'mock-access-token', expires_in: '3600' } };
    },
    post: async (url, body, options) => {
      calls.push({ method: 'POST', url, body, options });
      if (url.includes('processrequest')) {
        if (stkFailure) throw new Error('private-credential-marker');
        if (stkRejected) return { data: { ResponseCode: '1', ResponseDescription: 'private-credential-marker' } };
        return { data: { ResponseCode: '0', CheckoutRequestID: 'ws_CO_123', MerchantRequestID: 'merchant_123', CustomerMessage: 'Check phone' } };
      }
      return { data: { ResultCode: '0', CheckoutRequestID: 'ws_CO_123' } };
    }
  });
  try {
    service = await import('../services/darajaService.js');
    service.resetTokenCacheForTests();
    const result = await service.initiateStkPush({
      phoneNumber: '254712345678', amountKes: 50, orderId: '12345678-1234-1234-1234-123456789012'
    });
    assert.equal(result.checkoutRequestId, 'ws_CO_123');
    assert.equal(calls[0].url, '/oauth/v1/generate?grant_type=client_credentials');
    assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('test-consumer-key:test-consumer-secret').toString('base64')}`);
    const request = calls.find((call) => call.url.includes('processrequest'));
    assert.equal(request.body.Amount, 50);
    assert.equal(request.body.PartyA, '254712345678');
    assert.equal(request.body.BusinessShortCode, '174379');
    assert.equal(request.body.CallBackURL, 'https://backend.test.invalid/api/payments/daraja/callback');
    assert.match(request.body.Timestamp, /^\d{14}$/);
    assert.equal(Buffer.from(request.body.Password, 'base64').toString(), `174379test-passkey${request.body.Timestamp}`);
    assert.equal(request.options.headers.Authorization, 'Bearer mock-access-token');

    await service.queryStkPush('ws_CO_123');
    assert.equal(calls.filter((call) => call.url.startsWith('/oauth/')).length, 1, 'cached OAuth token is reused');
    const query = calls.find((call) => call.url.includes('query'));
    assert.equal(query.body.CheckoutRequestID, 'ws_CO_123');
    assert.equal(query.body.BusinessShortCode, '174379');

    stkFailure = true;
    await assert.rejects(service.initiateStkPush({
      phoneNumber: '254712345678', amountKes: 50, orderId: '12345678-1234-1234-1234-123456789012'
    }), { code: 'DARAJA_STK_OUTCOME_UNKNOWN' });
    stkFailure = false;
    stkRejected = true;
    await assert.rejects(service.initiateStkPush({
      phoneNumber: '254712345678', amountKes: 50, orderId: '12345678-1234-1234-1234-123456789012'
    }), (error) => error.code === 'STK_REQUEST_REJECTED' && !error.message.includes('private-credential-marker'));
    stkRejected = false;
    await assert.rejects(service.initiateStkPush({
      phoneNumber: '254712345678', amountKes: 0, orderId: '12345678-1234-1234-1234-123456789012'
    }), { code: 'INVALID_PAYMENT_AMOUNT' });

    const callbackUrl = config.DARAJA_CALLBACK_URL;
    config.DARAJA_CALLBACK_URL = '';
    await assert.rejects(service.initiateStkPush({
      phoneNumber: '254712345678', amountKes: 50, orderId: '12345678-1234-1234-1234-123456789012'
    }), { code: 'CALLBACK_NOT_CONFIGURED' });
    config.DARAJA_CALLBACK_URL = callbackUrl;

    service.resetTokenCacheForTests();
    authFailure = true;
    await assert.rejects(service.getAccessToken(), (error) =>
      error.code === 'DARAJA_AUTH_UNAVAILABLE' && !error.message.includes('private-credential-marker'));
  } finally {
    axios.create = originalCreate;
    service?.resetTokenCacheForTests();
  }
});

test('Daraja refuses to make provider calls when credentials are missing', async () => {
  const service = await import('../services/darajaService.js');
  const previous = config.DARAJA_CONSUMER_SECRET;
  config.DARAJA_CONSUMER_SECRET = '';
  try {
    await assert.rejects(service.getAccessToken(), { code: 'PAYMENTS_UNAVAILABLE' });
  } finally {
    config.DARAJA_CONSUMER_SECRET = previous;
  }
});
