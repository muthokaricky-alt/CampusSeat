-- 004: lock an account for a while after repeated failed logins.
-- lock_count doubles the next lock (15 min, 30, 60 ... up to 24 h) until a successful login.
ALTER TABLE users
  ADD COLUMN failed_logins INT NOT NULL DEFAULT 0,
  ADD COLUMN lock_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN locked_until  DATETIME NULL;
