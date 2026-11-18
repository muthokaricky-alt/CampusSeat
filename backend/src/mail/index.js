import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Pluggable mail sender, chosen with MAIL_DRIVER:
 *   console  development: prints the message (with its links) to the terminal. Refused in production.
 *   memory   automated tests only (NODE_ENV=test): keeps messages for GET /api/_test/mail.
 *   smtp     any SMTP server (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE).
 *   resend   Resend HTTP API (RESEND_API_KEY). Use this on hosts that block SMTP ports (e.g. Render free tier).
 * send() resolves to true/false and never throws: a mail problem must not break the request.
 */
const outbox = []; // memory driver
const MAX_OUTBOX = 500;

let smtp; // created on first use
async function sendSmtp(msg) {
  if (!smtp) {
    const nodemailer = (await import('nodemailer')).default;
    smtp = nodemailer.createTransport({
      host: config.mail.smtp.host,
      port: config.mail.smtp.port,
      secure: config.mail.smtp.secure,
      auth: config.mail.smtp.user ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass } : undefined,
      // Plain-text content only: never read files or URLs while building a message.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  await smtp.sendMail({ from: config.mail.from, ...msg });
}

async function sendResend(msg) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.mail.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** msg = { to, subject, text, html, kind }. `kind` is a short label for logs (never the content). */
export async function send(msg) {
  const meta = { kind: msg.kind, driver: config.mail.driver };
  try {
    switch (config.mail.driver) {
      case 'memory':
        outbox.push({ ...msg, sent_at: new Date().toISOString() });
        if (outbox.length > MAX_OUTBOX) outbox.shift();
        break;
      case 'console':
        // Development only (refused in production by config.js), so printing the link is acceptable here.
        console.log(`\n----- email (${msg.kind}) to ${msg.to} -----\nSubject: ${msg.subject}\n\n${msg.text}\n-----\n`);
        break;
      case 'smtp': await sendSmtp(msg); break;
      case 'resend': await sendResend(msg); break;
      default: throw new Error(`unknown MAIL_DRIVER ${config.mail.driver}`);
    }
    logger.info(meta, 'email sent');
    return true;
  } catch (err) {
    logger.error({ ...meta, err: { message: err.message, code: err.code } }, 'email failed');
    return false;
  }
}

/** Test helper (memory driver): messages sent to an address, newest last. */
export const sentTo = (to) => outbox.filter((m) => m.to === to);
