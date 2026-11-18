# CampusSeat → production quality: PLAN

## Context
CampusSeat works (Express 5 + mysql2 backend, React 19/Vite frontend, MySQL on Aiven, app on Render, 47 passing e2e tests), but it has gaps that block production use:
- JWT kept in `localStorage`, no CSRF protection, logout doesn't invalidate anything.
- Forgot-password only checks email + student number. That is a weak secret.
- No 2FA, no lockout, no structured logging, no migrations (just `schema.sql` / `schema_hosted.sql`).
- Timezones are broken. Commit 79de9f6 (2026-11-17 20:33 EAT) set connections to `+03:00`, so rows after it are stored in EAT, but `fmtDateTime` treats them as UTC, so new `booked_at` values display 3h ahead. Events are created with the server's UTC date (`parseEvent` uses `toLocaleDateString('en-CA')`, and so does the seed `day()`).
- No user cancellation, no waitlist, no pagination on most lists, very little in the audit log, and a basic UI.

What you decided:
- **Old timestamps:** shift rows after the cutover by −3h (UTC rows before it stay as they are). You confirm the exact Render deploy time first.
- **Login:** cookie-only. Bearer auth is removed and the test harness gets a cookie jar plus a CSRF header.
- **Waitlist:** the first person in line is promoted automatically inside the locked transaction.
- **Mail:** a pluggable `MAIL_DRIVER`: `console` (dev), `smtp` (nodemailer), `resend` (HTTP API, because Render's free tier may block SMTP ports).

Step 0 is already done: `ui-ux-pro-max` is installed at `~/.claude/skills/ui-ux-pro-max`, and the 21st plugin is installed. At the start of Phase 3 I will re-check that skill against its README for version drift. The 21st MCP needs you to authenticate once (`mcp__plugin_21st_21st__authenticate`).

**Process:** after you approve this plan, I copy it to `PLAN.md` in the repo as the first commit. I then do Phase 1 in small commits on `production-ready`. Each commit keeps `npm test` green and the app runnable. **I stop for your OK before Phase 2**, and again before running any migration against Aiven.

---

## Phase 1: Backend and security

| # | Change | Key files | Risk |
|---|---|---|---|
| 1.1 | **Migrations system.** `backend/migrations/NNN_name.sql` plus `scripts/migrate.js` (status / up). A `schema_migrations` table holds a checksum per file, and an advisory lock (`GET_LOCK`) stops two runners at once. `001_baseline.sql` is the current schema. If the core tables already exist (Aiven), the runner **marks 001 as applied without running it**. `schema.sql` and `schema_hosted.sql` stay but point at the migrations. `setup-db.js` becomes `npm run migrate`. | new `backend/migrations/`, `scripts/migrate.js`, `package.json` | **High on live data.** I run it against Aiven only after you take a backup (Aiven console → backups, or `mysqldump`). |
| 1.2 | **Env validation.** `config.js` gets a declarative schema: type, required-in-prod, min length, allowed values. On failure it prints every problem at once with a hint, then exits. New vars: `SESSION_*`, `APP_URL`, `MAIL_*`, `TOTP_ENC_KEY`, `LOG_LEVEL`, `CANCEL_CUTOFF_HOURS`. `.env.example` updated. | `src/config.js`, `.env.example` | Low |
| 1.3 | **Logging.** `pino` + `pino-http`. Every request gets a request id (honours an incoming `X-Request-Id` if it is valid, otherwise generates a UUID) and returns it in a response header. Redaction covers `password*`, `new_password`, `current_password`, `token`, `code`, `cookie`, `authorization`, `set-cookie` and `x-csrf-token`. The error handler logs through pino, and the 500 response includes the `request_id`. | `src/logger.js`, `app.js` | Low |
| 1.4 | **Health.** `/api/health` reports liveness plus `SELECT 1` with a latency and timeout. It returns 503 if the DB is down. `/api/ready` returns 200 only when the DB is reachable, migrations are up to date and the app is not shutting down. Graceful shutdown on SIGTERM drains the server and pool, and Render's health check points at `/api/ready`. | `app.js`, `server.js` | Low |
| 1.5 | **Timezone done properly.** Connections switch to `time_zone='+00:00'` and mysql2 gets `timezone:'Z'`. Migration `002_utc` adds `events.starts_at` / `ends_at` (UTC DATETIME), backfilled from `event_date+start_time − 3h` (Kenya has no DST, so this is exact). It also shifts `users.created_at`, `bookings.booked_at`, `audit_logs.logged_at` and `events.created_at` by −3h **only for rows after the cutover**, which is read from a required `TZ_CUTOVER_UTC` value you confirm. A new `src/utils/time.js` (built on `Intl`, `Africa/Nairobi`) converts both ways. The API still returns `event_date`, `start_time` and `end_time` in Nairobi wall time, so the frontend and tests stay compatible, and adds ISO `starts_at` / `ends_at` / `booked_at` with a trailing `Z`. The "past" check becomes `ends_at < UTC_TIMESTAMP()`. `parseEvent` and the seed use the Nairobi "today". The old date/time columns are dropped in a later migration (`00x_drop_legacy_time`) after you verify. Tests: an event ending 1 minute ago in Nairobi counts as past, and an event later today in Nairobi is bookable even when the UTC date differs. | `db.js`, `routes/events.js`, `bookings.js`, `admin.js`, `seed.js`, `frontend/src/lib/format.js` | **High:** data rewrite. Dry-run mode prints the affected row counts first. |
| 1.6 | **Cookie sessions.** A new `sessions` table stores the SHA-256 of a 32-byte random id, plus user_id, csrf_secret, created_at, last_seen_at, idle and absolute expiry, ip, ua and revoked_at. The cookie is `__Host-cs_sid` in production (`cs_sid` in dev): httpOnly, Secure (prod), SameSite=Lax, Path=/. These are opaque server-side sessions rather than JWT and refresh tokens, so revoking one takes effect instantly. The DB lookup happens on every request already, so this costs nothing extra. Sessions slide: 2h idle and 7d absolute (configurable), and the cookie is refreshed when it is more than half used. Logout revokes the current session, "Log out everywhere" revokes all of them, and a password change, password reset or role change revokes all of the user's other sessions. `jsonwebtoken` stays only for the short-lived 2FA challenge, or is removed. | `middleware/auth.js`, `routes/auth.js`, migration `003_sessions` | Medium. Existing users are logged out once. |
| 1.7 | **CSRF.** Every unsafe method must pass two checks. First, the `Origin` (or `Referer`) header must match `APP_URL` or `CLIENT_ORIGIN`. Second, an `X-CSRF-Token` header must equal an HMAC of the session's csrf_secret; the token comes from `/api/auth/me`, the login response and a readable `cs_csrf` cookie. Login and register (pre-session) are covered by the Origin check plus SameSite. Frontend `api.js` sends `credentials:'same-origin'` and the header, and drops localStorage. | `middleware/csrf.js`, `frontend/src/lib/api.js`, `AuthContext.jsx` | Medium |
| 1.8 | **Lockout.** `users.failed_logins` and `users.locked_until`. After 5 failures the account is locked for 15 min, then the lock doubles up to 24h. It resets on success. Locked accounts get the same generic message plus a "try later" hint, so the response doesn't reveal whether an account exists. The existing IP limits stay, and the admin user list gets an unlock action. | `routes/auth.js`, migration `004` | Low. Lockout-DoS is limited by time-boxing the lock. |
| 1.9 | **Password reset by email.** `password_resets` stores the SHA-256 of a 32-byte token, user_id, expires_at (30 min), used_at and request ip. `POST /auth/forgot-password {email}` always returns 200 (no enumeration), invalidates earlier tokens and emails `APP_URL/reset-password?token=…`. `POST /auth/reset-password {token,new_password}` is single-use, runs in a transaction and revokes all sessions. Mailer: `src/mail/index.js` with `console` / `smtp` / `resend` drivers and plain-text plus HTML templates. The console driver never logs in prod, and startup fails if the driver is `console` while `NODE_ENV=production`. Admin "reset password" keeps returning a temp password (the test depends on it), but it now also revokes sessions. A "send reset email" option is added too. Tests read the token through a test-only mail sink (`MAIL_DRIVER=memory`, exposed at `/api/_test/mail` only when `NODE_ENV=test`). The 2 old forgot-password tests are replaced by about 6 covering the request, use, reuse rejection, expiry and enumeration. | `routes/auth.js`, `src/mail/*`, `pages/Auth.jsx` (+ ResetPassword page), migration `005` | Medium. The old flow is removed on purpose. |
| 1.10 | **Admin TOTP 2FA (optional per admin).** Uses `otplib` and the existing `qrcode`. `users.totp_secret_enc` is encrypted with AES-256-GCM using `TOTP_ENC_KEY`, alongside `totp_enabled_at`. A `backup_codes` table holds 10 codes, bcrypt-hashed and single-use. Setup: generate the secret, show a QR data-URL, confirm with a code, then show the backup codes once. Login: if 2FA is on, the password step returns `{mfa_required, challenge}` (a 5-min signed token), then `POST /auth/2fa` with a code or backup code creates the session. Disabling or regenerating requires the password plus a code. TOTP attempts count toward lockout. Tests generate codes with otplib. | `routes/auth.js`, `routes/account.js`, new Security settings page | Medium |
| 1.11 | **Lists: pagination, sorting, shape.** A shared `utils/list.js` parses `page`, `limit` (max 100) and a whitelisted `sort`/`dir`. Every list returns the same shape: `{ <resource>: [...], meta: { page, limit, total, sort, dir } }`. The resource key stays, so tests and the frontend keep working. This applies to events, bookings (admin), bookings/mine, admin users and audit logs. Errors keep `{error:{code,message,field}}` and add `request_id`. `/api/events` defaults to limit 50. Reports stay unpaginated (they are exports). | `utils/list.js`, all routes | Low |
| 1.12 | **Indexes** (migration `006`): `bookings(event_id)`, `bookings(booked_at)`, `events(starts_at)`, `events(ends_at)`, `audit_logs(user_id, logged_at)`, `audit_logs(action, logged_at)`, `users(created_at)`, plus indexes on the new tables. I verify them with `EXPLAIN` on the main queries. | migration | Low |
| 1.13 | **User cancellation and waitlist.** `DELETE /api/bookings/:id` is opened to the booking's owner, allowed until `CANCEL_CUTOFF_HOURS` (default 2) before `starts_at`; admins can cancel any time. A new `waitlist(event_id,user_id,created_at,status,promoted_booking_id)` table has UNIQUE(event_id,user_id). `POST /api/events/:id/waitlist` joins only when the event is full, and `DELETE` leaves. **Lock order is always the same: event row `FOR UPDATE` → bookings → waitlist.** That applies to booking, cancelling, joining and to an admin raising capacity. A cancellation deletes the booking and promotes the oldest eligible waiter (`FOR UPDATE SKIP LOCKED` isn't needed because the event lock already serialises) by inserting a booking and marking it promoted. The promotion email is sent *after* commit. The `seats_remaining` maths is unchanged. New tests: 10 concurrent joiners all get queued in order, cancel-and-book races never overbook, a cancel promotes exactly one person, the cutoff is enforced, a user can't cancel someone else's booking, and raising capacity promotes N people. | `routes/bookings.js`, `routes/events.js`, migration `007` | Medium. This is concurrency-sensitive, so the existing 25-racer test stays. |
| 1.14 | **Docker and CI.** A multi-stage `Dockerfile` builds the frontend and runs `node:22-alpine` as a non-root user with a healthcheck. `docker-compose.yml` runs the app plus `mysql:8.4` with a volume, a healthcheck and migrate+seed on start. `.dockerignore` keeps out `.env` and `node_modules`. `.github/workflows/ci.yml` runs Node 22 with a MySQL service, installs, migrates, seeds, starts the API, runs `npm test` and builds the frontend. | new files | Low |

Also in Phase 1:
- CSV export gets formula-injection protection: cells starting with `= + - @` or a tab are prefixed with `'`.
- The `Help.jsx` text is updated for the new reset flow.
- The README gets a deploy and env section.
- e2e harness: a `client()` helper with its own cookie jar and CSRF token per user. Every existing assertion is kept, and new ones are added for each change.

## Phase 2: Audit trails
| # | Change | Risk |
|---|---|---|
| 2.1 | Migration `008_audit_v2`: `actor_user_id` (the renamed `user_id`), `actor_email` (a snapshot that survives user deletion), `action`, `entity_type`, `entity_id`, `before_json` / `after_json` (JSON), `ip` VARCHAR(45), `user_agent` VARCHAR(255), `request_id` CHAR(36) and `details` (kept). Existing rows are backfilled with entity NULL. | Medium (live data, additive) |
| 2.2 | Append-only. There are no update or delete routes. DB triggers `BEFORE UPDATE/DELETE ON audit_logs` raise a SIGNAL; FK SET NULL cascades don't fire triggers, so deleting a user still works. If Aiven refuses `CREATE TRIGGER` (binlog privileges), the fallback is to document a separate DB user without UPDATE/DELETE on that table. | Low or Medium |
| 2.3 | `audit(req, {action, entity, before, after, conn})` pulls the ip, user agent and request id from `req`. It covers: LOGIN, LOGIN_FAILED (including locked and 2FA failures), LOGOUT, LOGOUT_ALL, REGISTER, ROLE_CHANGE (before/after), PASSWORD_CHANGE / RESET_REQUEST / RESET / ADMIN_RESET, 2FA_ENABLE / DISABLE / BACKUP_USED, ACCOUNT_LOCKED / UNLOCK, EVENT_CREATE / UPDATE (with a field diff) / DELETE, BOOK, CANCEL (by user or admin), WAITLIST_JOIN / LEAVE / PROMOTE, REPORT_DOWNLOAD (type, format, filters), AUDIT_EXPORT, and USER_DELETE. | Low |
| 2.4 | The admin audit page gets filters (user picker, action multi-select, date range in Nairobi converted to UTC), full-text search, server pagination, a detail drawer showing a before/after diff, and **Export CSV** of the filtered set (streamed, capped at 50k rows, logged). | Low |

## Phase 3: UI/UX
These skills are used: ui-ux-pro-max (style and palette check, UX guidelines), 21st (component sourcing, after you authenticate), animate / choreograph / emil-design-eng for the motion work, and break-ui for edge cases. Each principle is recorded in `docs/UX_NOTES.md` with the place it is applied:

- **Booking flow (frequency of use, Fitts, Hick, Doherty):**
  - The event card gets a large "Reserve seat" button, with a hit area of at least 44px.
  - FR4 requires the credential form, so the detail page keeps it, but the fields are **prefilled and collapsed into a "Booking as {name} · {school}" summary** with an "Edit" link. Booking becomes one tap.
  - An optimistic seat-meter update rolls back on error.
  - A full event shows a "Join waitlist" button in the same spot.
- **Confirmation:**
  - The ticket "prints" in: anticipation (button press squash), then pose-to-pose (stub tears, card lands with follow-through), with confetti-free secondary action (seat icon pop, meter tick).
  - The whole sequence takes about 600ms and is fully skippable.
  - The registration card has a stub and tear line, plus QR, download and add-to-calendar (.ics).
- **Events page (Miller):** events are chunked by "This week / Later", with filter chips instead of the full form (Hick) and skeleton cards while loading.
- **Postel:**
  - Login accepts email in any case with spaces trimmed.
  - Student numbers are normalised.
  - Dates are typed in a forgiving way.
  - Inline validation runs on blur with specific messages.
- **Motion:**
  - GSAP and Lenis are loaded with dynamic `import()` on public pages only.
  - Vanta (with a pinned compatible `three`) runs only in the landing hero and is lazy-loaded. It never runs on admin pages, on screens narrower than 768px, on `pointer:coarse` devices, with `prefers-reduced-motion`, or with Save-Data.
  - React Bits pieces are copied in as source.
  - A global `useReducedMotion` disables Lenis, GSAP timelines and Vanta.
- **Accessibility:**
  - WCAG AA contrast is checked for both themes.
  - Focus is visible.
  - Animated regions use `aria-live`.
  - The skip link stays, focus moves to the main heading on route change, and everything works from the keyboard.
- **Performance:**
  - Route-level `React.lazy`, with the admin pages in their own chunk.
  - `rollup-plugin-visualizer` for bundle size, with a budget of ≤ 180 KB gz initial JS.
  - Lighthouse target ≥ 90 on mobile.
- **CSP:**
  - `script-src 'self'` with no unsafe-inline or unsafe-eval.
  - `connect-src 'self'`, `img-src 'self' data:` (QR), and `worker-src 'self' blob:` only if a library needs it.
  - GSAP and Vanta set styles via the CSSOM, which `style-src` doesn't block.
  - I verify there are no CSP violations in the console.
- **Identity:** the blue accent, Bricolage Grotesque / Figtree and both themes are kept. Empty, error and loading states are improved, and the mobile layout gets a bottom-anchored booking bar on the event detail page.

## Verification (after every phase)
1. `cd backend && npm run migrate && npm run seed && npm start` (locally, or with `docker compose up`), then `npm test`. All of the old 47 tests plus the new ones must pass. CI must also be green.
2. `cd frontend && npm run build`, served by Express on :4000, with a manual end-to-end run in Chrome:
   - register, then log in (2FA for admin)
   - book, cancel, then the waitlist promotion
   - reset password via the console mail log
   - admin CRUD, reports and the audit export
   - check the DevTools console for CSP violations and check cookie flags
3. Phase 3 only: Lighthouse (mobile), the bundle visualizer, a reduced-motion emulation pass, and a keyboard-only pass.
4. After each phase I write a summary: what changed, what isn't done, and what you must configure.

## What you will need to configure (Render env)
- `NODE_ENV=production`
- `APP_URL=https://campusseat.onrender.com`
- `SESSION_SECRET` (≥32 chars)
- `TOTP_ENC_KEY` (32-byte base64)
- `MAIL_DRIVER` + `MAIL_FROM` + either `SMTP_*` or `RESEND_API_KEY` (and a verified sender domain)
- `CANCEL_CUTOFF_HOURS` (optional)
- `TZ_CUTOVER_UTC`, needed once for migration 002
- Health check path set to `/api/ready`
- A pre-deploy command `npm run migrate`, run only after the Aiven backup
- `JWT_SECRET` can be removed after 1.10 if it is unused
