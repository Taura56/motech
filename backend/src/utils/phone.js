import { AppError } from './errors.js';

export function normalizeKenyanPhone(input) {
  const compact = String(input).trim().replace(/[\s()-]/g, '');
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  let normalized;

  if (/^0[17]\d{8}$/.test(digits)) normalized = `254${digits.slice(1)}`;
  else if (/^254[17]\d{8}$/.test(digits)) normalized = digits;
  else if (/^[17]\d{8}$/.test(digits)) normalized = `254${digits}`;
  else throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Kenyan mobile number.');

  return normalized;
}
