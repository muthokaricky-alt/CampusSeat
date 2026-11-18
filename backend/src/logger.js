import crypto from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config.js';

/**
 * One JSON logger for the whole app. Secrets never reach the logs:
 * request bodies are not logged at all, and the headers and fields below are redacted
 * wherever they appear (also inside objects passed to log.info({...})).
 */
const SECRET_KEYS = ['password', 'new_password', 'current_password', 'password_hash', 'token', 'code', 'backup_code',
  'secret', 'totp_secret', 'challenge', 'csrf', 'temporary_password'];
export const logger = pino({
  level: config.logLevel,
  base: { service: 'campusseat-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]',
      ...SECRET_KEYS, ...SECRET_KEYS.map((k) => `*.${k}`),
    ],
    censor: '[redacted]',
  },
});

const REQ_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Gives every request an id (reuses a well-formed incoming X-Request-Id), sends it back, and logs the request. */
export const httpLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && REQ_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  // Do not log query strings: they can hold reset tokens or search text about people.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0], ip: req.remoteAddress }),
    res: (res) => ({ status: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  // Static files and health probes are not logged (Render probes /api/ready every few seconds).
  autoLogging: { ignore: (req) => !req.url.startsWith('/api/') || /^\/api\/(health|ready)/.test(req.url) },
  customProps: (req) => (req.user ? { user_id: req.user.user_id } : {}),
});
