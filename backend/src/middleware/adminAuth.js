import { AppError } from '../utils/errors.js';
import { Admin } from '../models/Admin.js';

export function requireAdmin(req, res, next) {
  if (!req.session?.admin) return next(new AppError(401, 'AUTH_REQUIRED', 'Administrator login is required.'));
  return Admin.findById(req.session.admin.id).select('email fullName role active credentialVersion').lean()
    .then((admin) => {
      if (!admin?.active || (req.session.admin.credentialVersion ?? 0) !== admin.credentialVersion) {
        req.session.destroy(() => {});
        return next(new AppError(401, 'AUTH_REQUIRED', 'Administrator session is no longer valid. Sign in again.'));
      }
      req.session.admin = {
        id: String(admin._id),
        email: admin.email,
        fullName: admin.fullName || '',
        role: admin.role,
        credentialVersion: admin.credentialVersion
      };
      return next();
    })
    .catch(next);
}

export function requireAdministrator(req, res, next) {
  if (req.session?.admin?.role !== 'admin') {
    return next(new AppError(403, 'ADMINISTRATOR_REQUIRED', 'Administrator privileges are required.'));
  }
  next();
}

export function requireAdminWriteHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.get('x-requested-with') || req.get('x-requested-with') !== 'MOTECH-ZONE-ADMIN') {
    return next(new AppError(403, 'REQUEST_NOT_ALLOWED', 'This administrative request was not accepted.'));
  }
  next();
}
