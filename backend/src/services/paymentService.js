import { randomBytes } from 'node:crypto';
import { AccessSession } from '../models/AccessSession.js';
import { Package } from '../models/Package.js';
import { Payment } from '../models/Payment.js';
import { config } from '../config/env.js';
import { createOrderId, createPublicToken, decryptSecret, encryptSecret, tokenHash } from '../utils/crypto.js';
import { addSeconds } from '../utils/time.js';
import { normalizeKenyanPhone } from '../utils/phone.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { writeAudit } from './auditService.js';
import { initiateStkPush, queryStkPush } from './darajaService.js';
import { activateHotspotUser, disconnectHotspotUser, expireHotspotUser, provisionHotspotUser } from './mikrotikService.js';
import { parseDarajaCallback } from './darajaCallback.js';

function publicPaymentResult(payment, publicToken, message = 'Payment request is already being processed.') {
  return {
    paymentToken: publicToken,
    orderId: payment.orderId,
    status: payment.status,
    package: payment.packageSnapshot,
    message
  };
}

export async function initiatePayment({ phone, packageId, idempotencyKey }) {
  const packageInfo = await Package.findOne({ _id: packageId, enabled: true }).lean();
  if (!packageInfo) throw new AppError(404, 'PACKAGE_NOT_FOUND', 'This package is not available.');
  const phoneNumber = normalizeKenyanPhone(phone);
  const existing = await Payment.findOne({ phoneNumber, idempotencyKey }).select('+encryptedPublicToken').lean();
  if (existing) return publicPaymentResult(existing, decryptSecret(existing.encryptedPublicToken));
  const publicToken = createPublicToken();
  const orderId = createOrderId();
  const payment = await Payment.create({
    orderId,
    publicTokenHash: tokenHash(publicToken),
    encryptedPublicToken: encryptSecret(publicToken),
    idempotencyKey,
    phoneNumber,
    packageId: packageInfo._id,
    packageSnapshot: {
      name: packageInfo.name,
      priceKes: packageInfo.priceKes,
      durationSeconds: packageInfo.durationSeconds,
      downloadMbps: packageInfo.downloadMbps,
      uploadMbps: packageInfo.uploadMbps,
      speedProfile: packageInfo.speedProfile
    },
    amountKes: packageInfo.priceKes,
    shortcode: config.DARAJA_SHORTCODE || 'UNCONFIGURED',
    status: 'PENDING'
  }).catch(async (error) => {
    if (error.code !== 11000) throw error;
    const duplicate = await Payment.findOne({ phoneNumber, idempotencyKey }).select('+encryptedPublicToken').lean();
    if (!duplicate) throw error;
    return duplicate;
  });
  if (payment.orderId !== orderId) {
    return publicPaymentResult(payment, decryptSecret(payment.encryptedPublicToken));
  }

  try {
    const request = await initiateStkPush({ phoneNumber, amountKes: packageInfo.priceKes, orderId });
    await Payment.updateOne({ _id: payment._id, status: 'PENDING' }, {
      $set: { checkoutRequestId: request.checkoutRequestId, merchantRequestId: request.merchantRequestId }
    });
    return {
      paymentToken: publicToken,
      orderId,
      status: 'PENDING',
      package: {
        name: packageInfo.name,
        priceKes: packageInfo.priceKes,
        durationSeconds: packageInfo.durationSeconds,
        downloadMbps: packageInfo.downloadMbps,
        uploadMbps: packageInfo.uploadMbps
      },
      message: request.customerMessage
    };
  } catch (error) {
    const outcomeUnknown = error.code === 'DARAJA_STK_OUTCOME_UNKNOWN';
    await Payment.updateOne({ _id: payment._id, status: 'PENDING' }, {
      $set: {
        status: outcomeUnknown ? 'REVIEW_REQUIRED' : 'FAILED',
        failureCode: error.code || 'PROVIDER_ERROR',
        failureMessage: outcomeUnknown
          ? 'Payment request outcome is being checked. Do not submit another payment yet.'
          : 'Payment request could not be started.'
      }
    });
    if (outcomeUnknown) {
      const current = await Payment.findById(payment._id).select('+encryptedPublicToken').lean();
      return publicPaymentResult(current, publicToken, current.failureMessage);
    }
    throw error;
  }
}

export async function getPaymentStatus(publicToken) {
  if (!/^[\w-]{40,50}$/.test(publicToken)) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
  const payment = await Payment.findOne({ publicTokenHash: tokenHash(publicToken) }).lean();
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
  const access = await AccessSession.findOne({ paymentId: payment._id }).select('+encryptedPassword').lean();
  const now = new Date();
  const expired = Boolean(access && (access.routerState === 'EXPIRED' || access.expiresAt <= now));
  const scheduled = Boolean(access && !expired && access.startsAt > now);
  const accessReady = Boolean(access && !expired && !scheduled && access.routerState === 'ACTIVE');
  const activeAccess = await AccessSession.exists({
    phoneNumber: payment.phoneNumber,
    routerState: 'ACTIVE',
    startsAt: { $lte: now },
    expiresAt: { $gt: now }
  });
  return {
    orderId: payment.orderId,
    status: payment.status,
    activationState: payment.activationState,
    package: payment.packageSnapshot,
    receiptNumber: payment.receiptNumber || null,
    transactionReference: payment.receiptNumber || payment.checkoutRequestId || payment.orderId,
    failureMessage: payment.failureMessage || null,
    access: access ? {
      status: expired ? 'EXPIRED' : scheduled ? 'SCHEDULED' : access.routerState,
      startsAt: access.startsAt,
      expiresAt: access.expiresAt,
      remainingSeconds: expired ? 0 : scheduled
        ? access.durationSeconds
        : Math.max(0, Math.ceil((access.expiresAt - now) / 1000)),
      startsInSeconds: scheduled ? Math.max(0, Math.ceil((access.startsAt - now) / 1000)) : 0,
      logoutAvailable: Boolean(activeAccess),
      lastLogoutAt: access.lastLogoutAt || null,
      ...(accessReady ? { username: access.username, password: decryptSecret(access.encryptedPassword) } : {})
    } : null
  };
}

export async function logoutAccess(publicToken) {
  if (!/^[\w-]{40,50}$/.test(publicToken)) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
  const payment = await Payment.findOne({ publicTokenHash: tokenHash(publicToken) }).lean();
  if (!payment || payment.status !== 'SUCCESS') throw new AppError(404, 'ACCESS_NOT_FOUND', 'Active paid access was not found.');
  const now = new Date();
  const accesses = await AccessSession.find({
    phoneNumber: payment.phoneNumber,
    routerState: 'ACTIVE',
    startsAt: { $lte: now },
    expiresAt: { $gt: now }
  });
  if (!accesses.length) {
    throw new AppError(409, 'ACCESS_NOT_ACTIVE', 'There is no active hotspot session to log out.');
  }
  if (!config.mikrotikEnabled) throw new AppError(503, 'ROUTER_DISABLED', 'Router access is not enabled.');
  try {
    for (const access of accesses) await disconnectHotspotUser(access.username);
  } catch {
    throw new AppError(503, 'ROUTER_LOGOUT_FAILED', 'The hotspot session could not be disconnected. Please try again.');
  }
  const loggedOutAt = new Date();
  await AccessSession.updateMany({ _id: { $in: accesses.map((access) => access._id) } }, { $set: { lastLogoutAt: loggedOutAt } });
  return { disconnected: true, disconnectedSessions: accesses.length, loggedOutAt };
}

export async function receiveDarajaCallback(body) {
  const callback = parseDarajaCallback(body);
  if (!callback) {
    logger.warn({ event: 'invalid_daraja_callback' }, 'Received malformed Daraja callback');
    return;
  }
  const payment = await Payment.findOne({ checkoutRequestId: callback.checkoutRequestId });
  if (!payment || !['PENDING', 'EXPIRED'].includes(payment.status)) {
    logger.warn({ checkoutRequestId: callback.checkoutRequestId }, 'Unknown or already resolved Daraja callback');
    return;
  }
  const updates = {
    'callback.merchantRequestId': callback.merchantRequestId,
    'callback.resultCode': callback.resultCode,
    'callback.resultDescription': callback.resultDescription,
    'callback.receivedAt': new Date()
  };
  if (callback.amountKes !== undefined) updates['callback.amountKes'] = callback.amountKes;
  if (callback.phoneNumber) updates['callback.phoneNumber'] = callback.phoneNumber;
  if (callback.receiptNumber) updates['callback.receiptNumber'] = callback.receiptNumber;
  const update = { $set: updates };
  if (payment.status === 'EXPIRED') update.$set.status = 'PENDING';
  await Payment.updateOne(
    { _id: payment._id, status: payment.status, 'callback.receivedAt': { $exists: false } },
    update
  );
}

async function reviewPayment(payment, reason) {
  await Payment.updateOne({ _id: payment._id, status: { $in: ['PENDING', 'REVIEW_REQUIRED'] } }, {
    $set: { status: 'REVIEW_REQUIRED', failureCode: 'VERIFICATION_MISMATCH', failureMessage: reason }
  });
  await writeAudit({ actor: 'system', action: 'payment.review_required', targetType: 'payment', targetId: payment.orderId, details: { reason } });
}

async function createAccessForPayment(payment) {
  const existing = await AccessSession.findOne({ paymentId: payment._id }).select('+encryptedPassword');
  if (existing) return existing;
  const now = new Date();
  const currentAccess = await AccessSession.findOne({
    phoneNumber: payment.phoneNumber,
    routerState: { $in: ['ACTIVE', 'PENDING', 'FAILED'] },
    expiresAt: { $gt: now }
  }).sort({ expiresAt: -1 });
  const startsAt = currentAccess?.expiresAt > now ? currentAccess.expiresAt : now;
  const expiresAt = addSeconds(startsAt, payment.packageSnapshot.durationSeconds);
  const username = `mz${payment.orderId.replaceAll('-', '').slice(0, 18)}`;
  const password = randomBytes(18).toString('base64url');
  try {
    const access = await AccessSession.create({
      paymentId: payment._id,
      phoneNumber: payment.phoneNumber,
      username,
      encryptedPassword: encryptSecret(password),
      startsAt,
      expiresAt,
      durationSeconds: payment.packageSnapshot.durationSeconds,
      routerState: 'PENDING'
    });
    await Payment.updateOne({ _id: payment._id }, { $set: { activationState: 'PENDING' } });
    return access;
  } catch (error) {
    if (error.code === 11000) return AccessSession.findOne({ paymentId: payment._id });
    throw error;
  }
}

async function processActivation(payment) {
  const claim = await Payment.updateOne({
    _id: payment._id,
    status: 'SUCCESS',
    activationState: { $ne: 'ACTIVE' },
    $or: [
      { activationClaimAt: { $exists: false } },
      { activationClaimAt: { $lt: new Date(Date.now() - 120000) } }
    ]
  }, { $set: { activationClaimAt: new Date() } });
  if (!claim.modifiedCount) return;
  const access = await createAccessForPayment(payment);
  if (access.expiresAt <= new Date()) {
    try {
      if (config.mikrotikEnabled) await expireHotspotUser(access.username);
      await AccessSession.updateOne({ _id: access._id }, {
        $set: { routerState: 'EXPIRED', disconnectedAt: new Date(), routerError: 'The purchased access period ended before provisioning completed.' }
      });
      await Payment.updateOne({ _id: payment._id }, { $set: { activationState: 'EXPIRED' } });
    } catch (error) {
      logger.error({ orderId: payment.orderId }, 'Expired paid access cleanup failed');
    }
    return;
  }
  if (!config.mikrotikEnabled) {
    await AccessSession.updateOne({ _id: access._id }, {
      $set: { routerState: 'FAILED', routerError: 'Router integration is disabled; administrator setup is required.' }
    });
    await Payment.updateOne({ _id: payment._id }, { $set: { activationState: 'FAILED' } });
    return;
  }
  try {
    const password = decryptSecret(access.encryptedPassword);
    const routerUserId = await provisionHotspotUser({
      username: access.username,
      password,
      durationSeconds: Math.max(60, Math.ceil((access.expiresAt - new Date()) / 1000)),
      speedProfile: payment.packageSnapshot.speedProfile,
      downloadMbps: payment.packageSnapshot.downloadMbps,
      uploadMbps: payment.packageSnapshot.uploadMbps
    });
    const scheduled = access.startsAt > new Date();
    if (!scheduled) await activateHotspotUser(access.username);
    await AccessSession.updateOne({ _id: access._id }, {
      $set: {
        routerState: scheduled ? 'PENDING' : 'ACTIVE',
        routerError: '',
        routerSyncedAt: new Date(),
        routerUserId: routerUserId || ''
      }
    });
    await Payment.updateOne({ _id: payment._id }, { $set: { activationState: 'ACTIVE' } });
  } catch (error) {
    const routerErrorCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(error.code)
      ? error.code
      : 'ROUTER_OPERATION_FAILED';
    logger.error({ orderId: payment.orderId, routerErrorCode }, 'Paid access provisioning failed');
    await AccessSession.updateOne({ _id: access._id }, {
      $set: { routerState: 'FAILED', routerError: `Router provisioning failed (${routerErrorCode}); retry scheduled.` }
    });
    await Payment.updateOne({ _id: payment._id }, { $set: { activationState: 'FAILED' } });
  }
}

async function verifyCallback(payment) {
  const callback = payment.callback;
  if (callback.merchantRequestId !== payment.merchantRequestId) {
    await reviewPayment(payment, 'Callback merchant request reference did not match the order.');
    return;
  }
  let query;
  try {
    query = await queryStkPush(payment.checkoutRequestId);
  } catch {
    logger.warn({ orderId: payment.orderId }, 'Provider verification deferred');
    return;
  }
  if (query?.CheckoutRequestID !== payment.checkoutRequestId) {
    await reviewPayment(payment, 'Provider status query did not match the payment reference.');
    return;
  }
  if (callback.resultCode !== 0) {
    if (String(query?.ResultCode) !== String(callback.resultCode)) {
      await reviewPayment(payment, 'Callback and provider status query results did not match.');
      return;
    }
    const status = callback.resultCode === 1032 ? 'CANCELLED' : 'FAILED';
    await Payment.updateOne({ _id: payment._id, status: { $in: ['PENDING', 'REVIEW_REQUIRED'] } }, {
      $set: {
        status,
        failureCode: `DARAJA_${callback.resultCode}`,
        failureMessage: callback.resultDescription || 'Payment was not completed.'
      }
    });
    return;
  }
  if (String(query?.ResultCode) !== '0') {
    if (query?.ResultCode !== undefined) await reviewPayment(payment, 'Provider query did not confirm the successful callback.');
    return;
  }
  if (callback.amountKes !== payment.amountKes || !callback.phoneNumber ||
      callback.phoneNumber !== payment.phoneNumber || !callback.receiptNumber) {
    await reviewPayment(payment, 'Callback amount, phone number, or receipt did not match the order.');
    return;
  }
  if (query?.ResultCode === '0') {
    const result = await Payment.updateOne({ _id: payment._id, status: { $in: ['PENDING', 'REVIEW_REQUIRED'] } }, {
      $set: {
        status: 'SUCCESS',
        receiptNumber: callback.receiptNumber,
        completedAt: new Date(),
        activationState: 'PENDING'
      }
    });
    if (result.modifiedCount) {
      await writeAudit({ actor: 'daraja', action: 'payment.verified_success', targetType: 'payment', targetId: payment.orderId });
      await processActivation(payment);
    }
    return;
  }
}

export async function runReconciliation() {
  const pendingCallbacks = await Payment.find({
    status: 'PENDING',
    'callback.receivedAt': { $exists: true },
    $or: [
      { 'callback.verificationClaimAt': { $exists: false } },
      { 'callback.verificationClaimAt': { $lt: new Date(Date.now() - 120000) } }
    ]
  }).limit(50);
  for (const payment of pendingCallbacks) {
    const claimed = await Payment.updateOne(
      { _id: payment._id, status: 'PENDING', 'callback.receivedAt': payment.callback.receivedAt },
      { $set: { 'callback.verificationClaimAt': new Date() } }
    );
    if (claimed.modifiedCount) await verifyCallback(payment);
  }

  const successful = await Payment.find({ status: 'SUCCESS', activationState: { $nin: ['ACTIVE', 'EXPIRED'] } }).limit(50);
  for (const payment of successful) await processActivation(payment);

  await Payment.updateMany({
    status: 'PENDING',
    createdAt: { $lt: new Date(Date.now() - 30 * 60_000) },
    'callback.receivedAt': { $exists: false }
  }, {
    $set: { status: 'EXPIRED', failureCode: 'PAYMENT_TIMEOUT', failureMessage: 'No provider confirmation was received before the payment request timed out.' }
  });

  const waiting = await AccessSession.find({ routerState: 'PENDING', startsAt: { $lte: new Date() }, expiresAt: { $gt: new Date() } }).limit(50);
  for (const access of waiting) {
    try {
      await activateHotspotUser(access.username);
      await AccessSession.updateOne({ _id: access._id, routerState: 'PENDING' }, {
        $set: { routerState: 'ACTIVE', routerSyncedAt: new Date(), routerError: '' }
      });
    }
    catch { logger.warn({ username: access.username }, 'Scheduled access activation failed'); }
  }

  const expired = await AccessSession.find({ routerState: { $in: ['ACTIVE', 'PENDING', 'FAILED'] }, expiresAt: { $lte: new Date() } }).limit(50);
  for (const access of expired) {
    try {
      if (config.mikrotikEnabled) await expireHotspotUser(access.username);
      await AccessSession.updateOne({ _id: access._id, routerState: { $in: ['ACTIVE', 'PENDING'] } }, {
        $set: { routerState: 'EXPIRED', disconnectedAt: new Date() }
      });
    } catch (error) {
      logger.error({ username: access.username }, 'Access expiry enforcement failed');
    }
  }
}

export async function reconcilePaymentByAdmin(paymentId, actor, requestId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
  if (payment.status !== 'REVIEW_REQUIRED' && payment.status !== 'PENDING') {
    throw new AppError(409, 'PAYMENT_NOT_RECONCILABLE', 'This payment is not awaiting reconciliation.');
  }
  await writeAudit({ actor, action: 'payment.reconciliation_requested', targetType: 'payment', targetId: payment.orderId, requestId });
  if (!payment.checkoutRequestId) throw new AppError(409, 'PAYMENT_REFERENCE_MISSING', 'Provider reference is not available for reconciliation.');
  const result = await queryStkPush(payment.checkoutRequestId);
  if (String(result?.ResultCode) !== '0' || result?.CheckoutRequestID !== payment.checkoutRequestId ||
      payment.callback?.resultCode !== 0 || payment.callback?.amountKes !== payment.amountKes ||
      payment.callback?.phoneNumber !== payment.phoneNumber || !payment.callback?.receiptNumber ||
      payment.callback?.merchantRequestId !== payment.merchantRequestId) {
    return { status: payment.status, providerResultCode: String(result?.ResultCode ?? 'unknown') };
  }
  const updated = await Payment.updateOne({ _id: payment._id, status: { $in: ['REVIEW_REQUIRED', 'PENDING'] } }, {
    $set: { status: 'SUCCESS', receiptNumber: payment.callback.receiptNumber, completedAt: new Date(), activationState: 'PENDING' }
  });
  if (!updated.modifiedCount) throw new AppError(409, 'PAYMENT_STATE_CHANGED', 'Payment state changed during reconciliation.');
  await writeAudit({ actor, action: 'payment.reconciled_success', targetType: 'payment', targetId: payment.orderId, requestId });
  await processActivation(payment);
  return { status: 'SUCCESS' };
}
