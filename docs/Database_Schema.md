# CampusSeat: Database Schema

**Database name:** `campusseat_db`
**DBMS:** MySQL (InnoDB engine, so foreign keys are enforced)
**Character set:** `utf8mb4`

**Naming convention:** table names are plural and lowercase (`users`, `events`); column names are lowercase with underscores (`event_date`); primary keys are `<singular>_id`.

| ER entity | Table name |
|---|---|
| School | `schools` |
| User | `users` |
| Event | `events` |
| EventSchool | `event_schools` |
| Booking | `bookings` |
| AuditLog | `audit_logs` |

---

## 1. `schools`

Stores the schools/faculties used for event restrictions and user profiles.

| Column | Data type | Constraints | Notes |
|---|---|---|---|
| `school_id` | INT | **PK**, AUTO_INCREMENT | |
| `school_name` | VARCHAR(100) | NOT NULL, UNIQUE | e.g. School of Computing |

---

## 2. `users`

Stores every account (students, staff and admins).

| Column | Data type | Constraints | Notes |
|---|---|---|---|
| `user_id` | INT | **PK**, AUTO_INCREMENT | |
| `full_name` | VARCHAR(100) | NOT NULL | |
| `student_number` | VARCHAR(30) | NOT NULL, UNIQUE | Also used for staff numbers |
| `email` | VARCHAR(100) | NOT NULL, UNIQUE | Used to log in |
| `password_hash` | VARCHAR(255) | NOT NULL | Hashed password, never plain text |
| `school_id` | INT | NOT NULL, **FK** → `schools(school_id)` | |
| `role` | ENUM('user','admin') | NOT NULL, DEFAULT 'user' | Controls access level |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

---

## 3. `events`

Stores the events that can be booked.

| Column | Data type | Constraints | Notes |
|---|---|---|---|
| `event_id` | INT | **PK**, AUTO_INCREMENT | |
| `title` | VARCHAR(150) | NOT NULL | |
| `description` | TEXT | NULL allowed | |
| `venue` | VARCHAR(150) | NOT NULL | |
| `event_date` | DATE | NOT NULL | |
| `start_time` | TIME | NOT NULL | |
| `end_time` | TIME | NOT NULL | Must be later than `start_time` |
| `capacity` | INT | NOT NULL, CHECK (`capacity` > 0) | Total seats available |
| `created_by` | INT | NOT NULL, **FK** → `users(user_id)` | The admin who created the event |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Table-level constraint:** CHECK (`end_time` > `start_time`)

---

## 4. `event_schools`

Linking table for the many-to-many relationship between events and schools. An event with **no rows** here is open to everyone.

| Column | Data type | Constraints | Notes |
|---|---|---|---|
| `event_id` | INT | **PK (composite)**, **FK** → `events(event_id)` | ON DELETE CASCADE |
| `school_id` | INT | **PK (composite)**, **FK** → `schools(school_id)` | ON DELETE CASCADE |

**Primary key:** (`event_id`, `school_id`), so the same school can't be added twice to one event.

---

## 5. `bookings`

Stores each confirmed seat. This is the main transaction table.

| Column | Data type | Constraints | Notes |
|---|---|---|---|
| `booking_id` | INT | **PK**, AUTO_INCREMENT | |
| `booking_ref` | VARCHAR(20) | NOT NULL, UNIQUE | Printed on the registration card, e.g. CS-2026-00045 |
| `user_id` | INT | NOT NULL, **FK** → `users(user_id)` | |
| `event_id` | INT | NOT NULL, **FK** → `events(event_id)` | ON DELETE CASCADE |
| `booked_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Table-level constraint:** UNIQUE (`user_id`, `event_id`), so a user can't book the same event twice.

---

## 6. `audit_logs`

Records important actions and who performed them.

| Column | Data type | Constraints | Notes |
|---|---|---|---|
| `log_id` | INT | **PK**, AUTO_INCREMENT | |
| `user_id` | INT | NULL allowed, **FK** → `users(user_id)` | ON DELETE SET NULL, so the log survives if a user is removed |
| `action` | VARCHAR(100) | NOT NULL | e.g. LOGIN, BOOK_SEAT, CREATE_EVENT |
| `details` | TEXT | NULL allowed | Extra context about the action |
| `logged_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

---

## Relationships and referential actions

| Parent table | Child table | Foreign key | On delete |
|---|---|---|---|
| `schools` | `users` | `users.school_id` | RESTRICT (a school with users can't be deleted) |
| `users` | `events` | `events.created_by` | RESTRICT |
| `users` | `bookings` | `bookings.user_id` | RESTRICT |
| `events` | `bookings` | `bookings.event_id` | CASCADE (deleting an event removes its bookings) |
| `events` | `event_schools` | `event_schools.event_id` | CASCADE |
| `schools` | `event_schools` | `event_schools.school_id` | CASCADE |
| `users` | `audit_logs` | `audit_logs.user_id` | SET NULL |

---

## Business rules (enforced in the application code)

These can't be fully expressed in the schema, so the backend must enforce them inside one database transaction:

1. **Seat check:** a booking is allowed only if the number of existing bookings for the event is less than `capacity`.
2. **Eligibility check:** if the event has rows in `event_schools`, the user's `school_id` must be one of them. If it has none, the event is open to everyone.
3. **No duplicates:** the unique (`user_id`, `event_id`) constraint rejects a second booking by the same user.
4. **No overbooking under simultaneous requests:** lock the event row (`SELECT ... FOR UPDATE`) inside the booking transaction before counting seats.

**Seats remaining** is calculated, not stored:

```sql
SELECT e.capacity - COUNT(b.booking_id) AS seats_remaining
FROM events e
LEFT JOIN bookings b ON b.event_id = e.event_id
WHERE e.event_id = ?
GROUP BY e.event_id;
```

---

## SQL script (ready to run)

```sql
CREATE DATABASE IF NOT EXISTS campusseat_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE campusseat_db;

CREATE TABLE schools (
  school_id   INT AUTO_INCREMENT PRIMARY KEY,
  school_name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE users (
  user_id        INT AUTO_INCREMENT PRIMARY KEY,
  full_name      VARCHAR(100) NOT NULL,
  student_number VARCHAR(30)  NOT NULL UNIQUE,
  email          VARCHAR(100) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  school_id      INT NOT NULL,
  role           ENUM('user','admin') NOT NULL DEFAULT 'user',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE events (
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
  FOREIGN KEY (created_by) REFERENCES users(user_id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE event_schools (
  event_id  INT NOT NULL,
  school_id INT NOT NULL,
  PRIMARY KEY (event_id, school_id),
  FOREIGN KEY (event_id)  REFERENCES events(event_id)   ON DELETE CASCADE,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE bookings (
  booking_id  INT AUTO_INCREMENT PRIMARY KEY,
  booking_ref VARCHAR(20) NOT NULL UNIQUE,
  user_id     INT NOT NULL,
  event_id    INT NOT NULL,
  booked_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, event_id),
  FOREIGN KEY (user_id)  REFERENCES users(user_id)   ON DELETE RESTRICT,
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  log_id    INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NULL,
  action    VARCHAR(100) NOT NULL,
  details   TEXT,
  logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;
```
