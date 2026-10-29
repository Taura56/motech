import mongoose from 'mongoose';

const adminManagementLockSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { versionKey: false });

export const AdminManagementLock = mongoose.model('AdminManagementLock', adminManagementLockSchema);
