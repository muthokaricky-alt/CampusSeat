import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { trustedProxies } from './proxies.js';
import { AppError } from './utils/errors.js';
import { httpLogger } from './logger.js';
import { health, ready } from './health.js';
import { originCheck } from './middleware/auth.js';
import { sentTo } from './mail/index.js';
import authRoutes from './routes/auth.js';
import schoolRoutes from './routes/schools.js';
import eventRoutes from './routes/events.js';
import bookingRoutes from './routes/bookings.js';
import adminRoutes from './routes/admin.js';
import accountRoutes from './routes/account.js';
import auditRoutes from './routes/audit.js';

export function createApp() {
  const app = express();
  // Visitor IP behind Cloudflare and Render's private load balancer: see src/proxies.js.
  app.set('trust proxy', trustedProxies());
  app.disable('x-powered-by');
  app.use(httpLogger);
  app.use(compression()); // gzip responses (JS, CSS, JSON, SVG); PDFs are already compressed and skipped by type
  app.use(helmet());
  if (!config.isProd) app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', originCheck); // CSRF layer 1 (layer 2, the token, is checked with the session)
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', health);
  app.get('/api/ready', ready);
  // Automated tests read the emails the app "sent". Only exists with NODE_ENV=test and MAIL_DRIVER=memory.
  if (config.isTest && config.mail.driver === 'memory') {
    app.get('/api/_test/mail', (req, res) => res.json({ messages: sentTo(String(req.query.to || '')) }));
  }
  app.use('/api/auth', authRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/schools', schoolRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/admin', auditRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));

  // Serve the built React app (npm run build in /frontend) from the same server.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (fs.existsSync(dist)) {
    // Hashed build files never change: cache them for a year. Everything else (index.html) is revalidated,
    // so a deploy is picked up on the next visit.
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(dist, { index: false, maxAge: 0 }));
    // Express 5 no longer accepts '*' as a path, so use a catch-all middleware for client-side routes.
    app.use((req, res, next) => {
      // Missing build files get a real 404, not index.html served as JavaScript.
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/assets/')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  // Every error has the same shape: { error: { code, message, field?, request_id } }.
  app.use((err, req, res, _next) => {
    const request_id = req.id;
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra, request_id } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.', request_id } });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body is too large.', request_id } });
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.', request_id } });
  });
  return app;
}
