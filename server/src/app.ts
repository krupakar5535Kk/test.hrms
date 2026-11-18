import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { v1Router } from './routes/v1/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

function isAllowedCorsOrigin(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  // Allow official KMACCS and Vercel project deployment domains
  if (/^https:\/\/(kmaccs-hrms[a-z0-9_-]*|[a-z0-9_-]+-krupakar5535-1836s-projects)\.vercel\.app$/i.test(origin)) {
    return true;
  }
  if (/^https:\/\/[a-z0-9_-]+\.vercel\.app$/i.test(origin)) {
    return true;
  }
  // Allow localhost and loopback interfaces for development
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return true;
  }
  return false;
}

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);

  // 1. Security & Hardening Middleware
  const allowedOrigins = new Set([env.CORS_ORIGIN, ...env.CORS_ALLOWED_ORIGINS]);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin, allowedOrigins)) {
          callback(null, true);
        } else {
          logger.warn(`CORS rejected origin: ${origin}`);
          callback(null, false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'x-request-id'],
    })
  );

  // 2. Request Parsing Middleware (8mb JSON limit allows base64 compressed live selfie captures safely)
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));

  // 3. Request Logging Middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`, {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.ip,
      });
    });
    next();
  });

  // 4. API Routes
  app.use(env.API_PREFIX, v1Router);

  // 5. 404 Not Found & Centralized Error Handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
