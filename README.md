# CampusSeat

Web system for reserving seats at university events. Students and staff browse events and book a seat online. Admins create events, limit them to schools, and see bookings, reports and audit logs. Software Engineering project, Group 4.

## Stack and why

| Part | Choice | Why |
| --- | --- | --- |
| Database | MySQL (`campusseat_db`) | Matches the group's schema. InnoDB enforces foreign keys and gives row locks for safe booking. |
| Backend | Node.js, Express | Same JavaScript on both sides. Prepared statements (`mysql2`), `bcryptjs` hashing, JWT login, `pdfkit` for cards and reports. |
| Frontend | React, Vite, React Router | Component and page structure, fast builds. Light and dark theme through CSS custom properties. |

## What is built (mapped to the marking guide)

| Marking item | Where |
| --- | --- |
| Front-end, admin panel, database, both connected | `frontend/`, `frontend/src/pages/admin/`, `database/schema.sql` |
| Main transaction (booking) | `backend/src/routes/bookings.js`: one transaction, locks the event row, checks duplicate, school eligibility and capacity |
| Levels of access, login, logout, register, forgot password | `backend/src/routes/auth.js`, `middleware/auth.js`; admin can also reset passwords |
| Add, edit, delete, browse and search | Events (admin), users, bookings; search and filters on events, bookings, users, logs |
| Reports with date, name and filters | Admin > Reports: PDF and CSV, filter by date, event, school, sort |
| Audit logs | Every login, booking, event change, reset and report is recorded with who and when |
| Security | Hashed passwords, prepared statements, login rate limits, role checks on every admin route, security headers |
| Validation and error messages | Server rules in `utils/validate.js`; field-level messages in every form |
| Help facilities | Help page in the app |
| Registration card | PDF with QR code, plus on-screen card |

## Run it on Windows

1. Install Node.js (LTS) and MySQL Server 8. Remember the MySQL root password.
2. Create the database and tables. In PowerShell, from the project folder:

```
mysql -u root -p -e "source database/schema.sql"
```

3. Backend settings. Copy the example file and edit the values (use `root` and your MySQL password for `DB_USER` and `DB_PASSWORD`, and paste a long random string as `JWT_SECRET`):

```
cd backend
copy .env.example .env
notepad .env
```

4. Install, add starter data, and start the API:

```
npm install
npm run seed
npm start
```

5. In a second PowerShell window, build the frontend:

```
cd frontend
npm install
npm run build
```

6. Open http://localhost:4000. The backend serves the built frontend.

For development with live reload, run `npm run dev` in `frontend` and open http://localhost:5173.

Demo accounts (created by `npm run seed`; change them before real use):

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@campusseat.local | Admin@12345 |
| Student | student@campusseat.local | Student@12345 |

## Tests

With the API running and seeded:

```
cd backend
npm test
```

47 checks cover login, access control, SQL injection attempts, event rules, booking rules, 25 simultaneous requests for 4 seats (exactly 4 succeed), PDFs, reports, audit logs and password reset.

## Folders

```
backend/    Express API (routes, middleware, PDF utilities, seed and test scripts)
frontend/   React app (pages, admin pages, components, theme)
database/   schema.sql
docs/       requirements, schema, diagrams, UI mockups
```

## Team

| Member | Part |
| --- | --- |
| Edenmike Mwaura Ruhanga | Frontend |
| Uthman Salyani | Backend |
| Rick Kyalo | Documentation, diagrams and mockups |

## Notes

- Never commit `backend/.env`. It holds your database password and JWT secret.
- Forgot password confirms the account with email and student/staff number. A production system would email a reset link instead.
