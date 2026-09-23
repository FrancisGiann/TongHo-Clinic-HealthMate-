# HealthMate+ paper alignment

The editable paper is not in this repository. The two pasted excerpts contain the same passages below; replace each occurrence in the paper with the corresponding paragraph.

## Role-based access objective

Students can access only their own health records and appointments, while parents or guardians can access records and appointments for students linked to their accounts. School nurses can view, create, and update patient profiles, consultation records, risk assessments, and other clinic workflows. System administrators manage user accounts, school and clinic settings, audit logs, and aggregate reports. They can manage the demographic information needed to link accounts to patients, but routine access to individual clinical records and clinical editing remains with the school nurse. These role boundaries limit access to information and functions needed for each user's responsibilities.

## Hosting and connectivity limitation

HealthMate+ will be a web-based application deployed on an internet-accessible hosting service, with its application hosted on Hostinger and its structured database hosted on Supabase. Users will access it through a standard web browser. The system depends on a working internet connection and the availability of the hosting, database, and email services. Slow connections or service outages may delay or interrupt appointment scheduling, record retrieval, and notifications. The initial release will not provide an offline mode or a local fallback for clinic operations. Its performance and availability will therefore depend on both the school's internet connection and the external services used by the application.

## AI-assisted clinical automation scope

HealthMate+ supports nurse-reviewed consultation summary drafts based on structured encounter data. An external AI service may draft the text when configured; a structured template remains available if that service is unavailable. Risk scores are calculated separately from approved weighted clinical rules and are not determined by AI-generated text. For appointments, the system suggests available times using recent clinic visit patterns and falls back to time order when the history is insufficient. It also identifies recurring visits and generates follow-up and immunization reminders from recorded dates. The school nurse remains responsible for reviewing clinical summaries and acting on risk or recurring-visit alerts.
