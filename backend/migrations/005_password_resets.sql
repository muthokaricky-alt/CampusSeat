-- 005: single-use, expiring password reset tokens sent by email.
-- Only sha256(token) is stored, so the table cannot be used to reset anyone's password.
CREATE TABLE IF NOT EXISTS password_resets (
  reset_id   INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  token_hash CHAR(64)     NOT NULL UNIQUE,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  request_ip VARCHAR(45)  NULL,
  INDEX idx_resets_user (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
