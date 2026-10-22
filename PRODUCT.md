# HealthMate Plus Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the Philippine Tong Ho Institute school nurse working on a desktop or laptop during active clinic hours, including high-volume periods. Secondary users are system administrators managing access and oversight and parents or guardians viewing and submitting health information for linked students. Students from Kindergarten through Grade 10 are school-managed patient records and do not have accounts or sign in.

## Product Purpose

HealthMate+ replaces fragmented paper clinic records and manual workflows with one secure clinic system for a single school nurse. It centralizes roster-managed patient profiles, guardian-submitted health records reviewed by a nurse, consultation history, guardian appointment requests, risk indicators, notifications, inventory activity, and clinic reports. Success means clinic staff can record and retrieve accurate information quickly while each user sees only authorized data.

## Positioning

HealthMate+ combines PTHI-specific clinic workflows with explainable risk and pain scoring, guardian-led health records, automated reporting, and nurse-reviewed clinical automation. It assists clinical judgment and does not diagnose patients or replace the school nurse.

## Operating Context

The application is used through standard desktop and laptop web browsers. It supports consultation documentation, follow-up work, guardian appointment requests, appointment availability management, school reporting, and account administration. Nurses can create and maintain student incident reports, and linked guardians can view those reports; students do not self-report or sign in. Incident photos are a separate, defense-only capability requiring the feature flag, private storage, and incident-specific guardian consent. Health screening, walk-in queue management, and immunization recording remain outside current scope. Historical records for removed workflows remain in the database, but the current app does not expose them or accept new or changed screening records. The final deployment may run on Hostinger with Supabase PostgreSQL, private Supabase Storage, and SMTP email; it has no offline fallback and must not assume localhost or a school-only LAN.

## Capabilities and Constraints

- Sign-in roles are guardian, school nurse, and system administrator. The legacy student database role remains only to preserve deactivated historical accounts.
- A guardian can submit a self-registration request after email verification and a normalized student ID matches exactly one roster record. The account and student link stay pending until an administrator verifies the relationship against school records. Existing account invitations and staff invitations remain administrator-managed.
- Guardians can access only linked student records and request appointments for those students. They attest to health-record submissions; nurses review before answers update the patient profile.
- Administrators and school nurses can save role-appropriate dashboard widget visibility and order per account across devices.
- Student roster imports are limited to student ID, name, grade, section, and adviser. Kindergarten and Grades 1–10 are supported. Student accounts, student portal access, and student appointment requests are removed.
- Email OTP, expiring sessions, audit logs, and server-side authorization protect access.
- Pain scores use the paper-defined 1–10 range and contribute to versioned risk rules.
- Risk results are explainable decision support; demonstration rules remain visibly unapproved until a licensed PTHI clinician approves a version.
- AI-generated consultation summaries are optional, privacy-minimized drafts that require nurse review. Deterministic fallback behavior keeps the workflow available when an AI provider is absent.
- Reports cover daily, weekly, monthly, and custom periods using structured clinic data.
- Nurses can block full or partial appointment periods after resolving any overlapping requested or scheduled appointments. Nurse rejection and cancellation decisions require a reason shown to linked guardians.
- Administrators use `/cms` to manage the HealthMate+ application logo, the Philippine Tong Ho Institute seal, and an optional public landing-page community photo. They can edit landing-page hero copy, clinic information, announcements, and FAQs as a private draft, preview the saved draft, and publish it. Public announcements respect their configured Philippine-time start and expiry; public photos and text must not contain medical records or sensitive student information.
- Incident reports contain nurse-maintained text for students and are visible only to nurses and linked guardians. Photo upload and viewing default off, require a current incident-specific guardian consent, and use private storage; photos expire after one year or are explicitly retired after defense without a preselected defense date.
- The first release has no native mobile application, hospital laboratory, inpatient, emergency-room, or full pharmacy-management scope.
- Development and demonstrations use fictional data unless the school formally authorizes real patient data processing.

## Brand Commitments

The product name is HealthMate+ and the PTHI seal is the primary institutional asset. The interface should feel calm, trustworthy, direct, and suitable for users with varied digital literacy. Existing typography, colors, dark mode, and component language are incumbent design authority for this completion pass.

## Evidence on Hand

- Capstone purpose, objectives, scope, and limitations: `/home/francisgiann/.codex/attachments/a8081f1d-9f54-4adb-8966-6f684334311f/pasted-text.txt`
- PTHI logo asset: `public/Logo.jpg`
- Existing React interface and design tokens: `src/index.css` and `src/design-system/tokens.css`
- Existing fictional demonstration data and deterministic domain tests under `server/` and `src/db/`
- No licensed clinician-approved production risk-rule set or real patient migration dataset is currently available; neither may be fabricated.

## Product Principles

1. Put the school nurse's next safe action first.
2. Make role boundaries visible and enforce them on the server.
3. Explain clinical automation and require accountable human review.
4. Prefer accurate, auditable workflows over decorative controls or implied functionality.
5. Keep common clinic tasks fast and understandable for users with limited technical experience.

## Accessibility and Inclusion

Use clear labels, keyboard-accessible controls, visible focus states, understandable validation, sufficient contrast in light and dark themes, and layouts that remain usable at reduced desktop widths. Avoid relying on color alone for clinical status or urgency.
