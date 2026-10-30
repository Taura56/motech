import mongoose from 'mongoose';

const packageSnapshotSchema = new mongoose.Schema({
  name: { type: String, required: true },
  priceKes: { type: Number, required: true },
  durationSeconds: { type: Number, required: true },
  downloadMbps: Number,
  uploadMbps: Number,
  speedProfile: { type: String, default: '' }
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  publicTokenHash: { type: String, required: true, unique: true, select: false },
  encryptedPublicToken: { type: String, required: true, select: false },
  idempotencyKey: { type: String, default: undefined },
  phoneNumber: { type: String, required: true, index: true },
  routerContext: {
    macAddress: { type: String, default: '' },
    ipAddress: { type: String, default: '' }
  },
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
  packageSnapshot: { type: packageSnapshotSchema, required: true },
  amountKes: { type: Number, required: true },
  currency: { type: String, default: 'KES', immutable: true },
  provider: { type: String, default: 'daraja', immutable: true },
  shortcode: { type: String, required: true },
  status: {
    type: String,
    enum: ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REVIEW_REQUIRED'],
    default: 'CREATED',
    index: true
  },
  checkoutRequestId: { type: String, sparse: true, unique: true },
  merchantRequestId: { type: String, default: '' },
  receiptNumber: { type: String, default: '' },
  callback: {
    merchantRequestId: String,
    resultCode: Number,
    resultDescription: String,
    amountKes: Number,
    phoneNumber: String,
    receiptNumber: String,
    receivedAt: Date,
    verificationClaimAt: Date
  },
  failureCode: { type: String, default: '' },
  failureMessage: { type: String, default: '' },
  activationState: { type: String, enum: ['NOT_STARTED', 'PENDING', 'ACTIVE', 'FAILED', 'EXPIRED'], default: 'NOT_STARTED' },
  activationClaimAt: Date,
  completedAt: Date
}, { timestamps: true });

paymentSchema.index({ status: 1, 'callback.receivedAt': 1 });
paymentSchema.index({ createdAt: 1, status: 1 });
paymentSchema.index(
  { phoneNumber: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

export const Payment = mongoose.model('Payment', paymentSchema);
