-- 006: optional TOTP two-factor login for administrators.
-- totp_secret_enc: AES-256-GCM encrypted secret (key: TOTP_ENC_KEY, never in the database).
--   Set but totp_enabled_at NULL = setup started, not confirmed yet.
-- totp_last_step: time step of the last accepted code, so a code cannot be replayed.
ALTER TABLE users
  ADD COLUMN totp_secret_enc VARCHAR(255) NULL,
  ADD COLUMN totp_enabled_at DATETIME NULL,
  ADD COLUMN totp_last_step  BIGINT NULL;

-- One-time backup codes (keyed hash only).
CREATE TABLE IF NOT EXISTS backup_codes (
  code_id    INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT      NOT NULL,
  code_hash  CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at    DATETIME NULL,
  UNIQUE KEY uq_backup_code (user_id, code_hash),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Password accepted, waiting for the second factor. Short-lived, limited attempts.
CREATE TABLE IF NOT EXISTS login_challenges (
  challenge_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id        INT      NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     DATETIME NOT NULL,
  attempts       INT      NOT NULL DEFAULT 0,
  INDEX idx_challenges_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
