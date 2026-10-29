import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  actor: { type: String, required: true },
  action: { type: String, required: true },
  targetType: { type: String, default: '' },
  targetId: { type: String, default: '' },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  requestId: { type: String, default: '' }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
