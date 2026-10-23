# Deployment readiness: Hostinger Business or Cloud + Supabase

Hostinger documents Node.js web-app support on Business and Cloud plans. HealthMate+ uses that application hosting for its React/Express app and an external Supabase PostgreSQL project for persistent data. Hostinger does not provide managed PostgreSQL on these plans; using PostgreSQL managed directly by Hostinger would require a VPS, which is outside this deployment target. Confirm current plan limits with [Hostinger's Node.js deployment guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [Supabase connection guide](https://www.hostinger.com/support/connecting-a-supabase-database-to-a-hostinger-node-js-application/), and [server capabilities list](https://www.hostinger.com/support/which-server-capabilities-are-supported-at-hostinger/).

No production deployment, migration, email delivery, scheduled-job reliability, or clinical workflow is claimed as verified by this repository.

## 1. Prepare a separate production database

1. Create a new Supabase project reserved for production. Do not promote or reuse the current development project.
2. Confirm the production database has no fictional development accounts ending in `.test` and no `public.dev_role_account_seed_registry` table. The server refuses production startup if either is present.
3. Configure the pooled PostgreSQL connection string and verified TLS in Hostinger. Keep `DB_SSL=true` and `DB_SSL_REJECT_UNAUTHORIZED=true`; provide the provider CA file with `DB_SSL_CA_FILE` when required. Remove `sslmode`, `sslrootcert`, `sslcert`, and `sslkey` query parameters from `DATABASE_URL`, because node-postgres URL SSL options replace the Pool `ssl` object. See the [node-postgres SSL configuration guide](https://node-postgres.com/features/ssl).
4. Set unique `BOOTSTRAP_ADMIN_*` values through Hostinger's secret configuration. Apply `npm run db:migrate` against production from a trusted deployment shell before starting the new app version. Remove `BOOTSTRAP_ADMIN_PASSWORD` after the administrator exists.
5. Do not run demo or development-account seed commands against production. The dev-account preflight is a safety check, not a migration or cleanup command.

Migrations create the schema only. No actual school paper records or authorized source dataset were available for migration. Historical import stays available for a future dataset only after PTHI authorization, privacy review, field mapping, duplicate policy, backup, and nurse-reviewed staging rehearsal. A launch may use newly entered, consented records and fictional staging data; that does not establish a legacy migration.

Migration `007_self_signup_preferences_audit.sql` creates staff dashboard preference storage and adds the audit keyset index. Migration `008_adviser_approval_storage_incidents.sql` adds pending guardian signup review, appointment-unavailable periods and decision reasons, dedicated student-incident records, consent and durable photo-deletion metadata, and two fixed branding-image slots. Migration `009_landing_page_branding_images.sql` extends the schema with optional public landing-page hero and community photo slots. Both slots remain backend-supported for compatibility, while the active CMS exposes only the community photo because the public hero displays the school seal. Migration `010_landing_page_content.sql` adds versioned private draft and published landing-page copy. Apply pending migrations with `npm run db:migrate` during the reviewed deployment process, after a backup and against the intended environment. Migration 010 was not applied during this change.

## 2. Configure the Hostinger Node.js app

- Plan: Business or Cloud with Node.js web-app support
- Runtime: Node.js 22.x
- Build: `npm ci && npm run build`
- Start: `npm start`
- LiteSpeed/Hostinger application entry file: `server.cjs` (for hosts that load the entry with `require()`). This launcher dynamically imports `server.js`, preserving its production checks and scheduler flags. A rejected startup prints an allowlisted diagnostic code and exits with status 1 without logging the underlying error. Codes identify production configuration guards, development seed data, module/file loading, network/TLS failures, and PostgreSQL authentication/schema/permission failures; unknown errors produce `UNCLASSIFIED_STARTUP_FAILURE`. Network codes identify the failure category, not a verified cause. Do not disable production guards to resolve a code. Direct `npm start` remains supported.
- Port: use Hostinger's injected `PORT`
- Environment: set `NODE_ENV=production`, `APP_URL=https://your-domain.example`, and `COOKIE_SECURE=true`
- Proxy: set `TRUST_PROXY_HOPS` only after Hostinger confirms the exact trusted proxy hop count. The default `0` ignores forwarded addresses. Verify `req.ip` in a staging deployment before relying on IP throttles; do not trust client-supplied `X-Forwarded-For` values.

Add the required database and SMTP variables from `.env.example` in hPanel. Do not upload a local `.env` file. Production startup fails closed if `DATABASE_URL`, verified PostgreSQL TLS, SMTP configuration, SMTP certificate verification, or the development-seed check is missing or unsafe.

## 3. Private branding and incident images

Custom branding images and optional incident photographs use the same configured Supabase Storage bucket, but the server confines them to separate `branding/` and `incidents/` key prefixes. Create a **private** bucket with no public read access, and configure `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`, and `SUPABASE_SERVICE_ROLE_KEY` in the server environment. The service-role key must remain server-only and must never be sent to the browser. The API streams authorized incident photos through the server after checking the current student link, incident consent event, deletion state, and expiry; it does not create reusable public image URLs.

Incident text reports work independently of image storage. Photo upload, display, and consent controls are disabled unless `INCIDENT_PHOTOS_ENABLED=true`; keep the default `false` until the private bucket, access controls, school consent notice, and retention process have been reviewed. The flag does not disable incident text or branding. Missing storage configuration keeps custom image uploads unavailable and falls back to the bundled application logo and school seal; the community section uses its bundled illustration when no photo is configured. The administrator-only `/cms` page manages the application logo, school seal, optional public community photo, and landing-page copy. Copy is saved as a versioned private draft and becomes public only when an administrator publishes it; `/landing-preview?preview=draft` requires an administrator session. The school seal remains in the landing-page hero. Public announcements are filtered by their start and expiry instants, and public photos appear without authentication: upload only school-approved images and never upload medical records or sensitive student information. Configure clinic details and announcements only from school-approved information; blank sections remain omitted from the public page.

An incident photo is blocked immediately when consent is declined or revoked, when its incident consent changes, when deletion is requested, or at its one-year expiry. The hourly cleanup worker queues expired images and retries storage deletions using durable tasks; cleanup failures do not restore access. After the school-approved defense process ends, the institution must manually disable `INCIDENT_PHOTOS_ENABLED`, review the dry run, then explicitly queue and delete remaining incident photos. The CLI is limited to incident-image keys; it does not delete branding assets, incident text, or audit history. No defense end date is scheduled or assumed, and no cleanup is run during development verification.

The cleanup command defaults to a read-only count. To preview the defense-retirement scope, run:

```sh
node server/cleanup-incident-photos.js --defense-ended
```

Only after the approved defense has ended, with `INCIDENT_PHOTOS_ENABLED=false`, a verified backup, and the exact configured private bucket name, run:

```sh
node server/cleanup-incident-photos.js --defense-ended --apply --bucket healthmate-private --confirm-incident-photos
```

Replace `healthmate-private` with the exact value configured in `SUPABASE_STORAGE_BUCKET`. The command rejects unknown arguments, an enabled photo flag, a bucket mismatch, or missing confirmation. Failed object removals stay queued for retry; inspect the result counts and server’s sanitized error codes without copying credentials or storage URLs into logs.

## 4. Email verification and security checks

Production always requires email OTP at sign-in; there is no per-account MFA switch. OTP, invitations, password resets, and notices require working SMTP. Non-implicit SMTP connections require STARTTLS, and certificate verification must remain enabled in production. For Hostinger SMTP on port 587, leave `SMTP_SECURE=false` so STARTTLS is required; use implicit TLS only when the selected provider documents it. `REQUIRE_LOGIN_OTP=false` is accepted only when `NODE_ENV=development`. The app does not simulate email delivery. See Nodemailer's [SMTP TLS options](https://nodemailer.com/smtp).

Before opening access, use fictional staging accounts and test a delivered OTP, invalid and expired codes, password reset, login throttling, session idle expiry, 12-hour absolute expiry, three-session cap, per-session revocation, and sign-out-everywhere. Verify that account/session APIs return only the signed-in user's sessions. Check `/api/health` for configuration, then send and receive an actual staging email; a `configured` health value does not prove delivery.

Session policy is server-enforced: 15 minutes idle, 12 hours absolute, and at most three active sessions per account. “Keep me signed in” creates a persistent cookie only up to that same 12-hour limit; it is not trusted-device recognition. Failed-password counters are durable in PostgreSQL. The additional IP throttles are in-memory per app process and are supplemental; they do not replace the durable counter or provider edge protections and may not be shared across app instances.

## 5. Verify background work on the selected plan

Reminder and report-archive schedulers run inside the persistent `npm start` process. Hostinger documents server capabilities by plan, but this repository has not verified that the selected Business or Cloud process stays alive long enough for the configured intervals or restarts cleanly after deployment. Verify process persistence, restart behavior, logs, time zone, and duplicate handling in staging before enabling either scheduler. Do not treat in-process timers as a reliable cron service.

Reminder and report-archive schedulers are disabled by default. Only enable `CLINIC_REMINDER_SCHEDULER_ENABLED=true` after SMTP and delivery behavior pass staging checks. Only enable `REPORT_ARCHIVE_SCHEDULER_ENABLED=true` after migration, retention approval, and staging checks for daily, weekly, monthly, and duplicate snapshots. Incident-image cleanup and expired signup-code metadata cleanup start only when a database is configured; verify their retry behavior and process persistence in staging. No past report history is synthesized.

## 6. Production verification record

Record the selected Hostinger plan, runtime version, Supabase project identity, migration versions, database TLS result, SMTP test result, trusted proxy hop count and observed `req.ip`, session/OTP checks, backup/restore rehearsal, and scheduler persistence results before claiming launch readiness. Confirm the production project is separate from development and contains no seeded development account identities or registry. Keep live patient records out of development screenshots and automated tests.

## First-deployment cleanup switches

Set all four server environment flags before starting the deployment:

```env
GUARDIAN_SIGNUP_OTP_CLEANUP_ENABLED=false
INCIDENT_PHOTO_CLEANUP_ENABLED=false
CLINIC_REMINDER_SCHEDULER_ENABLED=false
REPORT_ARCHIVE_SCHEDULER_ENABLED=false
```

The first two switches prevent both the initial cleanup run and subsequent interval registration. Restart the application after changing them. Omission preserves the previous cleanup behavior when a database is configured; explicitly set `false` for the first deployment. They do not disable normal request-driven signup validation, consent handling, or explicitly invoked cleanup CLI commands. `INCIDENT_PHOTOS_ENABLED=false` alone does not disable cleanup. Review pending deletions and retention separately before enabling either cleanup job. No schema change is needed.
