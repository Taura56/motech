import mongoose from 'mongoose';

const accessSessionSchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
  phoneNumber: { type: String, required: true, index: true },
  macAddress: { type: String, default: '', index: true },
  ipAddress: { type: String, default: '' },
  username: { type: String, required: true, unique: true },
  encryptedPassword: { type: String, required: true, select: false },
  startsAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: true },
  durationSeconds: { type: Number, required: true },
  routerState: { type: String, enum: ['PENDING', 'ACTIVE', 'FAILED', 'EXPIRED'], default: 'PENDING', index: true },
  routerError: { type: String, default: '' },
  routerSyncedAt: Date,
  routerUserId: { type: String, default: '' },
  lastLogoutAt: Date,
  disconnectedAt: Date
}, { timestamps: true });

accessSessionSchema.index({ routerState: 1, expiresAt: 1 });

export const AccessSession = mongoose.model('AccessSession', accessSessionSchema);
