import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import axios from 'axios';
import mongoose from 'mongoose';
import session from 'express-session';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from '../config/env.js';
import { AccessSession } from '../models/AccessSession.js';
import { AuditLog } from '../models/AuditLog.js';
import { Package } from '../models/Package.js';
import { Payment } from '../models/Payment.js';
import { decryptSecret } from '../utils/crypto.js';

let mongo;
let app;
let initiatePayment;
let getPaymentStatus;
let receiveDarajaCallback;
let runReconciliation;
let logoutAccess;
let packageId;
let checkoutSequence = 0;
let nextQueryFailure = false;
let nextStkFailure = false;
let routerFailure = false;
const providerResults = new Map();
const routerUsers = [];
const routerActiveSessions = [];
const originalCreate = axios.create;

const originalConfig = {};
const configKeys = [
  'DARAJA_CONSUMER_KEY', 'DARAJA_CONSUMER_SECRET', 'DARAJA_SHORTCODE', 'DARAJA_PASSKEY',
  'DARAJA_CALLBACK_URL', 'MIKROTIK_HOST', 'MIKROTIK_REST_PORT', 'MIKROTIK_USERNAME',
  'MIKROTIK_PASSWORD', 'MIKROTIK_CONNECT_TIMEOUT_MS', 'MIKROTIK_DEFAULT_PROFILE'
];

function routerClient() {
  return {
    async get(path, options = {}) {
      if (routerFailure) throw new Error('router failure with private-password-marker');
      if (path === '/ip/hotspot/active') {
        return { data: routerActiveSessions.filter((item) => item.user === options.params.user) };
      }
      return { data: routerUsers.filter((item) => !options.params?.name || item.name === options.params.name) };
    },
    async put(_path, body) {
      if (routerFailure) throw new Error('router failure with private-password-marker');
      const user = { '.id': `*user${routerUsers.length + 1}`, ...body };
      routerUsers.push(user);
      return { data: { '.id': user['.id'] } };
    },
    async patch(path, body) {
      if (routerFailure) throw new Error('router failure with private-password-marker');
      const id = decodeURIComponent(path.split('/').at(-1));
      const user = routerUsers.find((item) => item['.id'] === id);
      if (user) Object.assign(user, body);
      return { data: {} };
    },
    async delete(path) {
      if (routerFailure) throw new Error('router failure with private-password-marker');
      const id = decodeURIComponent(path.split('/').at(-1));
      const collection = path.startsWith('/ip/hotspot/active/') ? routerActiveSessions : routerUsers;
      const index = collection.findIndex((item) => item['.id'] === id);
      if (index >= 0) collection.splice(index, 1);
      return { data: {} };
    }
  };
}

function callbackBody(checkoutRequestId, merchantRequestId, resultCode, phone = '254712345678') {
  const body = {
    Body: {
      stkCallback: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? 'Payment completed.' : 'Request cancelled by user.'
      }
    }
  };
  if (resultCode === 0) {
    body.Body.stkCallback.CallbackMetadata = {
      Item: [
        { Name: 'Amount', Value: 50 },
        { Name: 'MpesaReceiptNumber', Value: `RCP${checkoutRequestId}` },
        { Name: 'PhoneNumber', Value: phone }
      ]
    };
  }
  return body;
}

async function createServicePayment(idempotencyKey = crypto.randomUUID()) {
  return initiatePayment({
    phone: '0712 345 678',
    packageId: packageId.toString(),
    idempotencyKey
  });
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([AccessSession.init(), AuditLog.init(), Package.init(), Payment.init()]);
  const packageInfo = await Package.create({
    name: 'Isolated test package',
    slug: 'isolated-test-package',
    description: 'Temporary test data only',
    priceKes: 50,
    durationSeconds: 3600,
    downloadMbps: 20,
    uploadMbps: 5,
    enabled: true
  });
  packageId = packageInfo._id;

  for (const key of configKeys) originalConfig[key] = config[key];
  Object.assign(config, {
    DARAJA_CONSUMER_KEY: 'test-consumer-key',
    DARAJA_CONSUMER_SECRET: 'test-consumer-secret',
    DARAJA_SHORTCODE: '174379',
    DARAJA_PASSKEY: 'test-passkey',
    DARAJA_CALLBACK_URL: 'https://backend.test.invalid/api/payments/daraja/callback',
    mikrotikEnabled: true,
    MIKROTIK_HOST: '192.0.2.1',
    MIKROTIK_REST_PORT: 443,
    MIKROTIK_USERNAME: 'restricted-test-user',
    MIKROTIK_PASSWORD: 'test-router-password',
    MIKROTIK_CONNECT_TIMEOUT_MS: 5000,
    MIKROTIK_DEFAULT_PROFILE: 'default'
  });

  axios.create = (options = {}) => {
    if (options.baseURL?.includes('/rest')) return routerClient();
    return {
      async get(url) {
        assert.ok(url.includes('/oauth/v1/generate'));
        return { data: { access_token: 'mock-access-token', expires_in: '3600' } };
      },
      async post(url, body) {
        if (url.includes('/processrequest')) {
          if (nextStkFailure) {
            nextStkFailure = false;
            throw new Error('transport failed');
          }
          checkoutSequence += 1;
          const checkoutRequestId = `checkout-${checkoutSequence}`;
          const merchantRequestId = `merchant-${checkoutSequence}`;
          providerResults.set(checkoutRequestId, { ResultCode: '0', CheckoutRequestID: checkoutRequestId });
          return {
            data: {
              ResponseCode: '0',
              CheckoutRequestID: checkoutRequestId,
              MerchantRequestID: merchantRequestId,
              CustomerMessage: 'Check the phone.'
            }
          };
        }
        assert.ok(url.includes('/query'));
        if (nextQueryFailure) {
          nextQueryFailure = false;
          throw new Error('temporary provider failure');
        }
        return { data: providerResults.get(body.CheckoutRequestID) };
      }
    };
  };

  const paymentService = await import('../services/paymentService.js');
  ({ initiatePayment, getPaymentStatus, receiveDarajaCallback, runReconciliation, logoutAccess } = paymentService);
  const { createApp } = await import('../app.js');
  app = createApp({ sessionStore: new session.MemoryStore() });
});

after(async () => {
  axios.create = originalCreate;
  for (const [key, value] of Object.entries(originalConfig)) config[key] = value;
  await mongoose.disconnect();
  await mongo.stop();
});

test('checkout, verified payment, access limits, logout, repurchase, retry, and expiry recover from persisted state', async () => {
  const publicPackages = await request(app).get('/api/packages');
  assert.equal(publicPackages.status, 200);
  assert.equal(publicPackages.body.packages[0].downloadMbps, 20);
  assert.equal(publicPackages.body.packages[0].uploadMbps, 5);

  const callbackUrl = config.DARAJA_CALLBACK_URL;
  config.DARAJA_CALLBACK_URL = '';
  try {
    const blockedCheckout = await request(app)
      .post('/api/payments/initiate')
      .send({ phone: '0712345679', packageId: packageId.toString(), idempotencyKey: crypto.randomUUID() });
    assert.equal(blockedCheckout.status, 503);
    assert.equal(blockedCheckout.body.error.code, 'CALLBACK_NOT_CONFIGURED');
    assert.match(blockedCheckout.body.error.message, /public HTTPS M-Pesa callback URL/);
  } finally {
    config.DARAJA_CALLBACK_URL = callbackUrl;
  }

  const idempotencyKey = crypto.randomUUID();
  const checkout = await request(app)
    .post('/api/payments/initiate')
    .send({ phone: '0712 345 678', packageId: packageId.toString(), idempotencyKey });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.status, 'PENDING');
  const paymentToken = checkout.body.paymentToken;
  const order = await Payment.findOne({ orderId: checkout.body.orderId });
  assert.equal(order.amountKes, 50);
  assert.equal(order.packageSnapshot.downloadMbps, 20);
  assert.equal(order.packageSnapshot.uploadMbps, 5);
  const duplicate = await createServicePayment(idempotencyKey);
  assert.equal(duplicate.orderId, checkout.body.orderId);

  const callback = callbackBody(order.checkoutRequestId, order.merchantRequestId, 0);
  const callbackResponse = await request(app).post('/api/payments/daraja/callback').send(callback);
  assert.equal(callbackResponse.status, 200);
  await runReconciliation();

  let verified = await Payment.findById(order._id);
  assert.equal(verified.status, 'SUCCESS');
  assert.equal(verified.activationState, 'ACTIVE');
  let access = await AccessSession.findOne({ paymentId: order._id }).select('+encryptedPassword');
  assert.equal(access.routerState, 'ACTIVE');
  assert.ok(access.routerUserId);
  assert.notEqual(access.encryptedPassword, decryptSecret(access.encryptedPassword));
  const createdRouterUser = routerUsers.find((user) => user.name === access.username);
  assert.equal(createdRouterUser['limit-uptime'], '1h0s');
  assert.equal(createdRouterUser['rate-limit'], '5M/20M');

  let status = await getPaymentStatus(paymentToken);
  assert.equal(status.transactionReference, `RCP${order.checkoutRequestId}`);
  assert.equal(status.access.status, 'ACTIVE');
  assert.equal(status.access.username, access.username);
  assert.ok(status.access.password);
  assert.ok(status.access.remainingSeconds > 0);

  await receiveDarajaCallback(callbackBody(order.checkoutRequestId, order.merchantRequestId, 1032));
  await runReconciliation();
  assert.equal(await AccessSession.countDocuments({ paymentId: order._id }), 1);
  const duplicateCallbackPayment = await Payment.findById(order._id);
  assert.equal(duplicateCallbackPayment.callback.resultCode, 0);
  assert.equal(duplicateCallbackPayment.callback.receiptNumber, `RCP${order.checkoutRequestId}`);
  assert.equal(routerUsers.filter((user) => user.name === access.username).length, 1);

  routerActiveSessions.push({ '.id': '*session1', user: access.username });
  const logout = await request(app)
    .post('/api/access/logout')
    .set('X-Payment-Token', paymentToken);
  assert.equal(logout.status, 200);
  assert.equal(logout.body.disconnected, true);
  assert.equal(routerActiveSessions.length, 0);
  access = await AccessSession.findById(access._id);
  assert.ok(access.lastLogoutAt);

  const repurchase = await createServicePayment();
  const repurchaseDoc = await Payment.findOne({ orderId: repurchase.orderId });
  await receiveDarajaCallback(callbackBody(repurchaseDoc.checkoutRequestId, repurchaseDoc.merchantRequestId, 0));
  await runReconciliation();
  let queued = await AccessSession.findOne({ paymentId: repurchaseDoc._id });
  assert.equal(queued.routerState, 'PENDING');
  assert.ok(queued.startsAt > new Date());
  assert.equal(routerUsers.find((user) => user.name === queued.username).disabled, 'true');
  assert.equal((await getPaymentStatus(repurchase.paymentToken)).access.status, 'SCHEDULED');

  await AccessSession.updateOne({ _id: queued._id }, { $set: { startsAt: new Date(Date.now() - 1000) } });
  await runReconciliation();
  queued = await AccessSession.findById(queued._id);
  assert.equal(queued.routerState, 'ACTIVE');
  assert.equal(routerUsers.find((user) => user.name === queued.username).disabled, 'false');

  routerFailure = true;
  const retryOrder = await createServicePayment();
  const retryPayment = await Payment.findOne({ orderId: retryOrder.orderId });
  await receiveDarajaCallback(callbackBody(retryPayment.checkoutRequestId, retryPayment.merchantRequestId, 0));
  await runReconciliation();
  let retryAccess = await AccessSession.findOne({ paymentId: retryPayment._id });
  assert.equal(retryAccess.routerState, 'FAILED');
  assert.equal((await getPaymentStatus(retryOrder.paymentToken)).access.password, undefined);
  const retryStateAfterFailure = await Payment.findById(retryPayment._id);
  assert.equal(retryStateAfterFailure.status, 'SUCCESS');
  assert.equal(retryStateAfterFailure.activationState, 'FAILED');
  routerFailure = false;
  const staleClaimAt = new Date(Date.now() - 180000);
  const claimUpdate = await Payment.updateOne({ _id: retryPayment._id }, { $set: { activationClaimAt: staleClaimAt } });
  assert.equal(claimUpdate.modifiedCount, 1);
  assert.ok((await Payment.findById(retryPayment._id)).activationClaimAt < new Date(Date.now() - 120000));
  assert.equal(await Payment.countDocuments({ _id: retryPayment._id, status: 'SUCCESS', activationState: { $nin: ['ACTIVE', 'EXPIRED'] } }), 1);
  await runReconciliation();
  retryAccess = await AccessSession.findById(retryAccess._id);
  const retriedPayment = await Payment.findById(retryPayment._id);
  assert.equal(retryAccess.routerState, 'PENDING');
  assert.equal(retriedPayment.activationState, 'ACTIVE');
  const retriedRouterUser = routerUsers.find((user) => user.name === retryAccess.username);
  assert.ok(retriedRouterUser);
  assert.equal(retriedRouterUser.disabled, 'true');

  const delayedOrder = await createServicePayment();
  const delayedPayment = await Payment.findOne({ orderId: delayedOrder.orderId });
  await receiveDarajaCallback(callbackBody(delayedPayment.checkoutRequestId, delayedPayment.merchantRequestId, 0));
  nextQueryFailure = true;
  await runReconciliation();
  assert.equal((await Payment.findById(delayedPayment._id)).status, 'PENDING');
  await Payment.updateOne({ _id: delayedPayment._id }, { $set: { 'callback.verificationClaimAt': new Date(Date.now() - 180000) } });
  await runReconciliation();
  assert.equal((await Payment.findById(delayedPayment._id)).status, 'SUCCESS');

  const cancelledOrder = await createServicePayment();
  const cancelledPayment = await Payment.findOne({ orderId: cancelledOrder.orderId });
  providerResults.set(cancelledPayment.checkoutRequestId, {
    ResultCode: '1032',
    CheckoutRequestID: cancelledPayment.checkoutRequestId
  });
  await receiveDarajaCallback(callbackBody(cancelledPayment.checkoutRequestId, cancelledPayment.merchantRequestId, 1032));
  await runReconciliation();
  assert.equal((await Payment.findById(cancelledPayment._id)).status, 'CANCELLED');
  assert.equal(await AccessSession.countDocuments({ paymentId: cancelledPayment._id }), 0);

  await AccessSession.updateOne({ _id: access._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await mongoose.disconnect();
  await mongoose.connect(mongo.getUri());
  await runReconciliation();
  const expiredAccess = await AccessSession.findById(access._id);
  assert.equal(expiredAccess.routerState, 'EXPIRED');
  assert.equal(routerUsers.some((user) => user.name === expiredAccess.username), false);
  assert.equal((await getPaymentStatus(paymentToken)).access.status, 'EXPIRED');

  nextStkFailure = true;
  const unknownOutcome = await createServicePayment();
  assert.equal(unknownOutcome.status, 'REVIEW_REQUIRED');
  assert.match(unknownOutcome.message, /Do not submit another payment/);
  assert.equal((await Payment.findOne({ orderId: unknownOutcome.orderId })).status, 'REVIEW_REQUIRED');
});
