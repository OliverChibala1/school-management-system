# School Management System

A full-stack school administration website with learner records, staff access, class and subject registers, attendance, academic results, fee billing and payments, announcements, printable student reports, and a school calendar.

## Quick local run (no downloads)

If npm or PostgreSQL setup is getting in the way, this project includes a dependency-free local edition using Python's built-in server and SQLite. It needs only Python 3.10 or newer.

From the project folder, run:

```bash
python3 standalone/app.py
```

Open **http://127.0.0.1:8000**. The local database is created automatically at `standalone/school.db` and keeps records between runs. First sign-in:

- Email: `admin@school.local`
- Password: `Admin123!Change`

In VS Code you can run **Terminal → Run Task → School Management System: Run (offline, no npm)**. Keep that terminal open while you use the site; stop it with Ctrl+C. This local edition is for a single computer and should not be exposed to the internet. Change the initial password before storing sensitive records.

## Technology

- Website: React, TypeScript, Vite, and CSS
- API: Node.js, Express, and TypeScript
- Database: PostgreSQL
- Login: JWT sessions and bcrypt password hashing

## Automated checks

GitHub Actions runs on pull requests targeting `main`, pushes to `main`, and manual dispatches. It runs the backend role-permission test and backend/frontend production builds. Run the same checks locally with:

```bash
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend run build
```

The current automated test covers which staff roles may see the dashboard fee total. Database-backed API integration tests, frontend component tests, and end-to-end workflow tests are not yet implemented.

## Run it in VS Code

### 1. Install requirements

Install Node.js 20 or newer, PostgreSQL 15 or newer, and the PostgreSQL command line tools (`psql`). Open this project folder in VS Code.

### 2. Create a PostgreSQL database

Start the PostgreSQL service, then create the database using your local PostgreSQL account. For example:

```bash
createdb school_management_system
```

If `createdb` is not available, sign in with `psql` and run `CREATE DATABASE school_management_system;`.

### 3. Configure and create the tables

In the VS Code terminal, from the project folder:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`. Set `DATABASE_URL` to match your PostgreSQL username and password, and replace `JWT_SECRET` with a long private value. The example admin password is for local setup only; change it before creating the administrator.

Create the database tables:

```bash
psql -d school_management_system -f backend/sql/schema.sql
```

On Windows, if `cp` is unavailable, copy `backend/.env.example` to `backend/.env` in VS Code Explorer.

### 4. Install dependencies and create the first administrator

Open a VS Code terminal for the API:

```bash
cd backend
npm install
npm run seed:admin
```

The administrator name, email, and initial password come from `backend/.env`. Use a password with at least 14 characters, including uppercase and lowercase letters and a number.

### 5. Start the website and API

Open two VS Code terminals. In the first:

```bash
cd backend
npm run dev
```

In the second:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open the Vite address shown in the frontend terminal, usually `http://localhost:5173`, and sign in with the administrator credentials from `backend/.env`. The API health endpoint is `http://localhost:4000/api/health`.

VS Code also has a combined run task: open **Terminal → Run Task → School Management System: Run** after completing the database and dependency setup above. The website reads `VITE_API_URL` from `frontend/.env`.

### Existing database

For an existing database from an earlier project version, apply each migration once:

```bash
psql -d school_management_system -f backend/sql/migrations/001_school_events.sql
psql -d school_management_system -f backend/sql/migrations/002_fees.sql
```

### Main workflows

- Add and search learners, assign classes, and archive old records.
- Add staff accounts and activate or deactivate accounts (administrator access).
- Create classes and subjects.
- Record daily attendance as present, absent, late, or excused.
- Enter assessment marks and create printable student reports by term and year.
- Create fee invoices, record partial payments, and see balances. Payments are validated against the remaining amount.
- Draft and publish announcements; add school calendar events.
- Send private one-to-one messages to staff and parent portal accounts.
- Link parent accounts to school-created parent records; parents see their linked learners and published school updates.

## Important setup and use notes

- Use fictional data while setting up and checking the system. Real student data needs school authorization, a privacy review, secure backups, and a properly secured deployment.
- Fees are currently entered as amounts in Zambian Kwacha (ZMW). Confirm the currency and finance rules with the school before use.
- Terms are school-entered labels (for example, `Term 1`). The report page shows recorded marks and attendance; the school must define and approve official grading, promotion, and report-card rules.
- Parent portal registration requires the school to create a parent contact record first. The parent's name, email, and phone must match that record when they register.
- Student sign-in is not implemented. Payroll, transport, and library workflows are also outside the current system.
- The dashboard still contains sample operational insights. Confirm and replace those with school-approved live metrics before relying on them.
- Teacher permissions are not yet restricted to assigned classes or subjects. Keep access limited to trusted staff until class-level authorization is implemented.
- This repository has a CI workflow with a focused backend permission test and production builds, but no database-backed API integration tests, frontend component tests, end-to-end tests, or production hosting configuration yet. A successful build is not a production-readiness or privacy certification.

## Before a real-school deployment

GitHub stores the source code; it does not run the API or PostgreSQL database. A deployment needs a separate managed PostgreSQL database, an HTTPS host for the API, and a static frontend host. Configure `DATABASE_URL`, a unique random `JWT_SECRET` of at least 32 characters, `FRONTEND_ORIGIN` for the deployed website, and the frontend's `VITE_API_URL` for the deployed API. Never commit `.env` files or real student data.

Before loading real records, test parent isolation and every role against the deployed API, set up automated encrypted database backups and a restore drill, confirm local privacy and retention requirements, configure school-approved report-card grading and finance procedures, and train staff using fictional records. The standalone SQLite edition is for one computer only and must not be exposed as the school-wide service.

### Parent register migration

The API creates the parent-register tables automatically when it starts against an existing school database. If you prefer to apply the schema manually first, run:

```bash
psql -d school_management_system -f backend/sql/migrations/003_parents.sql
```

Parent records support multiple linked learners and are saved in the database. New subject and class names are also stored in the school database.
