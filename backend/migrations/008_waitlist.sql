-- 008: waitlist for full events. People are promoted in the order they joined (waitlist_id),
-- inside the same locked transaction that frees the seat, so the event can never be overbooked.
CREATE TABLE IF NOT EXISTS waitlist (
  waitlist_id         INT AUTO_INCREMENT PRIMARY KEY,
  event_id            INT      NOT NULL,
  user_id             INT      NOT NULL,
  status              ENUM('waiting','promoted','removed') NOT NULL DEFAULT 'waiting',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NULL,
  promoted_booking_id INT      NULL,
  UNIQUE KEY uq_waitlist_person (event_id, user_id),
  INDEX idx_waitlist_queue (event_id, status, waitlist_id),
  INDEX idx_waitlist_user (user_id, status),
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(user_id)  ON DELETE CASCADE
) ENGINE=InnoDB;
