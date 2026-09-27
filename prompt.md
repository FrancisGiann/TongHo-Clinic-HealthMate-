# HealthMate+ continuation prompt

Continue the active HealthMate+ capstone build in `/home/francisgiann/Giann/Programming/HealthMate+`. Aim for feature completion against the supplied objectives by October 4, 2026. The app is a browser-based PTHI clinic system planned for Hostinger with Supabase PostgreSQL; it is not an offline or single-computer system. Use fictional demo patients only until formal privacy approval. Do not commit or deploy automatically, and preserve all existing dirty work.

**Current scope correction:** PTHI has one school nurse. Health screening, incident reporting, immunization recording, and walk-in queue management are outside the current prototype scope and intended revised proposal scope. Their screens, navigation, exports, reports, and writes have been removed or disabled. Legacy database tables and rows remain untouched; new or changed screening, incident, and immunization writes receive a disabled response, and old queue API calls return a disabled response. The original proposal has not yet been revised and still includes a manual student incident self-report passage; remove that current-feature claim or mark it as future work.

## Agent and design setup

- Root/planning uses GPT-6 Sol; the configured `coder` uses GPT-6 Luna (`/home/francisgiann/.codex/agents/coder.toml`). Follow the root `AGENTS.md`: one coder owns implementation, root reviews; no new packages without explicit user approval.
- The user requested Impeccable for design decisions. The skill was applied to the nurse-first Operate UI. `PRODUCT.md` and `.impeccable/surfaces/src-pages-queue-jsx.md` describe the direction. Desktop/mobile passes and the Impeccable detector have already run on the reviewed surfaces; do not rerun that detector for the same work.
- The user decided nurses are clinical editors and administrators manage access, settings, audit oversight, aggregate reports, and broadcasts. The provided paper still contradicts this and still says local-server hosting. Exact replacement language is drafted in `docs/PAPER_ALIGNMENT.md`; the editable paper itself is not in this repository.

## Implemented before the current hardening pass

- Role-aware student/guardian portal and separate nurse/admin navigation; transactional visits with server risk scoring and stock dispensing; appointments, report snapshots, imports, notifications, risk-rule approval, and AI-assisted summary drafts with nurse review. Queue and immunization workflows are outside scope.
- Snapshot version checks cover supported clinic-data, import, and appointment writes. The browser data hook guards queued edits against a reload using an older snapshot.
- Automatic reminder sweep covers dated follow-ups, recurring visits, and pending consent forms. Immunization reminders are disabled. Scheduling is production-only and opt-in (`CLINIC_REMINDER_SCHEDULER_ENABLED=true`) with DB and SMTP configured. No production deployment or SMTP delivery test has occurred.
- Appointment choices are ranked from recent same-weekday clinic traffic when enough data exists, while all free future slots remain selectable. The UI is date-first and does not claim AI generates these rankings.
- A nurse-only consent-tracking update and an administrator clinic-notice form are implemented. Notice retry keys are scoped per administrator. No broadcast was sent during browser QA.

## Current hardening state

An independent reviewer found no P0 issue and seven P1/P2 issues. The coder completed the four P1 fixes, then stopped safely for this handoff:

1. `useClinicData` now starts with empty data and `App` gates display until data for the current account loads, preventing a prior role's in-memory data from flashing after account switch. `src/db/database.js` returned fictional seed fixtures, not localStorage data, despite its old comment.
2. Normal `PUT /api/data` syncs roster data; visits, appointments, and inventory use dedicated endpoints. Screening and incident collections are not returned by the normal clinic-data API and are not synced. Historical table rows remain preserved, and changed workflow writes are rejected. Internal demo seeding no longer syncs those retired collections.
3. Appointment PATCH now reads, validates, and updates the row inside one locked transaction with audit. A live database race test remains to be done.
4. Administrator audit-log details now use an event-specific allowlist, excluding clinical triage and override narratives.

The coder added focused snapshot and audit tests. The latest `npm run check` passed **15/15 test files plus the Vite production build**, and `git diff --check` passed. No commit was made.

Remaining P2 work:

1. Admin reports still reveal small-cohort complaint/treatment categories. Suppress sensitive small cells while nurses retain clinical detail, including saved report snapshots.
2. Build dedicated nurse inventory create/update/stock-adjustment/archive endpoints; wire the existing Inventory UI, make archive persistent, and prevent archived medicine from dispensing. The bulk-sync restriction above currently makes inventory edits non-persistent.
3. Concurrent risk-rule approvals can both report success. Serialize and recheck draft/current-rule state inside the transaction.

Also review whether the roster bulk save may bypass consent-field validation by modifying patient JSON directly. Keep the nurse/admin role decision above while fixing remaining issues.

## Verification and next steps

1. Read `git status --short`; do not discard or reset dirty files. Prioritize restoring inventory through safe dedicated endpoints, then address the other P2 findings. Run `npm run check` and `git diff --check` after fixes.
2. Review the completed P1 fixes, especially server-side exclusion of guarded collections from bulk sync and cross-account render gating. Add focused tests where meaningful.
3. Live-test nurse, administrator, student/guardian flows using only fictional demo records. A read-only Supabase count confirmed exactly five patient IDs matching the seed fixtures. The user has been asked whether to create and clean up a temporary nurse test account or whether they will sign in to an existing nurse account; check for their reply before changing access. Browser admin screens and the new notice form were visually checked at desktop/phone widths, without sending notices. A transient DB connection timeout on first local load cleared on retry; investigate if reproducible.
4. Keep deployment and final paper insertion for after feature verification. The paper-alignment draft covers hosting, role access, and AI/scheduling wording. The actual editable paper is not present in the repo.

No secrets, account passwords, or personal email addresses should be copied into future prompts or reports.
