-- 003: server-side login sessions (replace the JWT kept in localStorage).
-- The browser holds a random 256-bit token in an httpOnly cookie; only its SHA-256 is stored here,
-- so a leaked database copy cannot be used to log in. Revoking a row ends that login immediately.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash          CHAR(64)     NOT NULL PRIMARY KEY,
  user_id             INT          NOT NULL,
  csrf_token          CHAR(64)     NOT NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idle_expires_at     DATETIME     NOT NULL,
  absolute_expires_at DATETIME     NOT NULL,
  revoked_at          DATETIME     NULL,
  ip                  VARCHAR(45)  NULL,
  user_agent          VARCHAR(255) NULL,
  INDEX idx_sessions_user (user_id, revoked_at),
  INDEX idx_sessions_expiry (absolute_expires_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
