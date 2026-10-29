import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie',
      'password', 'phoneNumber', 'consumerSecret', 'passkey',
      'MIKROTIK_PASSWORD', 'DARAJA_CONSUMER_SECRET', 'MPESA_CONSUMER_SECRET',
      'MPESA_PASSKEY', 'DARAJA_PASSKEY'
    ],
    censor: '[REDACTED]'
  }
});
