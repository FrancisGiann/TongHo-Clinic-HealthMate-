# HealthMate+

HealthMate+ is a centralized campus-clinic management system for the Philippine Tong Ho Institute. It supports guardian-led student health records, nurse workflows, administration, guardian appointment requests, clinic records, inventory, deterministic risk indicators, reports, audit logs, email OTP, and in-app notifications. A parent or guardian can verify an email and request a link by submitting the child's name and grade; a student ID is optional. An administrator checks the details and relationship against school records, explicitly selects the verified student record, and approves the account and link. Existing account invitations and all staff invitations remain administrator-managed. Nurses can manage unavailable appointment periods and student incident reports; linked guardians can view incident reports. Incident photos require a separate guardian consent and remain disabled until configured. Administrators manage the application logo, school seal, optional public community photo, and editable landing-page content in **Content management** at `/cms`. Text changes remain private drafts until published; the school seal stays in the public hero. Public photos and text must not contain medical or sensitive student information. Administrators and nurses can save their dashboard widget preferences across devices. Students in Kindergarten through Grade 10 are school-managed patient records and do not have accounts or portal access. A nurse reviews guardian submissions before accepted answers update the clinical profile.

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

Migration `007_self_signup_preferences_audit.sql` adds per-user staff dashboard preferences and the `(created_at, id)` audit-history index. Migration `008_adviser_approval_storage_incidents.sql` adds guardian signup review, appointment availability blocks, dedicated student incidents and consented-image metadata, and fixed-slot branding assets. Migration `009_landing_page_branding_images.sql` adds two public landing-page photo slots; the schema retains both for compatibility, while the active CMS exposes only the community photo because the hero displays the school seal. Migration `010_landing_page_content.sql` adds versioned private drafts and published landing-page copy. Migration `011_guardian_signup_student_hints.sql` adds child details and the explicitly selected student record to guardian signup review; older ID-only requests stay reviewable. Apply pending migrations through the normal reviewed `npm run db:migrate` deployment step after backup and against the intended environment; local development should use a separately provisioned database. Do not run schema migrations blindly against the configured clinic database.

The optional branding and incident images use a private Supabase Storage bucket configured with `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Keep the bucket private and never expose that key to the browser. `INCIDENT_PHOTOS_ENABLED=false` is the default; incident text reports work without photo storage. Review the image consent and defense-retirement policy in [deployment notes](docs/DEPLOYMENT.md) before enabling photos.

Open `http://localhost:5173`. `npm run dev` runs Vite and Express together; Vite proxies `/api` to port 3001.

The first migration creates the administrator defined by `BOOTSTRAP_ADMIN_*`. The password must be at least 12 characters and should be removed from the hosting environment after the account is created.

## Gemini summary demo

The optional Gemini adapter is for fictional local demonstrations only. To enable it, add an AI Studio API key to the ignored local `.env`, set `AI_SUMMARY_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `GEMINI_DEMO_MODE=true`, and `NODE_ENV=development`, then restart the server. Keep `GEMINI_DEMO_MODE=false` everywhere else. The adapter makes no provider request unless both the development environment and explicit demo opt-in are present. If the key or configuration is missing, summaries use the template fallback. See Google's [API key guide](https://ai.google.dev/gemini-api/docs/api-key) and [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).

The Gemini request contains only bounded visit type, complaint, symptoms, treatment, disposition, pain score, temperature, and pulse fields. It omits patient identifiers, notes, risk classifications and rationale, attachments, and unknown nested fields. The gate is an operator-set demo flag; it does not inspect or anonymize encounter text. Complaint, symptom, and treatment text can still identify someone, so send fictional content only. Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms?hl=en) prohibit clinical-practice use and restrict sensitive personal information on unpaid services. Do not enable this integration for real patient records.

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

The Gemini demo mode is an exception intended only for synthetic fictional content. It uses bounded allowlisted fields and requires both `NODE_ENV=development` and `GEMINI_DEMO_MODE=true`; it does not detect or redact identifiers typed into free-text fields. Google API terms do not permit clinical-practice use, so Gemini must remain disabled for real clinical records.

## Deployment

See [Hostinger deployment](docs/DEPLOYMENT.md) and [user guide](docs/USER_GUIDE.md). Never commit `.env`, database passwords, SMTP credentials, or AI keys.

## Password clipboard behavior

Password inputs prevent native copy and cut, including while revealed. Paste,
autofill, selection, focus, and context menus remain available. This is a UI
deterrent, not a security boundary. New password visibility controls must retain
`data-password-field` when changing an input to text. The shared document listeners also cover dynamically added inputs.

Run the clipboard regression tests with `node src/utils/passwordClipboard.test.js`.
