import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Admin } from '../models/Admin.js';
import { AdminManagementLock } from '../models/AdminManagementLock.js';
import { AppError } from '../utils/errors.js';

export const MAX_ACTIVE_ADMINISTRATORS = 2;
const LOCK_ID = 'admin-management';
const LOCK_LEASE_MS = 30000;
const LOCK_WAIT_MS = 5000;

function publicAdmin(admin) {
  return {
    _id: admin._id,
    fullName: admin.fullName || '',
    email: admin.email,
    role: admin.role,
    active: admin.active,
    createdAt: admin.createdAt,
    lastLoginAt: admin.lastLoginAt || null
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withAdminManagementLock(operation) {
  const owner = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    let lock;
    try {
      lock = await AdminManagementLock.findOneAndUpdate(
        { _id: LOCK_ID, expiresAt: { $lte: new Date() } },
        { $set: { owner, expiresAt: new Date(Date.now() + LOCK_LEASE_MS) } },
        { new: true, upsert: true }
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    if (lock?.owner === owner) {
      try {
        return await operation();
      } finally {
        await AdminManagementLock.deleteOne({ _id: LOCK_ID, owner });
      }
    }
    await wait(50);
  }

  throw new AppError(503, 'ADMIN_MANAGEMENT_BUSY', 'Administrator management is busy. Please retry.');
}

export async function listAdministrators() {
  const administrators = await Admin.find().sort({ createdAt: 1, _id: 1 }).lean();
  return administrators.map(publicAdmin);
}

export async function createInitialAdministrator({ fullName, email, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  return withAdminManagementLock(async () => {
    if (await Admin.countDocuments({}) !== 0) {
      throw new AppError(409, 'INITIAL_ADMIN_EXISTS', 'An administrator already exists. Sign in and create additional administrators from Admin Management.');
    }
    const admin = await Admin.create({ fullName, email, passwordHash, role: 'admin', active: true });
    return publicAdmin(admin);
  });
}

export async function createAdministrator({ fullName, email, password, active = true }) {
  const passwordHash = await bcrypt.hash(password, 12);
  return withAdminManagementLock(async () => {
    if (active && await Admin.countDocuments({ active: true }) >= MAX_ACTIVE_ADMINISTRATORS) {
      throw new AppError(409, 'ADMIN_LIMIT_REACHED', 'At most two administrators can be active at the same time.');
    }
    const admin = await Admin.create({ fullName, email, passwordHash, role: 'admin', active });
    return publicAdmin(admin);
  });
}

export async function updateAdministrator(id, changes) {
  return withAdminManagementLock(async () => {
    const admin = await Admin.findByIdAndUpdate(id, changes, { new: true, runValidators: true });
    if (!admin) throw new AppError(404, 'ADMIN_NOT_FOUND', 'Administrator was not found.');
    return publicAdmin(admin);
  });
}

export async function setAdministratorStatus(id, active) {
  return withAdminManagementLock(async () => {
    const admin = await Admin.findById(id);
    if (!admin) throw new AppError(404, 'ADMIN_NOT_FOUND', 'Administrator was not found.');
    if (admin.active === active) return publicAdmin(admin);

    const activeCount = await Admin.countDocuments({ active: true });
    if (active && activeCount >= MAX_ACTIVE_ADMINISTRATORS) {
      throw new AppError(409, 'ADMIN_LIMIT_REACHED', 'At most two administrators can be active at the same time.');
    }
    if (!active && activeCount <= 1) {
      throw new AppError(409, 'LAST_ACTIVE_ADMIN', 'At least one administrator must remain active.');
    }

    admin.active = active;
    await admin.save();
    return publicAdmin(admin);
  });
}

export async function resetAdministratorPassword(id, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  return withAdminManagementLock(async () => {
    const admin = await Admin.findByIdAndUpdate(id, { passwordHash, $inc: { credentialVersion: 1 } }, { new: true });
    if (!admin) throw new AppError(404, 'ADMIN_NOT_FOUND', 'Administrator was not found.');
    return publicAdmin(admin);
  });
}
