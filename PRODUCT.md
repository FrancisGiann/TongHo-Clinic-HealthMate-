# HealthMate Plus Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the Philippine Tong Ho Institute school nurse working on a desktop or laptop during active clinic hours, including high-volume periods. Secondary users are system administrators managing access and oversight, students viewing their own records and appointments, and parents or guardians viewing records and appointments for linked students.

## Product Purpose

HealthMate+ replaces fragmented paper clinic records and manual workflows with one secure clinic system for a single school nurse. It centralizes patient profiles, consultation history, appointments, risk indicators, notifications, inventory activity, and clinic reports. Success means clinic staff can record and retrieve accurate information quickly while each user sees only authorized data.

## Positioning

HealthMate+ combines PTHI-specific clinic workflows with explainable risk and pain scoring, role-specific health portals, automated reporting, and nurse-reviewed clinical automation. It assists clinical judgment and does not diagnose patients or replace the school nurse.

## Operating Context

The application is used through standard desktop and laptop web browsers. It supports consultation documentation, follow-up work, appointment requests, school reporting, and account administration. Health screening, incident reporting, walk-in queue management, and immunization recording are outside the current prototype scope and intended revised proposal scope. The original proposal has not yet been revised and still includes a manual student incident self-report passage. Historical records for removed workflows remain in the database, but the current app does not expose them or accept new or changed screening and incident records. The final deployment may run on Hostinger with Supabase PostgreSQL and SMTP email; it has no offline fallback and must not assume localhost or a school-only LAN.

## Capabilities and Constraints

- Roles are student, guardian, school nurse, and system administrator.
- Student and guardian access is limited to linked patient records and appointments.
- Email OTP, expiring sessions, audit logs, and server-side authorization protect access.
- Pain scores use the paper-defined 1–10 range and contribute to versioned risk rules.
- Risk results are explainable decision support; demonstration rules remain visibly unapproved until a licensed PTHI clinician approves a version.
- AI-generated consultation summaries are optional, privacy-minimized drafts that require nurse review. Deterministic fallback behavior keeps the workflow available when an AI provider is absent.
- Reports cover daily, weekly, monthly, and custom periods using structured clinic data.
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
