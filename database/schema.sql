-- CampusSeat database schema (MySQL 8 / MariaDB 10.5+, InnoDB so foreign keys are enforced)
-- Matches the Database Schema in docs/. Run: mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS campusseat_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE campusseat_db;

CREATE TABLE IF NOT EXISTS schools (
  school_id   INT AUTO_INCREMENT PRIMARY KEY,
  school_name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  user_id        INT AUTO_INCREMENT PRIMARY KEY,
  full_name      VARCHAR(100) NOT NULL,
  student_number VARCHAR(30)  NOT NULL UNIQUE,
  email          VARCHAR(100) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  school_id      INT NOT NULL,
  role           ENUM('user','admin') NOT NULL DEFAULT 'user',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  event_id    INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(150) NOT NULL,
  description TEXT,
  venue       VARCHAR(150) NOT NULL,
  event_date  DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  capacity    INT NOT NULL CHECK (capacity > 0),
  created_by  INT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_time > start_time),
  INDEX idx_events_date (event_date),
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- An event with NO rows here is open to everyone.
CREATE TABLE IF NOT EXISTS event_schools (
  event_id  INT NOT NULL,
  school_id INT NOT NULL,
  PRIMARY KEY (event_id, school_id),
  FOREIGN KEY (event_id)  REFERENCES events(event_id)   ON DELETE CASCADE,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  booking_id  INT AUTO_INCREMENT PRIMARY KEY,
  booking_ref VARCHAR(20) NOT NULL UNIQUE,
  user_id     INT NOT NULL,
  event_id    INT NOT NULL,
  booked_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, event_id),
  FOREIGN KEY (user_id)  REFERENCES users(user_id)   ON DELETE RESTRICT,
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id    INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NULL,
  action    VARCHAR(100) NOT NULL,
  details   TEXT,
  logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_time (logged_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;
