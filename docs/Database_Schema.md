# CampusSeat: Database Schema

**DBMS:** MySQL 8 (InnoDB, so foreign keys are enforced). Hosted on Aiven in production.
**Character set:** `utf8mb4`
**Time:** every `DATETIME` is stored in **UTC**. Connections use `time_zone='+00:00'`, and the app converts to and from Africa/Nairobi (UTC+3, no daylight saving) for display. `events.event_date` / `start_time` / `end_time` keep the Nairobi wall-clock values the organiser typed, and `starts_at` / `ends_at` hold the same moments in UTC for comparisons ("has it ended?", "is check-in open?").

**Source of truth:** the numbered migrations in `backend/migrations/` (`001_baseline.sql` to `010_checkin_categories_saved.js`), applied by `npm run migrate`. The runner records each file and its checksum in `schema_migrations` and takes a `GET_LOCK` so two deploys never migrate at once. This document describes the result; to build a database, run the migrations rather than copying SQL from here.

**Naming convention:** table names are plural and lowercase; column names are lowercase with underscores; primary keys are `<singular>_id` where there is a surrogate key.

| ER entity | Table | Added in |
|---|---|---|
| School | `schools` | 001 |
| User | `users` | 001 (lockout 004, 2FA 006) |
| Event | `events` | 001 (UTC times 002, indexes 007, category 010) |
| EventSchool | `event_schools` | 001 |
| Booking | `bookings` | 001 |
| CheckIn | `check_ins` | 010 |
| SavedEvent | `saved_events` | 010 |
| WaitlistEntry | `waitlist` | 008 |
| AuditLog | `audit_logs` | 001 (who/what/where and append-only in 009) |
| Session | `sessions` | 003 |
| PasswordReset | `password_resets` | 005 |
| LoginChallenge, BackupCode | `login_challenges`, `backup_codes` | 006 |

---

## Core tables

### 1. `schools`
The schools and faculties used for user profiles and event restrictions.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `school_id` | INT | **PK**, AUTO_INCREMENT | |
| `school_name` | VARCHAR(100) | NOT NULL, UNIQUE | e.g. School of Computing and Engineering Sciences |

### 2. `users`
Every account: students, staff and administrators.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | INT | **PK**, AUTO_INCREMENT | |
| `full_name` | VARCHAR(100) | NOT NULL | The owner can correct it at any time (Account page) |
| `student_number` | VARCHAR(30) | NOT NULL, UNIQUE | Also used for staff numbers. Stored upper-case. Changing it needs the password |
| `email` | VARCHAR(100) | NOT NULL, UNIQUE | Used to log in; stored lower-case |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt; never plain text |
| `school_id` | INT | NOT NULL, **FK** → `schools` | RESTRICT. Changing it needs the password and no upcoming bookings or waitlist places |
| `role` | ENUM('user','admin') | NOT NULL, DEFAULT 'user' | |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Indexed |
| `failed_logins` | INT | NOT NULL, DEFAULT 0 | Failed sign-ins since the last success |
| `lock_count` | INT | NOT NULL, DEFAULT 0 | How many times the account has locked; each lock doubles (15 min up to 24 h) |
| `locked_until` | DATETIME | NULL | Sign-in refused until this time |
| `totp_secret_enc` | VARCHAR(255) | NULL | Admin two-factor secret, encrypted with AES-256-GCM (`TOTP_ENC_KEY`) |
| `totp_enabled_at` | DATETIME | NULL | Set once the admin confirms a code |
| `totp_last_step` | BIGINT | NULL | Last accepted 30-second step, so a code cannot be replayed |

### 3. `events`
The events that can be booked.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `event_id` | INT | **PK**, AUTO_INCREMENT | |
| `title` | VARCHAR(150) | NOT NULL | |
| `category` | VARCHAR(20) | NOT NULL, DEFAULT 'other' | One of `career`, `talk`, `workshop`, `academic`, `social`, `sports`, `other` (checked by the API). Drives the card colour and cover art. Index `(category, starts_at)` |
| `description` | TEXT | NULL | |
| `venue` | VARCHAR(150) | NOT NULL | |
| `event_date` | DATE | NOT NULL | Nairobi date, as typed |
| `start_time` | TIME | NOT NULL | Nairobi time |
| `end_time` | TIME | NOT NULL | Nairobi time; CHECK `end_time > start_time` |
| `starts_at` | DATETIME | NOT NULL | Same moment in UTC. Indexed |
| `ends_at` | DATETIME | NOT NULL | UTC. Indexed; an event is past when `ends_at < UTC_TIMESTAMP()` |
| `capacity` | INT | NOT NULL, CHECK `capacity > 0` | Cannot be lowered below the seats already booked |
| `created_by` | INT | NOT NULL, **FK** → `users` | RESTRICT |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### 4. `event_schools`
Links events to the schools allowed to book them (many-to-many). An event with **no rows** here is open to everyone.

| Column | Type | Constraints |
|---|---|---|
| `event_id` | INT | **PK (composite)**, **FK** → `events`, ON DELETE CASCADE |
| `school_id` | INT | **PK (composite)**, **FK** → `schools`, ON DELETE CASCADE |

### 5. `bookings`
One row per confirmed seat. Cancelling deletes the row (the audit log keeps the history).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `booking_id` | INT | **PK**, AUTO_INCREMENT | |
| `booking_ref` | VARCHAR(20) | NOT NULL, UNIQUE | Printed on the registration card and in its QR code, e.g. `CS-2026-00045` |
| `user_id` | INT | NOT NULL, **FK** → `users` | RESTRICT |
| `event_id` | INT | NOT NULL, **FK** → `events` | CASCADE |
| `booked_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

UNIQUE (`user_id`, `event_id`): one seat per person per event. Index `(event_id, booked_at)` for per-event lists and seat counts.

### 6. `check_ins` (new in 010)
Records that a booking was used at the door. At most one row per booking, so a card works once.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `booking_id` | INT | **PK**, **FK** → `bookings`, ON DELETE CASCADE | The primary key is what makes a second scan fail |
| `checked_in_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Indexed |
| `checked_in_by` | INT | NULL, **FK** → `users`, ON DELETE SET NULL | The admin at the door |

"Undo" deletes the row. A checked-in booking cannot be cancelled by its owner.

### 7. `saved_events` (new in 010)
A person's bookmarks ("Save for later"). Saving does not hold a seat.

| Column | Type | Constraints |
|---|---|---|
| `user_id` | INT | **PK (composite)**, **FK** → `users`, CASCADE |
| `event_id` | INT | **PK (composite)**, **FK** → `events`, CASCADE; indexed |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

### 8. `waitlist`
Queue for full events. When a seat frees up, the oldest eligible `waiting` entry is booked automatically.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `waitlist_id` | INT | **PK**, AUTO_INCREMENT | Also the queue order |
| `event_id` | INT | NOT NULL, **FK** → `events`, CASCADE | |
| `user_id` | INT | NOT NULL, **FK** → `users`, CASCADE | |
| `status` | ENUM('waiting','promoted','removed') | NOT NULL, DEFAULT 'waiting' | |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| `updated_at` | DATETIME | NULL | |
| `promoted_booking_id` | INT | NULL | The booking created on promotion |

UNIQUE (`event_id`, `user_id`); index `(event_id, status, waitlist_id)` for "next in line".

### 9. `audit_logs`
Who did what, when, from where, and the values before and after. **Append-only:** the triggers `audit_logs_no_update` and `audit_logs_no_delete` reject any UPDATE or DELETE.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `log_id` | INT | **PK**, AUTO_INCREMENT | |
| `user_id` | INT | NULL, **FK** → `users`, ON DELETE SET NULL | The person who acted |
| `actor_email` | VARCHAR(100) | NULL | Snapshot, so the entry still names them after their account is deleted |
| `action` | VARCHAR(100) | NOT NULL | e.g. `LOGIN`, `BOOK_SEAT`, `CHECK_IN`, `CHECK_IN_UNDO`, `PROFILE_UPDATE` |
| `entity_type` | VARCHAR(30) | NULL | `event`, `booking`, `user`, ... |
| `entity_id` | VARCHAR(64) | NULL | |
| `details` | TEXT | NULL | Readable sentence |
| `before_json` / `after_json` | JSON | NULL | Changed values only |
| `ip` | VARCHAR(45) | NULL | Visitor IP (taken from Cloudflare/Render headers) |
| `user_agent` | VARCHAR(255) | NULL | |
| `request_id` | VARCHAR(64) | NULL | Matches the server log line |
| `logged_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

Indexes: `(logged_at)`, `(user_id, logged_at)`, `(action, logged_at)`, `(actor_email, logged_at)`, `(entity_type, entity_id, logged_at)`.

---

## Security tables

| Table | Purpose | Key columns |
|---|---|---|
| `sessions` | Server-side login sessions (httpOnly cookie). Only the SHA-256 of the token is stored. | `token_hash` PK, `user_id` FK CASCADE, `csrf_token`, `idle_expires_at` (2 h sliding), `absolute_expires_at` (7 days), `revoked_at`, `ip`, `user_agent` |
| `password_resets` | Single-use email reset links (30 min). | `reset_id` PK, `user_id` FK CASCADE, `token_hash` UNIQUE, `expires_at`, `used_at`, `request_ip` |
| `login_challenges` | The 5-minute step between password and two-factor code. | `challenge_hash` PK, `user_id` FK CASCADE, `expires_at`, `attempts` |
| `backup_codes` | Ten single-use two-factor backup codes per admin, hashed. | `code_id` PK, `user_id` FK CASCADE, `code_hash` (UNIQUE with user), `used_at` |
| `schema_migrations` | Which migrations ran. | `version` PK, `file`, `checksum`, `baselined`, `applied_at` |

---

## Relationships and referential actions

| Parent | Child | Foreign key | On delete |
|---|---|---|---|
| `schools` | `users` | `users.school_id` | RESTRICT |
| `schools` | `event_schools` | `event_schools.school_id` | CASCADE |
| `users` | `events` | `events.created_by` | RESTRICT |
| `users` | `bookings` | `bookings.user_id` | RESTRICT |
| `users` | `check_ins` | `check_ins.checked_in_by` | SET NULL |
| `users` | `saved_events` | `saved_events.user_id` | CASCADE |
| `users` | `waitlist` | `waitlist.user_id` | CASCADE |
| `users` | `audit_logs` | `audit_logs.user_id` | SET NULL |
| `users` | `sessions`, `password_resets`, `login_challenges`, `backup_codes` | `user_id` | CASCADE |
| `events` | `bookings` | `bookings.event_id` | CASCADE |
| `events` | `event_schools` | `event_schools.event_id` | CASCADE |
| `events` | `saved_events` | `saved_events.event_id` | CASCADE |
| `events` | `waitlist` | `waitlist.event_id` | CASCADE |
| `bookings` | `check_ins` | `check_ins.booking_id` | CASCADE |

---

## Business rules (enforced in the application, inside one transaction)

1. **Seat check:** a booking is allowed only while bookings for the event are fewer than `capacity`.
2. **Eligibility:** if the event has rows in `event_schools`, the person's `school_id` must be one of them.
3. **No duplicates:** UNIQUE (`user_id`, `event_id`) rejects a second booking.
4. **No overbooking under load:** every change to seats takes locks in the same order: the event row (`SELECT ... FOR UPDATE`), then its bookings, then its waitlist. Booking, cancelling, joining the waitlist and raising capacity all follow it.
5. **Cancellation:** owners may cancel until 2 hours before `starts_at` (`CANCEL_CUTOFF_HOURS`), and not after checking in. The freed seat goes to the first eligible person waiting.
6. **Check-in window:** from 3 hours before `starts_at` to 3 hours after `ends_at`. The booking must be for the event chosen at the door. A second scan of the same card is reported as "already checked in", with the time and who scanned it.
7. **Profile changes:** student number and school need the password; the school cannot change while the person holds upcoming bookings or waitlist places (eligibility was checked against the old school).

**Seats remaining** and **attendance** are calculated, not stored:

```sql
SELECT e.capacity - COUNT(b.booking_id) AS seats_remaining,
       COUNT(ci.booking_id)             AS checked_in
FROM events e
LEFT JOIN bookings  b  ON b.event_id    = e.event_id
LEFT JOIN check_ins ci ON ci.booking_id = b.booking_id
WHERE e.event_id = ?
GROUP BY e.event_id;
```
