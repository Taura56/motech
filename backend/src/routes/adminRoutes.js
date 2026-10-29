import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Admin } from '../models/Admin.js';
import { Package } from '../models/Package.js';
import { Payment } from '../models/Payment.js';
import { AccessSession } from '../models/AccessSession.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireAdmin, requireAdministrator, requireAdminWriteHeader } from '../middleware/adminAuth.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { writeAudit } from '../services/auditService.js';
import {
  createAdministrator,
  listAdministrators,
  resetAdministratorPassword,
  setAdministratorStatus,
  updateAdministrator
} from '../services/adminManagementService.js';
import { reconcilePaymentByAdmin } from '../services/paymentService.js';
import { routerHealth } from '../services/mikrotikApiService.js';
import { disconnectHotspotUser } from '../services/mikrotikService.js';
import { rateLimit } from 'express-rate-limit';

export const adminRoutes = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many login attempts. Try again later.' } }
});
const packageSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(64),
  description: z.string().trim().max(240).optional().default(''),
  priceKes: z.number().int().positive(),
  durationSeconds: z.number().int().min(60),
  downloadMbps: z.number().int().positive().max(1000).optional(),
  uploadMbps: z.number().int().positive().max(1000).optional(),
  speedProfile: z.string().trim().max(64).optional().default(''),
  enabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0)
});
const administratorSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(14).max(200),
  confirmPassword: z.string().min(14).max(200),
  active: z.boolean().default(true)
}).strict().refine((value) => value.password === value.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword']
});
const administratorUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()).optional()
}).strict();
const passwordSchema = z.object({
  password: z.string().min(14).max(200),
  confirmPassword: z.string().min(14).max(200)
}).strict().refine((value) => value.password === value.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword']
});
const administratorStatusSchema = z.object({ active: z.boolean() }).strict();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

adminRoutes.post('/auth/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const admin = await Admin.findOne({ email, active: true }).select('+passwordHash');
  if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: { code: 'SESSION_ERROR', message: 'Could not start an administrator session.' } });
    req.session.admin = {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName || '',
      role: admin.role,
      credentialVersion: admin.credentialVersion || 0
    };
    admin.lastLoginAt = new Date();
    admin.save().catch((saveError) => req.log.error({ err: saveError }, 'Admin last-login update failed'));
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: { code: 'SESSION_ERROR', message: 'Could not save administrator session.' } });
      return res.json({ admin: req.session.admin });
    });
  });
}));

adminRoutes.post('/auth/logout', requireAdmin, requireAdminWriteHeader, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('motech.sid');
    res.status(204).end();
  });
});

adminRoutes.use(requireAdmin);
adminRoutes.use(requireAdminWriteHeader);

adminRoutes.get('/auth/me', (req, res) => res.json({ admin: req.session.admin }));

adminRoutes.get('/administrators', requireAdministrator, asyncHandler(async (_req, res) => {
  res.json({ administrators: await listAdministrators() });
}));

adminRoutes.post('/administrators', requireAdministrator, asyncHandler(async (req, res) => {
  const parsed = administratorSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'INVALID_ADMINISTRATOR', 'Provide a valid name, email, and password of at least 14 characters.');
  const administrator = await createAdministrator(parsed.data);
  await writeAudit({
    actor: req.session.admin.email,
    action: 'administrator.created',
    targetType: 'admin',
    targetId: administrator._id,
    details: { email: administrator.email },
    requestId: req.id
  });
  res.status(201).json({ administrator });
}));

adminRoutes.patch('/administrators/:id', requireAdministrator, asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw new AppError(400, 'INVALID_ID', 'Administrator ID is invalid.');
  const parsed = administratorUpdateSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    throw new AppError(400, 'INVALID_ADMINISTRATOR', 'Administrator details are invalid.');
  }
  const administrator = await updateAdministrator(req.params.id, parsed.data);
  await writeAudit({
    actor: req.session.admin.email,
    action: 'administrator.updated',
    targetType: 'admin',
    targetId: administrator._id,
    details: { email: administrator.email },
    requestId: req.id
  });
  res.json({ administrator });
}));

adminRoutes.patch('/administrators/:id/status', requireAdministrator, asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw new AppError(400, 'INVALID_ID', 'Administrator ID is invalid.');
  const parsed = administratorStatusSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'INVALID_STATUS', 'Administrator status is invalid.');
  if (!parsed.data.active && String(req.params.id) === req.session.admin.id) {
    throw new AppError(409, 'CANNOT_DEACTIVATE_SELF', 'Sign in with another administrator to deactivate this account.');
  }
  const administrator = await setAdministratorStatus(req.params.id, parsed.data.active);
  await writeAudit({
    actor: req.session.admin.email,
    action: parsed.data.active ? 'administrator.activated' : 'administrator.deactivated',
    targetType: 'admin',
    targetId: administrator._id,
    details: { email: administrator.email },
    requestId: req.id
  });
  res.json({ administrator });
}));

adminRoutes.put('/administrators/:id/password', requireAdministrator, asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw new AppError(400, 'INVALID_ID', 'Administrator ID is invalid.');
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'INVALID_PASSWORD', 'Password must be 14-200 characters.');
  const administrator = await resetAdministratorPassword(req.params.id, parsed.data.password);
  await writeAudit({
    actor: req.session.admin.email,
    action: 'administrator.password_reset',
    targetType: 'admin',
    targetId: administrator._id,
    details: { email: administrator.email },
    requestId: req.id
  });
  res.json({ administrator });
}));

adminRoutes.get('/dashboard', asyncHandler(async (_req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [paymentsToday, successfulToday, pendingPayments, failedPayments, activeSessions, expiredSessions, recent, router] = await Promise.all([
    Payment.countDocuments({ createdAt: { $gte: start } }),
    Payment.aggregate([{ $match: { status: 'SUCCESS', completedAt: { $gte: start } } }, { $group: { _id: null, amount: { $sum: '$amountKes' } } }]),
    Payment.countDocuments({ status: { $in: ['CREATED', 'PENDING', 'REVIEW_REQUIRED'] } }),
    Payment.countDocuments({ status: { $in: ['FAILED', 'CANCELLED', 'EXPIRED'] } }),
    AccessSession.countDocuments({ routerState: 'ACTIVE', expiresAt: { $gt: new Date() } }),
    AccessSession.countDocuments({ routerState: 'EXPIRED' }),
    Payment.find().sort({ createdAt: -1 }).limit(10).select('orderId phoneNumber packageSnapshot amountKes status receiptNumber createdAt').lean(),
    routerHealth()
  ]);
  res.json({
    paymentsToday,
    successfulAmountKesToday: successfulToday[0]?.amount || 0,
    pendingPayments,
    failedPayments,
    activeSessions,
    expiredSessions,
    recentPayments: recent,
    router
  });
}));

adminRoutes.get('/packages', asyncHandler(async (_req, res) => {
  res.json({ packages: await Package.find().sort({ sortOrder: 1, createdAt: 1 }).lean() });
}));

adminRoutes.post('/packages', asyncHandler(async (req, res) => {
  const parsed = packageSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.downloadMbps === undefined || parsed.data.uploadMbps === undefined) {
    throw new AppError(400, 'INVALID_PACKAGE', 'Provide package details with positive download and upload speeds in Mbps.');
  }
  const item = await Package.create(parsed.data);
  await writeAudit({ actor: req.session.admin.email, action: 'package.created', targetType: 'package', targetId: item.id, requestId: req.id });
  res.status(201).json({ package: item });
}));

adminRoutes.patch('/packages/:id', asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw new AppError(400, 'INVALID_ID', 'Package ID is invalid.');
  const parsed = packageSchema.partial().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) throw new AppError(400, 'INVALID_PACKAGE', 'Package update is invalid.');
  const item = await Package.findByIdAndUpdate(req.params.id, parsed.data, { new: true, runValidators: true });
  if (!item) throw new AppError(404, 'PACKAGE_NOT_FOUND', 'Package was not found.');
  await writeAudit({ actor: req.session.admin.email, action: 'package.updated', targetType: 'package', targetId: item.id, requestId: req.id });
  res.json({ package: item });
}));

adminRoutes.delete('/packages/:id', asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw new AppError(400, 'INVALID_ID', 'Package ID is invalid.');
  const item = await Package.findByIdAndUpdate(req.params.id, { enabled: false }, { new: true });
  if (!item) throw new AppError(404, 'PACKAGE_NOT_FOUND', 'Package was not found.');
  await writeAudit({ actor: req.session.admin.email, action: 'package.disabled', targetType: 'package', targetId: item.id, requestId: req.id });
  res.json({ package: item });
}));

adminRoutes.get('/payments', asyncHandler(async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));
  const filter = {};
  if (['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REVIEW_REQUIRED'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) filter.$or = [
    { orderId: { $regex: escapeRegex(String(req.query.q).slice(0, 80)), $options: 'i' } },
    { phoneNumber: { $regex: escapeRegex(String(req.query.q).slice(0, 20)) } },
    { receiptNumber: { $regex: escapeRegex(String(req.query.q).slice(0, 40)), $options: 'i' } }
  ];
  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .select('orderId phoneNumber packageSnapshot amountKes status receiptNumber activationState failureMessage createdAt completedAt').lean(),
    Payment.countDocuments(filter)
  ]);
  res.json({ payments, page, limit, total });
}));

adminRoutes.get('/customers', asyncHandler(async (req, res) => {
  const match = req.query.q ? { phoneNumber: { $regex: escapeRegex(String(req.query.q).slice(0, 20)) } } : {};
  const customers = await Payment.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $group: {
      _id: '$phoneNumber',
      paymentCount: { $sum: 1 },
      lastPurchaseAt: { $max: '$createdAt' },
      successfulPayments: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } }
    } },
    { $sort: { lastPurchaseAt: -1 } },
    { $limit: 100 },
    { $project: { _id: 0, phoneNumber: '$_id', paymentCount: 1, successfulPayments: 1, lastPurchaseAt: 1 } }
  ]);
  res.json({ customers });
}));

adminRoutes.get('/payments/:id', asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ $or: [{ orderId: req.params.id }, ...( /^[a-f\d]{24}$/i.test(req.params.id) ? [{ _id: req.params.id }] : [])] }).lean();
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
  const access = await AccessSession.findOne({ paymentId: payment._id }).select('-encryptedPassword').lean();
  res.json({ payment, access });
}));

adminRoutes.post('/payments/:id/reconcile', asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw new AppError(400, 'INVALID_ID', 'Payment ID is invalid.');
  res.json(await reconcilePaymentByAdmin(req.params.id, req.session.admin.email, req.id));
}));

adminRoutes.get('/sessions', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.phone) filter.phoneNumber = { $regex: String(req.query.phone).slice(0, 20) };
  if (req.query.status && ['PENDING', 'ACTIVE', 'FAILED', 'EXPIRED'].includes(req.query.status)) filter.routerState = req.query.status;
  const sessions = await AccessSession.find(filter).sort({ createdAt: -1 }).limit(100).select('-encryptedPassword').lean();
  res.json({ sessions });
}));

adminRoutes.post('/sessions/:id/disconnect', asyncHandler(async (req, res) => {
  const access = await AccessSession.findById(req.params.id);
  if (!access) throw new AppError(404, 'SESSION_NOT_FOUND', 'Access session was not found.');
  await disconnectHotspotUser(access.username);
  await writeAudit({ actor: req.session.admin.email, action: 'session.disconnected', targetType: 'access_session', targetId: access.id, details: { reason: String(req.body?.reason || '').slice(0, 200) }, requestId: req.id });
  res.json({ disconnected: true });
}));

const getRouterStatus = asyncHandler(async (_req, res) => res.json(await routerHealth()));
adminRoutes.get('/router/health', getRouterStatus);
adminRoutes.get('/mikrotik/status', getRouterStatus);
adminRoutes.get('/audit-logs', asyncHandler(async (_req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ logs });
}));

adminRoutes.get('/reports/payments.csv', asyncHandler(async (_req, res) => {
  const payments = await Payment.find().sort({ createdAt: -1 }).limit(10000)
    .select('orderId phoneNumber packageSnapshot amountKes status receiptNumber createdAt completedAt').lean();
  const columns = ['orderId', 'phoneNumber', 'package', 'amountKes', 'status', 'receiptNumber', 'createdAt', 'completedAt'];
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = payments.map((item) => [
    item.orderId, item.phoneNumber, item.packageSnapshot?.name, item.amountKes,
    item.status, item.receiptNumber, item.createdAt?.toISOString(), item.completedAt?.toISOString()
  ].map(cell).join(','));
  res.type('text/csv').attachment('motech-zone-payments.csv').send([columns.join(','), ...rows].join('\r\n'));
}));
