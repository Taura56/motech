import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDarajaCallback } from '../services/darajaCallback.js';

const successfulCallback = {
  Body: {
    stkCallback: {
      MerchantRequestID: 'merchant-1',
      CheckoutRequestID: 'checkout-1',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 50 },
          { Name: 'MpesaReceiptNumber', Value: 'RCP123456' },
          { Name: 'PhoneNumber', Value: 254712345678 }
        ]
      }
    }
  }
};

test('parses the documented Daraja STK callback fields and normalizes phone', () => {
  assert.deepEqual(parseDarajaCallback(successfulCallback), {
    checkoutRequestId: 'checkout-1',
    merchantRequestId: 'merchant-1',
    resultCode: 0,
    resultDescription: 'The service request is processed successfully.',
    amountKes: 50,
    phoneNumber: '254712345678',
    receiptNumber: 'RCP123456'
  });
});

test('rejects malformed or incomplete callback envelopes', () => {
  assert.equal(parseDarajaCallback({}), null);
  assert.equal(parseDarajaCallback({ Body: { stkCallback: { CheckoutRequestID: 'x', MerchantRequestID: 'm', ResultCode: 'not-a-code' } } }), null);
  assert.equal(parseDarajaCallback({ Body: { stkCallback: { CheckoutRequestID: 'x', MerchantRequestID: 'm', ResultCode: null, ResultDesc: 'ok' } } }), null);
  assert.equal(parseDarajaCallback({ Body: { stkCallback: { CheckoutRequestID: 'x'.repeat(129), MerchantRequestID: 'm', ResultCode: 0, ResultDesc: 'ok' } } }), null);
  assert.equal(parseDarajaCallback({ Body: { stkCallback: { CheckoutRequestID: 'x', MerchantRequestID: 'm', ResultCode: 0 } } }), null);
});

test('does not trust unsupported phone metadata and tolerates malformed metadata lists', () => {
  const parsed = parseDarajaCallback({
    Body: { stkCallback: {
      MerchantRequestID: 'merchant-1', CheckoutRequestID: 'checkout-1',
      ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: {} }
    } }
  });
  assert.equal(parsed.phoneNumber, '');
  assert.equal(parsed.amountKes, undefined);
  assert.equal(parsed.receiptNumber, '');
});

test('callback metadata from an unsupported phone is empty rather than normalized incorrectly', () => {
  const parsed = parseDarajaCallback({
    Body: { stkCallback: {
      MerchantRequestID: 'merchant-1', CheckoutRequestID: 'checkout-1',
      ResultCode: 0, ResultDesc: 'ok',
      CallbackMetadata: { Item: [{ Name: 'PhoneNumber', Value: 12345678 }] }
    } }
  });
  assert.equal(parsed.phoneNumber, '');
});
