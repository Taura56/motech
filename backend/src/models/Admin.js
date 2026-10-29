import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema({
  fullName: { type: String, trim: true, maxlength: 80, default: '' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  credentialVersion: { type: Number, default: 0 },
  role: { type: String, enum: ['admin', 'operator'], default: 'admin' },
  active: { type: Boolean, default: true },
  lastLoginAt: Date
}, { timestamps: true });

export const Admin = mongoose.model('Admin', adminSchema);
