# HealthMate+

HealthMate+ is a centralized campus-clinic management system for the Philippine Tong Ho Institute. It supports guardian-led student health records, nurse workflows, administration, guardian appointment requests, clinic records, inventory, deterministic risk indicators, reports, audit logs, email OTP, and in-app notifications. Students in Kindergarten through Grade 10 are school-managed patient records and do not have accounts or portal access. A nurse reviews guardian submissions before accepted answers update the clinical profile.

## Architecture

- React + Vite frontend
- Express API and production static-file server
- Supabase PostgreSQL through the server only
- Database-backed opaque sessions in secure `HttpOnly` cookies
- Nodemailer SMTP for OTP and invitations
- Provider-neutral AI summary adapter with a deterministic fallback

The browser never receives database credentials and does not authorize itself. Clinical records, accounts, sessions, OTP challenges, role checks, and audit logs are enforced by the server.

## Local setup

Requirements: Node.js 22+, npm, a PostgreSQL/Supabase database, and an SMTP mailbox.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:5173`. `npm run dev` runs Vite and Express together; Vite proxies `/api` to port 3001.

The first migration creates the administrator defined by `BOOTSTRAP_ADMIN_*`. The password must be at least 12 characters and should be removed from the hosting environment after the account is created.

Demo seeding requires `NODE_ENV=development` and explicit opt-in with `SEED_DEMO_DATA=true`; it is disabled in production. On an empty demonstration database, run `SEED_DEMO_DATA=true npm run db:seed-demo`. To add sample records alongside existing clinic data, run `SEED_DEMO_DATA=true npm run db:seed-demo-additive`; it inserts namespaced rows, preserves existing records, and refuses ID collisions. The fixture contains 210 fictional patients, 480 visits, 42 appointments, 34 inventory items, and 120 linked dispense records. It uses reserved `.test` email addresses and non-deliverable contact placeholders, and the command sends no messages.

## Commands

- `npm run dev` — frontend and API development servers
- `npm run db:migrate` — apply pending SQL migrations and bootstrap the first admin
- `npm run db:reset-student-health -- --dry-run` — inspect reset scope on an explicitly marked local disposable database; applying requires a verified backup and one-time confirmation. See [guardian health records](docs/GUARDIAN_HEALTH_RECORDS.md).
- `npm test` — deterministic risk, reporting, and summary tests
- `npm run build` — create the production frontend
- `npm start` — serve the API and built frontend
- `npm run check` — syntax checks, tests, and production build

## Clinical safety boundary

The risk engine is decision support, not diagnosis. The bundled version-0 rules are explicitly demonstration-only. A licensed PTHI clinician must approve and version the actual weighted indicators before production use. Missing required inputs result in an incomplete assessment, and high-risk results require documented nurse acknowledgement.

AI summaries are drafts only. They use a minimum encounter payload without patient names or contact details and must be reviewed by a nurse before being saved. If no AI provider is configured, HealthMate+ produces a deterministic template summary.

## Deployment

See [Hostinger deployment](docs/DEPLOYMENT.md) and [user guide](docs/USER_GUIDE.md). Never commit `.env`, database passwords, SMTP credentials, or AI keys.
