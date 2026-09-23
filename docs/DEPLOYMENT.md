# Hostinger Business/Cloud + Supabase deployment

## 1. Database

1. Create a Supabase project and copy its pooled PostgreSQL connection string.
2. Download the database CA certificate from Supabase **Database Settings → SSL Configuration**.
3. Include `certificates/prod-ca-2021.crt` in the deployed project and set `DATABASE_URL`, `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=true`, and `DB_SSL_CA_FILE=certificates/prod-ca-2021.crt` in Hostinger.
4. Set strong one-time `BOOTSTRAP_ADMIN_*` values.
5. Run `npm run db:migrate` from a trusted deployment shell or locally against the production database.
6. Remove `BOOTSTRAP_ADMIN_PASSWORD` after the administrator exists.

## 2. Hostinger Node.js application

Use a Hostinger Business or Cloud plan with Node.js web-app support.

- Repository: this project
- Node.js: 22.x
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Application port: use Hostinger's injected `PORT`
- Domain: set `APP_URL=https://your-domain.example`
- Production flags: `NODE_ENV=production`, `COOKIE_SECURE=true`

Add the PostgreSQL, SMTP, and optional AI variables from `.env.example` in hPanel. Do not upload the local `.env` file.

## 3. Email and activation

Configure a Hostinger mailbox or another SMTP provider. Account invitations, OTP login, and password reset require working SMTP. Test `/api/health`; it reports database and email configuration without exposing secrets.

## 4. Automatic clinic reminders

Automatic reminders are disabled by default. To enable them, set `CLINIC_REMINDER_SCHEDULER_ENABLED=true` only with `NODE_ENV=production`, a configured database, and working SMTP. The persistent `npm start` process runs the first sweep after `CLINIC_REMINDER_INITIAL_DELAY_MS` (30 seconds by default), then every `CLINIC_REMINDER_INTERVAL_HOURS` (24 hours by default). Development never starts the scheduler; administrators can still use the explicit manual trigger.

The new-visit form requires an explicit follow-up date when follow-up is selected; the server accepts only a valid calendar date that is today or later in Asia/Manila. Legacy follow-up records without a valid `followUpDate` are skipped rather than treated as due on their visit date. Follow-up reminders include the saved date; recurring-visit review reminders are deduplicated monthly. Reminder notification keys are unique in PostgreSQL, preventing duplicate sends for the same patient and reminder across overlapping jobs or app instances. Each instance still scans and audits the sweep; SMTP failures after acceptance can have ambiguous delivery and are not automatically retried.

## 5. Deployment verification

1. Run migrations before starting a new schema version.
2. Confirm `/api/health` returns `database: connected`.
3. Sign in as the bootstrap administrator and send a test invitation.
4. Verify student and guardian accounts see only linked patients.
5. Confirm unauthorized `/api/admin/*` requests return 403.
6. Generate and save a report snapshot.
7. Export a JSON/CSV backup and verify the database provider's automated backup policy.

For PostgreSQL on Hostinger managed Web/Cloud, use an external provider such as Supabase. Direct Hostinger PostgreSQL requires a VPS.
