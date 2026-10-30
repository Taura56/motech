import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1),
  PUBLIC_BACKEND_URL: z.string().url(),
  PUBLIC_FRONTEND_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  PAYMENT_ENCRYPTION_KEY: z.string().min(1),
  SESSION_COOKIE_SECURE: z.string().default('false'),
  MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).optional(),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().optional(),
  DARAJA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  DARAJA_CONSUMER_KEY: z.string().default(''),
  DARAJA_CONSUMER_SECRET: z.string().default(''),
  DARAJA_SHORTCODE: z.string().default(''),
  DARAJA_PASSKEY: z.string().default(''),
  DARAJA_CALLBACK_URL: z.string().default(''),
  DARAJA_TRANSACTION_TYPE: z.string().default('CustomerPayBillOnline'),
  DARAJA_ACCOUNT_REFERENCE: z.string().min(1).default('MOTECHZONE'),
  DARAJA_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  MIKROTIK_ENABLED: z.enum(['true', 'false']).default('false'),
  MIKROTIK_HOST: z.string().default('192.168.10.1'),
  MIKROTIK_PORT: z.coerce.number().int().min(1).max(65535).default(8728),
  MIKROTIK_REST_PORT: z.coerce.number().int().min(1).max(65535).default(443),
  MIKROTIK_USERNAME: z.string().default(''),
  MIKROTIK_PASSWORD: z.string().default(''),
  MIKROTIK_TLS_REJECT_UNAUTHORIZED: z.string().default('true'),
  MIKROTIK_DEFAULT_PROFILE: z.string().default('default'),
  MIKROTIK_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  LOG_LEVEL: z.string().default('info')
});

export function validateEnvironment(environment = process.env) {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }

  const source = parsed.data;
  const value = {
    ...source,
    DARAJA_ENV: source.MPESA_ENVIRONMENT ?? source.DARAJA_ENV,
    DARAJA_CONSUMER_KEY: source.MPESA_CONSUMER_KEY ?? source.DARAJA_CONSUMER_KEY,
    DARAJA_CONSUMER_SECRET: source.MPESA_CONSUMER_SECRET ?? source.DARAJA_CONSUMER_SECRET,
    DARAJA_SHORTCODE: source.MPESA_SHORTCODE ?? source.DARAJA_SHORTCODE,
    DARAJA_PASSKEY: source.MPESA_PASSKEY ?? source.DARAJA_PASSKEY,
    DARAJA_CALLBACK_URL: source.MPESA_CALLBACK_URL ?? source.DARAJA_CALLBACK_URL
  };
  if (Buffer.from(value.PAYMENT_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('PAYMENT_ENCRYPTION_KEY must be base64 encoding of exactly 32 random bytes');
  }
  if (value.DARAJA_CALLBACK_URL) {
    let callback;
    try { callback = new URL(value.DARAJA_CALLBACK_URL); } catch {
      throw new Error('MPESA_CALLBACK_URL must be a valid public HTTPS URL when configured');
    }
    if (callback.protocol !== 'https:') {
      throw new Error('MPESA_CALLBACK_URL must use HTTPS when configured');
    }
  }
  const credentials = [
    value.DARAJA_CONSUMER_KEY, value.DARAJA_CONSUMER_SECRET,
    value.DARAJA_SHORTCODE, value.DARAJA_PASSKEY
  ];
  if (credentials.some(Boolean) && !credentials.every(Boolean)) {
    throw new Error('Provide all four M-Pesa credentials together or leave all four blank');
  }
  if (value.DARAJA_SHORTCODE && !/^\d{5,6}$/.test(value.DARAJA_SHORTCODE)) {
    throw new Error('MPESA_SHORTCODE must contain 5 or 6 digits');
  }
  if (value.NODE_ENV === 'production') {
    if (!value.DARAJA_CALLBACK_URL || value.PUBLIC_BACKEND_URL.startsWith('http://')) {
      throw new Error('Production callback and backend URLs must use HTTPS');
    }
    if (value.SESSION_COOKIE_SECURE !== 'true' || value.MIKROTIK_TLS_REJECT_UNAUTHORIZED === 'false') {
      throw new Error('Production requires secure session cookies and verified MikroTik TLS certificates');
    }
    if (value.ALLOWED_ORIGINS.split(',').some((origin) => origin.trim() === '*' || origin.trim().startsWith('http://'))) {
      throw new Error('Production ALLOWED_ORIGINS must contain only explicit HTTPS origins');
    }
    if (value.DARAJA_ENV === 'production' && !credentials.every(Boolean)) {
      throw new Error('Production M-Pesa credentials and an approved shortcode are required');
    }
  }
  if (value.MIKROTIK_ENABLED === 'true' && (
    !value.MIKROTIK_HOST || !value.MIKROTIK_USERNAME || !value.MIKROTIK_PASSWORD
  )) {
    throw new Error('MikroTik API host and credentials are required when MIKROTIK_ENABLED=true');
  }

  return {
    ...value,
    allowedOrigins: value.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    sessionCookieSecure: value.SESSION_COOKIE_SECURE === 'true',
    mikrotikEnabled: value.MIKROTIK_ENABLED === 'true',
    mikrotikTlsRejectUnauthorized: value.MIKROTIK_TLS_REJECT_UNAUTHORIZED !== 'false',
    paymentEncryptionKey: Buffer.from(value.PAYMENT_ENCRYPTION_KEY, 'base64')
  };
}

export const config = validateEnvironment();
