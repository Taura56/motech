import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { Package } from '../models/Package.js';

const defaults = [
  { name: 'Hourly', slug: 'hourly', description: 'Short session', priceKes: 10, durationSeconds: 3600, sortOrder: 1 },
  { name: '3 Hours', slug: 'three-hours', description: 'Three-hour session', priceKes: 20, durationSeconds: 10800, sortOrder: 2 },
  { name: 'Daily', slug: 'daily', description: '24-hour access', priceKes: 50, durationSeconds: 86400, sortOrder: 3 },
  { name: 'Weekly', slug: 'weekly', description: '7-day access', priceKes: 250, durationSeconds: 604800, sortOrder: 4 }
];

await mongoose.connect(config.MONGODB_URI);
for (const item of defaults) await Package.updateOne({ slug: item.slug }, { $setOnInsert: item }, { upsert: true });
console.log('Sample package defaults are present. Review prices before accepting real payments.');
await mongoose.disconnect();
