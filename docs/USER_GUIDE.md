# HealthMate+ user guide

## Administrator

- Sign in with password and the emailed one-time code.
- In **Settings → User management**, invite administrators, nurses, or guardians. To invite a student, first confirm a linked guardian has granted scheduling permission. Choose **Invite student**, select the roster record, re-enter the displayed student ID, and enter the student email. Previously active or invited students remain inactive until this fresh identity-checked invitation is sent. Do not use the generic account activation control to restore student access.
- Guardians may submit a registration request from the sign-in page after verifying their email and providing the child's name and grade; section and student ID are optional. Review the submitted details against school records and explicitly select the verified student roster record. A unique student ID match may be suggested, but it is never selected automatically. If the student has no roster record, staff must create one from verified school records before approval. Verify the relationship before approving; only approval creates an active account and student link. Existing invited guardians should activate the school invitation instead; staff invitations remain administrator-managed.
- Administrators: open **Content management** in the sidebar to edit landing-page text and school identity images. In **Landing page content**, edit the hero, approved clinic information, announcements, and FAQs; save a private draft, preview the saved draft, then publish it when ready. Announcement start and expiry use Philippine time. Changes conflict safely if another administrator saves first; reload the saved version only when you want to discard your local edits. In **School identity and images**, upload, preview, save, cancel, or reset the application logo, school seal, and optional community photo. The school seal appears in the landing-page hero; the community photo appears beside the community section. Images publish when saved, independently of the text draft. Upload only school-approved public images; do not upload medical records or sensitive student information. Private image storage must be configured before custom images can be saved.
- A guardian invitation must link to an existing student roster record. Use **Link student** to restore a guardian link after a controlled reset, then activate the guardian separately. Revoking student scheduling permission, unlinking its grantor, or disabling student access invalidates student sessions and invitations.
- Import only student ID, name, grade, section, and adviser. Kindergarten and Grades 1–10 are supported. Guardian contact details and health answers belong in the guardian-reviewed health record. **Data & Imports** is for roster setup and authorized data loading; **Reports** is for clinic oversight and aggregate reporting.
- Review audit events, account status, clinic settings, and backups. Risk Rules pages have been retired; old visits retain any historical scores for report compatibility.

## Nurse

- Register student roster records or update patient profiles. Student identity and grade placement come from the school roster.
- Review **Health record review** submissions before accepting any answers into the clinical profile. Feedback entered with a submission is visible to the guardian; use it for change requests, not private clinical notes. Accepted answers, including explicit “none reported” selections, become the current clinical profile; drafts and pending submissions stay separate.
- For paper forms, transcribe the answers and record only whether guardian or student signatures were present. A paper submission cannot be accepted unless the guardian signature is marked present. Do not scan or attach paper forms. Record clinic document receipt separately from the guardian’s report of submitted documents.
- Record visits using the paper nurse-log fields: complaint or illness, clinic date, remarks, and signed-in nurse attribution. Record vitals, treatment, disposition, and an explicit warning-sign assessment; an urgent warning sign requires documented action. Manage **Clinic scheduling**, medicine dispensing, and stock. Block full or partial clinic periods only after resolving overlapping requested or scheduled appointments. Rejection and cancellation decisions require a reason, which is shown to linked guardians.
- Create and maintain student incident reports under **Incidents**. Linked guardians can view the text for their linked students. Admin users can review operational audit events but do not receive incident clinical details or photos.
- Automated scoring and Risk Rules management are retired. Health screening remains unavailable; earlier screening data is retained but not shown in the app, reports, or exports.
- Generate daily, weekly, monthly, or custom reports and save snapshots.

## Guardian

- Submit a parent or guardian account request from the sign-in page with your child's name and grade. Section and student ID are optional. Verify your email; an administrator will check the details against school records, select the verified student roster record, and confirm your relationship. Your account and link become active only after approval; you can then sign in with the password you registered. If the school has already sent you an invitation, activate that invitation instead.
- Alternatively, activate the emailed invitation after the school links your account to a student record.
- Sign in with password and email one-time code. A guardian can access only linked student records.
- Open **Health record** to save a draft, update it, and submit it with the guardian attestation. The school nurse reviews the submission before it updates the clinical profile. You can submit updates at any time and renew information each school year.
- The form prefills student ID and class placement from the school roster. Age is calculated from date of birth; blood type is optional. Blank answers mean unknown. Select “No … reported” only when none is reported.
- Request an appointment for a linked student and monitor its status. Contact the clinic directly for urgent or emergency concerns; online scheduling is not an emergency service.
- Under **Student scheduling permission**, allow or revoke appointment requests for each linked student. Only the guardian who granted permission can revoke it. Revocation disables that student account and ends its sessions; the school must issue a new verified invitation to restore access.
- View student incident reports entered by the school nurse. Incident photos are optional and remain unavailable unless the school enables private photo storage; when enabled, each incident needs its own photo request and consent decision. Consent can be revoked, which immediately blocks access and queues photo deletion. Photos expire after one year; the school may also retire them after defense under its approved policy.

## Student

- Activate the school’s individual invitation, set a password, and complete email verification. A student account requires active guardian scheduling permission and administrator confirmation of the roster identity.
- Open **Clinic scheduling** to request an available appointment for yourself and check your appointment dates and statuses. The server uses your own linked roster identity; do not enter another patient’s ID.
- Student accounts cannot view clinical records, visits, incidents, guardian health records or attestations, or nurse decisions. If access is revoked, contact your guardian or school administrator for a fresh invitation.

## Backups, privacy, and reset utility

- The guardian health record privacy notice and attestation describe the review step. Nurse review is marked **Review before live use** until the school approves the notice and workflow.
- Export backups only to an approved encrypted location. Do not share accounts, OTP codes, exports, or screenshots containing health information.
- Administrators should deactivate unused accounts immediately and report incorrect guardian links or unauthorized access.
- The one-time student health reset defaults to a dry run and refuses a database unless it is a marked local disposable database or an exact reviewed fingerprint in `HEALTHMATE_RESET_ALLOWED_TARGETS`. Applying requires `--apply --backup-confirmed` and a backup reference. See `docs/GUARDIAN_HEALTH_RECORDS.md`; never run it against the configured real database during development verification.
