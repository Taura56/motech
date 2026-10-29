import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { Package } from '../models/Package.js';
import { initiatePayment, getPaymentStatus, logoutAccess, receiveDarajaCallback } from '../services/paymentService.js';
import { asyncHandler } from '../utils/errors.js';
import { AppError } from '../utils/errors.js';
import { normalizeKenyanPhone } from '../utils/phone.js';

export const publicRoutes = Router();

const initiateSchema = z.object({
  phone: z.string().min(8).max(20),
  packageId: z.string().regex(/^[a-f\d]{24}$/i),
  idempotencyKey: z.string().uuid()
});
const initiateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator(req) {
    let phone = '';
    try { phone = normalizeKenyanPhone(String(req.body?.phone || '')); } catch { phone = 'invalid'; }
    return crypto.createHash('sha256').update(phone || `invalid:${req.ip}`).digest('hex');
  },
  message: { error: { code: 'PAYMENT_RATE_LIMITED', message: 'Too many payment requests. Please wait before trying again.' } }
});
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 45,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator(req) {
    const token = req.get('x-payment-token') || '';
    return crypto.createHash('sha256').update(token || req.ip).digest('hex');
  },
  message: { error: { code: 'STATUS_RATE_LIMITED', message: 'Too many status checks. Please wait and try again.' } }
});
const logoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator(req) {
    const token = req.get('x-payment-token') || '';
    return crypto.createHash('sha256').update(token || req.ip).digest('hex');
  },
  message: { error: { code: 'LOGOUT_RATE_LIMITED', message: 'Too many logout requests. Please wait and try again.' } }
});

publicRoutes.get('/packages', asyncHandler(async (_req, res) => {
  const packages = await Package.find({ enabled: true })
    .sort({ sortOrder: 1, priceKes: 1 })
    .select('name slug description priceKes durationSeconds downloadMbps uploadMbps speedProfile')
    .lean();
  res.json({ packages });
}));

publicRoutes.post('/payments/initiate', initiateLimiter, asyncHandler(async (req, res) => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'INVALID_REQUEST', 'Provide a valid package and Kenyan phone number.');
  res.status(201).json(await initiatePayment(parsed.data));
}));

publicRoutes.get('/payments/status', statusLimiter, asyncHandler(async (req, res) => {
  const token = req.get('x-payment-token');
  if (!token) throw new AppError(400, 'PAYMENT_TOKEN_REQUIRED', 'Payment status token is required.');
  res.json(await getPaymentStatus(token));
}));

publicRoutes.get('/access/status', statusLimiter, asyncHandler(async (req, res) => {
  const token = req.get('x-payment-token');
  if (!token) throw new AppError(400, 'PAYMENT_TOKEN_REQUIRED', 'Access status token is required.');
  const status = await getPaymentStatus(token);
  res.json({ orderId: status.orderId, paymentStatus: status.status, access: status.access });
}));

publicRoutes.post('/access/logout', logoutLimiter, asyncHandler(async (req, res) => {
  const token = req.get('x-payment-token');
  if (!token) throw new AppError(400, 'PAYMENT_TOKEN_REQUIRED', 'Payment status token is required.');
  res.json(await logoutAccess(token));
}));

publicRoutes.post('/payments/daraja/callback', asyncHandler(async (req, res) => {
  await receiveDarajaCallback(req.body);
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));
