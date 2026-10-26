# CampusSeat Progress and Testing Report

Date: 23 Oct 2026. CampusSeat passes all 47 automated checks and every browser test case below; all five Deliverable 3 checkpoints are met.

## 1. Deliverable 3: progress checkpoints

| Checkpoint | Status | Evidence to show |
| --- | --- | --- |
| Database created | Done | MySQL database campusseat_db with 6 tables (schools, users, events, event_schools, bookings, audit_logs), foreign keys and indexes, created from database/schema.sql |
| Front-end created | Done | React 19 + Vite site: events, event detail and booking form, registration card, My bookings, login, register, forgot password, help, light and dark mode, mobile layout (User Manual figures 1 to 15) |
| Admin panel created | Done | Dashboard, events, bookings, users, reports and audit logs behind an admin role (User Manual figures 16 to 24) |
| Front-end connected to database | Done | The site calls a Node and Express API that reads and writes MySQL with prepared statements |
| Admin panel connected to database | Done | Admins add, edit and delete events, cancel bookings, change roles and download reports; each change appears in MySQL and in audit_logs |

## 2. Automated test results

Running npm test in the backend folder sends real requests to the running API and database: 47 passed, 0 failed.

| Area | Checks | Examples | Result |
| --- | --- | --- | --- |
| Login and sessions | 3 | Admin logs in; wrong password gives 401; /me returns the logged-in user | Pass |
| Registration | 3 | New user registers; duplicate email gives 409; weak password rejected | Pass |
| Access control | 4 | Normal user blocked from admin API (403); anonymous blocked (401); user cannot create events; booking needs login | Pass |
| SQL injection | 4 | Injection in login email and password does not authenticate; search treats % and quotes as plain text | Pass |
| Event validation | 4 | End before start, capacity 0 and past date rejected; capacity cannot drop below booked seats | Pass |
| Event add, edit, search | 4 | Admin creates a 5-seat event, restricts it to one school, edits it; search finds it | Pass |
| Booking rules | 5 | Reference issued; seats left falls to 4; duplicate blocked; wrong school blocked; details must match account | Pass |
| Concurrency | 2 | 25 simultaneous requests for 4 seats: exactly 4 succeed; event ends exactly full | Pass |
| Registration card and My bookings | 3 | Card is a PDF; another user's card is refused; My bookings lists the booking | Pass |
| Reports | 4 | Bookings report as PDF, CSV and JSON; events summary as PDF | Pass |
| Audit log | 1 | The log records who booked | Pass |
| Passwords | 4 | Admin reset gives a temporary password that works; forgot password works with the right student number and fails with a wrong one | Pass |
| Cleanup rules | 6 | Admin sees the event's bookings, cancels one and the seat returns; user with bookings cannot be deleted; deleting an event removes its bookings | Pass |

## 3. User acceptance test cases (browser)

Run end to end in Chromium against the running system on 23 Oct 2026. No unexpected console errors; the only errors came from deliberately invalid input.

| ID | Scenario | Steps | Expected result | Result |
| --- | --- | --- | --- | --- |
| T01 | Guest browses events | Open the home page | Tickets show date, venue, seats left | Pass |
| T02 | Register with empty form | Choose Create account with nothing filled | Messages list every missing field; nothing saved | Pass |
| T03 | Login with wrong password | Enter a wrong password | One general error message, no login | Pass |
| T04 | Student login | Log in as the demo student | Events page with the student's name in the top bar | Pass |
| T05 | Search events | Type "career" | Only matching events remain | Pass |
| T06 | Book a seat | Open Entrepreneurship Talk, confirm booking | Reference shown; card on My bookings | Pass |
| T07 | Restricted event | Open Moot Court Finals as a computing student | Message that the event is for another school | Pass |
| T08 | Full event | Open Open Mic Night (3 of 3 booked) | Message that no seats remain | Pass |
| T09 | Download card | Choose Download PDF | PDF with event, name, reference and QR code | Pass |
| T10 | Help and dark mode | Open Help, switch to dark mode | Page readable; choice remembered | Pass |
| T11 | Mobile layout | Open the site at 390 px wide | No sideways scrolling | Pass |
| T12 | Admin login | Log in as admin | Redirected to the dashboard | Pass |
| T13 | Event form validation | New event, save with empty form | Field messages, nothing saved | Pass |
| T14 | Delete event | Choose Delete on an event | Confirmation window before anything is removed | Pass |
| T15 | Bookings, users, reports, audit | Open each page | Tables fill from the database | Pass |
| T16 | Report PDF | Download the bookings report | PDF with logo, CampusSeat name, date, total, page numbers | Pass |
| T17 | Logout | Choose Log out | Back to the guest view | Pass |

## 4. Security and data integrity

| Marking guide item | How CampusSeat meets it | Verified by |
| --- | --- | --- |
| Password hashing | bcrypt hashes; plain passwords are never stored | Code review of auth routes |
| Prepared statements | Every query uses placeholders (mysql2 execute) | SQL injection tests |
| Access levels | user and admin roles checked on the server for every admin route | Access control tests |
| Login, logout, register, forgot password | All four work; forgot password needs email plus student number | Tests and T02 to T04, T17 |
| Audit logs | Logins, failed logins, bookings, cancellations, event and user changes, report downloads | Audit test and admin audit page |
| No double booking | One database transaction locks the event row, then checks date, duplicate, school and capacity | 25 simultaneous requests for 4 seats gave exactly 4 bookings |
| Brute-force slowing | Login and registration are rate limited | Code review (limit raised in tests only) |
| Browser protections | Helmet security headers with a content security policy; no inline scripts | Page loads with the policy on |
| Input validation | Server checks every field; the form shows the message beside the field | T02, T13 and validation tests |
| Database design | Six tables with primary and foreign keys, indexes and cascade rules | database/schema.sql |

## 5. Known limitations and deployment

- Forgot password checks email plus student number instead of sending an emailed link, because no mail server is set up.
- Optional two-factor login is not built.
- The class diagram differs slightly from the final schema (for example, seats remaining is calculated, not stored).
- Seed events are dated a few weeks ahead of 23 Oct 2026; run npm run seed again if they pass, because past events cannot be created.
- Not tested: heavy load with many hundreds of users, and very old browsers.

Deployment: use one Node host (for example Render or Railway) plus a managed MySQL database. Set the same values as .env (database host, user, password, a new JWT_SECRET, NODE_ENV=production), run the schema file once, run npm run seed once, build the frontend and start the backend. The backend serves the built site, so there is one address to share. If hosting is not possible, demonstrate from a laptop with the Windows steps in the README.
