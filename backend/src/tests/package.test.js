import test from 'node:test';
import assert from 'node:assert/strict';
import { Package } from '../models/Package.js';

test('package schema accepts integer KES prices and positive duration', () => {
  const item = new Package({
    name: 'Daily', slug: 'daily', priceKes: 50, durationSeconds: 86400, downloadMbps: 20, uploadMbps: 5
  });
  assert.equal(item.validateSync(), undefined);
});

test('package schema rejects invalid download or upload speed limits', () => {
  const item = new Package({
    name: 'Invalid speed', slug: 'invalid-speed', priceKes: 50, durationSeconds: 3600,
    downloadMbps: 0, uploadMbps: 1.5
  });
  const error = item.validateSync();
  assert.ok(error);
  assert.ok(error.errors.downloadMbps);
  assert.ok(error.errors.uploadMbps);
});

test('package schema rejects fractional prices and durations below the minimum', () => {
  const item = new Package({
    name: 'Bad', slug: 'bad', priceKes: 1.5, durationSeconds: 1
  });
  const error = item.validateSync();
  assert.ok(error);
  assert.ok(error.errors.priceKes);
  assert.ok(error.errors.durationSeconds);
});
