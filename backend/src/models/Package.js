import mongoose from 'mongoose';

const packageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, trim: true, maxlength: 240, default: '' },
  priceKes: { type: Number, required: true, min: 1, validate: Number.isInteger },
  durationSeconds: { type: Number, required: true, min: 60, validate: Number.isInteger },
  downloadMbps: { type: Number, min: 1, validate: Number.isInteger },
  uploadMbps: { type: Number, min: 1, validate: Number.isInteger },
  speedProfile: { type: String, trim: true, maxlength: 64, default: '' },
  enabled: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0, validate: Number.isInteger }
}, { timestamps: true });

export const Package = mongoose.model('Package', packageSchema);
