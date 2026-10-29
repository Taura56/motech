import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { publicRoutes } from './routes/publicRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';

export function createApp({ sessionStore } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false);
  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const requestId = req.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
      res.setHeader('X-Request-Id', requestId);
      return requestId;
    }
  }));
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    }
  }));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(session({
    name: 'motech.sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore || MongoStore.create({ mongoUrl: config.MONGODB_URI, collectionName: 'admin_sessions', ttl: 60 * 60 * 8 }),
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.sessionCookieSecure,
      maxAge: 1000 * 60 * 60 * 8
    }
  }));

  const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => ['/payments/status', '/access/status'].includes(req.path) && Boolean(req.get('x-payment-token'))
  });
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      database: { connected: mongoose.connection.readyState === 1 }
    });
  });
  app.use('/api', publicLimiter, publicRoutes);
  app.use('/api/admin', adminRoutes);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } }));
  app.use((error, req, res, _next) => {
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ error: { code: 'DUPLICATE_VALUE', message: 'A record with that value already exists.' } });
    }
    if (error?.message === 'Origin is not allowed by CORS') {
      return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed.' } });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 500) req.log.error({ err: error, requestId: req.id }, 'Request failed');
    const safeProviderSetupError = ['CALLBACK_NOT_CONFIGURED', 'CALLBACK_NOT_SECURE'].includes(error?.code);
    res.status(status).json({
      error: {
        code: error?.code || 'INTERNAL_ERROR',
        message: status >= 500 && !safeProviderSetupError
          ? 'The request could not be completed.'
          : error.message
      },
      requestId: req.id
    });
  });
  return app;
}
