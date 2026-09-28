# Guardian-led student health records

## Workflow and ownership

Student accounts are not part of the online workflow. Students from Kindergarten through Grade 10 are school-managed patient records. An administrator imports or registers a minimal roster with student ID, name, grade, section, and adviser, then links guardian accounts to the student. Only a linked guardian can save a draft or attest to and submit the online health record.

Student identity and class placement are read-only in the guardian form. Age is derived from the date of birth. Blood type is optional. The guardian form captures the health and family fields represented on the paper record, including separate home medication names, illness history, skin and eye disorders, therapy/intervention occasions, and a distinct unknown state for yes/no questions. Blank allergies, conditions, or medications remain unknown; the guardian can explicitly select “none reported” to clear a previously accepted answer.

Guardian drafts are scoped by patient, guardian, and school year. Draft writes use an expected version and return a conflict when another session has saved a newer version. Submissions carry a guardian attestation and an increasing revision; identical answers can be renewed in a later school year, and the guardian view marks a prior-year record as due. Pending answers remain separate from the patient profile. Only the school nurse can accept a valid submission, request changes, record clinic document receipt, or transcribe a paper record. Nurse feedback stored on a submission is visible to the guardian and is used for change requests; it is not a private clinical note. Acceptance projects the new answers into the patient’s canonical health profile, supersedes older pending revisions, and is serialized by locking the student record so a stale submission cannot overwrite a newer accepted revision. Paper transcription stores presence-only guardian/student signature metadata; it does not capture signature images or claim online student consent. A paper submission cannot be accepted unless the guardian signature was marked present. The nurse review screen separates guardian-reported document submission from nurse-verified receipt.

Students can request appointments online only through an authenticated guardian account. Nurses manage appointment scheduling and status. Visit records and other nurse-only clinical data continue through the existing visit workflow.

## Access and API outline

- `GET /api/guardian/health-records`: current roster identity, guardian’s draft, accepted answers, and submission history for every linked student.
- `PUT /api/guardian/health-records/:patientId/draft`: guardian-only, patient-link checked, versioned draft save.
- `POST /api/guardian/health-records/:patientId/submit`: guardian-only, requires the expected draft version and records the server-side attestation.
- `GET /api/nurse/health-record-submissions`: nurse-only pending review queue; `history=true&offset=N` pages accepted/superseded history.
- `POST /api/nurse/health-records/:patientId/transcribe`: nurse-only paper transcription with explicit signature-presence metadata.
- `POST /api/nurse/health-record-submissions/:id/review`: nurse-only accept/request-changes action with optimistic version checking and nurse-owned document receipt status.
- `PATCH /api/admin/users/:id/patient-link`: administrator-only, links a guardian account to an existing student patient. Reactivating a suspended guardian remains a separate action and is rejected until a student link exists.

The `004_guardian_health_records.sql` migration creates draft/submission storage, deactivates legacy student accounts, removes their patient login links and sessions, and invalidates outstanding student invitations. It leaves audit history in place. The API, authentication middleware, route configuration, navigation, invitations, notices, and broadcast recipients no longer expose a student portal. The existing database role constraint retains `student` only so legacy accounts can be preserved in a deactivated state.

## Notice and launch review

The online guardian attestation says that the signer is the student’s parent or legal guardian, that the answers are accurate to the best of their knowledge, and that the nurse reviews them before they update the student health profile. The privacy notice explains the school health-support purpose and directs emergencies away from the form. The nurse review page displays **Review before live use**. The school must approve the notice and paper workflow before live use; the banner is not evidence of approval.

## One-time student health reset

The utility in `server/reset-student-health-data.js` defaults to a read-only dry run. `HEALTHMATE_RESET_DISPOSABLE=true` permits only localhost databases whose database name has a `healthmate` or `hm` prefix and a `reset` or `disposable` suffix. A deliberately reviewed target can instead be named by the exact fingerprint `host:port/database` in the JSON array environment variable `HEALTHMATE_RESET_ALLOWED_TARGETS`. Credentials are excluded from that fingerprint. An apply requires both `--apply --backup-confirmed` and a non-empty `HEALTHMATE_RESET_BACKUP_REFERENCE`; an audit event prevents a second reset on the same database.

The dry-run counts student profiles, linked guardians, visits, appointments, queue entries, screenings, immunizations, incidents, risk assessments, dispense logs, health-record drafts/submissions, import batch items, report snapshots, and student-linked notifications. Apply removes student patient rows and dependent student clinic records, related import references, all derived report snapshots, and notifications whose metadata identifies a student patient or whose recipient is a legacy student account. It suspends linked guardian accounts and deletes their sessions; deleting student rows removes their links, so an administrator must relink each guardian and then restore the account separately. It preserves staff and guardian account rows, faculty patient rows, clinic settings, inventory, and existing audit events, and appends a reset audit event.

Example disposable-database verification commands:

```sh
HEALTHMATE_RESET_DISPOSABLE=true npm run db:reset-student-health -- --dry-run
HEALTHMATE_RESET_DISPOSABLE=true \
  HEALTHMATE_RESET_BACKUP_REFERENCE=verified-disposable-backup \
  npm run db:reset-student-health -- --apply --backup-confirmed
```

The apply command is documented for a separately provisioned disposable database only. Do not run it against the configured real database as part of code verification. Reset tests use an in-memory query stub and do not connect to PostgreSQL.
