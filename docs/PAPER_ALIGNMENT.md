# HealthMate+ paper alignment

The editable paper is not in this repository. Use this as the single editing checklist for the supplied **Purpose and Description**, **Objectives**, and **Scope and Limitations** excerpts. Some passages appear in both excerpts; update every occurrence. These are proposed corrections to make the paper describe the intended and implemented prototype accurately, **not** evidence that deployment, clinical validation, migration of actual records, or user evaluation has happened. Retain academic citations only after checking that they support the revised claim.

## Purpose and Description: AI and outcomes

Replace the paragraphs that call symptom scoring, appointment ranking, recurring-visit detection, and notification dispatch *AI-generated* with this distinction:

> HealthMate+ records a 1–10 pain index and uses versioned, weighted clinical indicators for explainable risk scoring. This rule-based decision support assists triage but neither predicts a diagnosis nor replaces the school nurse's judgment. The system can draft a consultation summary from structured encounter data for nurse review; an external AI service is optional, and a structured template is used when it is unavailable. Appointment suggestions rank available slots using recent clinic-traffic patterns when sufficient history exists. Recurring visits and due-date reminders are detected by explicit rules. These features are intended to reduce repetitive work, but any actual time savings, improved accuracy, or health outcomes must be measured during the study evaluation.

The name explanation may keep the “+” as *assistance/augmentation*, but should not imply that a generative AI model calculates risk scores or diagnoses symptoms.

## Objectives 1–3: records, migration, and scoring

1. **Web-based clinic management:** Describe one browser-based system for patient profiles, recorded medical history, clinic visits, appointments, and reports. Health screening, incident reporting, walk-in queue management, and immunization tracking are outside the current prototype scope and intended revised proposal scope; do not list them as current prototype capabilities. The original proposal still includes student incident self-reporting and needs revision before claiming that incident reporting is out of scope. Replace unqualified claims about *all patient information* or *past hospital visits* with “information entered or imported into HealthMate+.” Do not claim faster care or fewer errors as measured results before evaluation.
2. **Digitization of existing records:** Replace “migrate all existing paper-based patient records” with “support the controlled entry or import of existing records after PTHI authorization, review, and validation.” Student and historical-visit imports exist, but the actual school paper archive has **not** been migrated. A schema migration creates database tables; it does not migrate paper records.
3. **Predictive Risk and Indicator Scoring Module:** Use “rule-based Risk and Indicator Scoring Module” unless the study separately validates a predictive model. It records the paper's 1–10 pain score, applies versioned weighted indicators, and stores the result with the consultation/profile history. The bundled rules are demonstration-only; a licensed PTHI clinician must approve the real indicators and thresholds before clinical use. The output is triage support, not a diagnosis or a claim that elevated risk for a specific disease has been clinically predicted.

## Role-based access objective

Use this description wherever the paper explains account roles:

> Students from Kindergarten through Grade 10 are school-managed patient records and do not sign in to HealthMate+. Administrators import minimal roster identity and class-placement data and link guardian accounts to student records. A linked parent or guardian can view the linked student’s health record, save a draft, and attest to and submit answers for nurse review. Student identity and class placement are read-only in that form. A school nurse reviews submissions before accepted answers update the clinical profile and continues to manage visits and appointments. Administrators manage user access and guardian links, school and clinic settings, audit logs, and aggregate reports. Access is restricted by role and student link.

Use this boundary in **Objective 4** and every scope paragraph that says administrators can enter or modify clinical records, manage clinical triage, or see identifiable reports. Guardian access does not include routine clinical editing; pending answers remain separate until nurse acceptance. The student has no login or online attestation. Guardian appointment requests remain available for linked students.

Use this boundary in **Objective 4** and every scope paragraph that says administrators can enter/modify clinical records, manage clinical triage, or see identifiable reports. There is no separate school-leadership account in the four-role model; authorized staff can provide appropriate aggregate reports to leadership. Nurse and administrator dashboards share some clinic summaries but expose different actions and data.

## Objective 5 and reporting scope

Replace claims that reports are *scheduled and retained automatically* with:

> HealthMate+ calculates daily, weekly, monthly, and custom-period reports from structured clinic data, including visits, common complaints, treatments, and medication and supply use. Reports do not include health-screening or incident-report metrics. Authorized clinic staff can print or save the current report as a PDF and deliberately save a dated snapshot for later reference. Administrative views show aggregate statistics and suppress sensitive small groups; nurses retain the clinical detail needed for care. These reports may support school planning, but their accuracy and usefulness will be evaluated rather than assumed.

Avoid promising statistics for faculty patients until that workflow is supported.

## Scope correction: health screening and incident reporting

The original proposal has not been edited and still contains a manual student incident self-report passage. Revise that passage to remove it from current-feature claims or label it as future work; it does not describe an active app capability. Direct links to the retired app routes return users to a supported page. Existing screening and incident database tables and rows are retained, but the normal clinic-data API does not load those collections, current reports and exports omit their data, and new or changed screening and incident writes return `FEATURE_REMOVED`.

## Scope: authentication and OTP

Replace the “initial login or unrecognized device/session” and “email or mobile number” description with:

> Users sign in with their username or email and password. Under the current configuration, a time-limited one-time code is sent to the registered **email** for each new sign-in. A valid session allows navigation without repeating the code on every page. The system does not currently recognize trusted devices or deliver SMS codes. Server-side role checks restrict access, and relevant sign-in success, failure, and code-send events are audited.

Do not claim every rejected OTP, locked-out attempt, or other possible authentication event is logged until that coverage is verified. The account MFA toggle and the server-wide OTP requirement should be reconciled before describing OTP as user-optional. Do not present a 30-day remembered session as suitable for a shared clinic computer without a session-policy review.

## Scope: digital profiles and appointments

- Student patient records cover Kindergarten through Grade 10. Roster import/register fields are limited to student ID, name, grade, section, and adviser; guardian contact and health answers are not asserted by the school roster import. The faculty patient type and its separately implemented workflows should be described only where the paper's tested evidence supports them.
- Linked guardians can request appointments for students; the school nurse manages clinic scheduling and status. Students have no account or appointment-request access. The prototype supports one nurse and has no walk-in queue or triage workflow. Available appointment slots may be ranked from recent same-weekday clinic traffic; this is a rule-based suggestion, not AI optimization or a guarantee of shorter waits.
- Prior clinic encounters, treatment notes, appointments, and imported historical visits are associated with the student record when entered. Do not claim a complete external hospital history or automatic migration from filing cabinets.
- Guardian health records support online drafts, guardian-only attestations and submissions, nurse review/change requests/acceptance, annual renewal, and updates at any time. Paper forms may be transcribed with signature-presence metadata only; scans are not stored. Clinic document receipt is nurse-verified. The UI says **Review before live use** because notice and process approval remain external tasks.

## Scope: alerts, notifications, and AI automation

- When a school nurse records a student's arrival, HealthMate+ records a timestamped arrival event and can send linked guardians a minimal email with the student's name, clinic, local date/time, and contact guidance. After a student visit is saved, a separate in-app and email care summary can include the student's name, visit date/time, reported reason, care provided, disposition, and follow-up. These messages exclude internal notes, risk scores, vital signs, and diagnosis; they are not the full clinical record. Delivery status is logged, but successful production delivery and receipt have not been verified. Clinic-wide announcements can be sent by an administrator. There is no two-way “real-time messaging” feature.
- Follow-up, pending-consent, and recurring-visit reminders are rule-based and deduplicated. Immunization reminders are outside scope and disabled. The background reminder scheduler is **opt-in for production** and depends on configured database and SMTP services; delivery has not been verified in production. Do not claim that every notification is successfully received. Automatic notifications triggered by arbitrary risk-score thresholds are not implemented.
- Consultation summaries are drafts based on recorded encounter fields and require nurse review. The optional external AI provider and template fallback should be stated explicitly. Scheduling suggestions, recurrence checks, risk scores, and reminders are not generative AI outputs. Use the same description in both the Purpose and Description and AI-Assisted Clinical Automation sections.

## Hosting and connectivity limitation

HealthMate+ will be a web-based application deployed on an internet-accessible hosting service, with its application hosted on Hostinger and its structured database hosted on Supabase. Users will access it through a standard web browser. The system depends on a working internet connection and the availability of the hosting, database, and email services. Slow connections or service outages may delay or interrupt appointment scheduling, record retrieval, and notifications. The initial release will not provide an offline mode or a local fallback for clinic operations. Its performance and availability will therefore depend on both the school's internet connection and the external services used by the application.

Replace **every** reference to a school-local server, one clinic computer, LAN-only access, or offline operation. Hosting on Hostinger is planned, not yet evidence of a completed deployment. “Internet dependency” should refer to both the user's connection and the external services; remove “real-time messaging” from the list of interrupted features.

## AI-assisted clinical automation scope

HealthMate+ supports nurse-reviewed consultation summary drafts based on structured encounter data. An external AI service may draft the text when configured; a structured template remains available if that service is unavailable. Risk scores are calculated separately from approved weighted clinical rules and are not determined by AI-generated text. For appointments, the system suggests available times using recent clinic visit patterns and falls back to time order when the history is insufficient. It also identifies recurring visits and generates follow-up reminders from recorded dates. The school nurse remains responsible for reviewing clinical summaries and acting on risk or recurring-visit alerts.

The current prototype scope is one school nurse, with queue management and immunization workflows excluded from the paper and application. The application no longer exposes those workflows. Existing `queue_entries` and `immunizations` database tables and their records are retained without destructive migration; normal application requests return no legacy collection data, new immunization writes are rejected, queue API calls return a disabled response, and neither workflow triggers notifications or reminders.

## Other limitations to keep consistent

- **PTHI-specific scope:** The app tracks basic clinic medicine and supply stock. It is not a full pharmacy-management, hospital-laboratory, inpatient, or emergency-room system; clarify this distinction where the paper excludes “pharmacy inventory.”
- **Mobile:** There is no native Android/iOS app, push-notification integration, or offline mode. The web interface has responsive layouts; avoid claiming mobile browsers are necessarily feature-restricted unless this is demonstrated in testing.
- **Usability:** Simple navigation and accessible forms are design goals. Usability for parents, guardians, and staff must still be evaluated with participants; do not state that the interface has already reduced task time or errors.

## Evidence still needed before final paper claims

- PTHI authorization and a validated dataset before importing **actual** paper records; use fictional demo records for development and screenshots.
- Licensed-clinician approval of real risk rules and review of any clinical claims.
- Live end-to-end checks of nurse record/stock actions and guardian-only access, plus resolution of the blank nurse **Settings → Inventory requests** tab if that tab remains in scope.
- Deployment and email-delivery tests on the chosen hosting services; current local success is not production proof.
- The study's planned evaluation: participants, tasks, measures, results, and limitations. Do not invent improvement percentages, clinical outcomes, or user-satisfaction findings.
