# HealthMate+ demo process flows

## 01. Invite and activate an account

1. **Administrator:** For an administrator, nurse, or guardian, open **Users**, choose **Add new user**, enter **Name**, **Email**, and **Role**, then send the invitation. For a guardian, also select a **Linked student** and enter the **Relationship**.
2. **Guardian and administrator — student account:** The linked guardian grants **Student scheduling permission**. The administrator then chooses **Invite student**, selects the verified roster record, re-enters its student ID, and provides the student's email. Each invitation is scoped to that one roster record. Generic invitation resend and account reactivation are not used for student accounts.
3. **Invitee:** Open the secure email link within 72 hours. On **Activate your account**, enter a **Username**, **Password**, and **Confirm password**, then choose **Activate account**. Continue through the existing email OTP and password setup flow.
4. **Result:** An invited account becomes active after activation. If a student loses permission or is disabled, their current sessions and invitation stop working; restore access by granting permission again and issuing a fresh identity-checked student invitation. Other invited accounts may use **Resend invitation** under **Users**.

## 02. Sign in or recover a password

1. **Account holder:** Open **Sign in**, enter **Email / Username** and **Password**, then choose **Sign in securely**.
2. **Account holder:** Enter the six-digit email code in **Verification code** and choose **Verify and continue**. A valid code opens the home page for the account’s role. Production sign-in requires this email code.
3. **If the password is forgotten:** Choose **Forgot password?**, enter **Email / Username**, and choose **Send reset code**. Enter the **Reset code**, **New password**, and **Confirm password**, then choose **Reset password**. Return to sign in with the new password; existing sessions are revoked.
4. **Result:** The account holder reaches the role’s available pages. If a code is invalid or expired, request a fresh code and try again. An inactive account must be restored by an administrator.

## 03. Change account access and review security activity

1. **Choose one account task; these actions are separate, not a required sequence.**
2. **Administrator — link a guardian:** In **Users**, choose **Link student**, select a **Student record**, enter **Guardian relationship**, then choose **Save guardian link**. If the guardian is suspended, choose **Activate** separately after relinking.
3. **Administrator — change account status:** For an eligible account row, choose **Disable** to remove access. Disabling signs out the account and expires unused invitations. Restoring student scheduling requires a current guardian grant and the **Confirm and re-invite** flow with a reselected roster record and exact student ID; generic activation is not available for students.
4. **Administrator — record a nurse license:** Choose **Record verified license**, enter the PRC license number, confirm **I independently verified this license against an authoritative source.**, and choose **Record verified license**. Choose **Clear license record** only to remove an existing record. The app records the administrator’s check; it does not independently verify the license.
5. **Account holder — change a password:** Under **My Account**, enter **Current password**, **New password**, and **Confirm password**, then choose **Update password**. This signs out all sessions.
6. **Staff account holder — manage sessions:** Under **Active sessions**, choose **Sign out** beside one session, or enter **Current password** and choose **Sign out everywhere**.
7. **Administrator — review activity:** Open **Audit history** and choose **Refresh history** to review recent access and administrative events. Access changes and session actions are recorded there.
8. **Result:** Each selected task takes effect on its own. Inactive accounts cannot sign in; guardians need a linked student; a nurse’s recorded license is the administrator’s recorded check used for nurse-only approval checks. **Audit history** is a separate review action.

## 04. Register or update a patient record

1. **School nurse:** Open **Patients**, then choose **Register student** or **Register faculty**. Enter the required school or faculty identity details; a student record uses **Student ID**, **Student name**, and **Grade**, while a faculty record uses **Faculty ID** and **Full name**.
2. **School nurse:** Complete the available class-placement or faculty details and choose **Save roster record** or **Save faculty record**. The record appears in **Patients**. Student records are school-managed patient records, not student accounts.
3. **School nurse:** To correct an existing record, open it from **Patients**, choose **Edit profile**, make the change, and choose **Save changes**. The updated patient record is saved to clinic records. The current profile editor lists Grades 1–12 and omits Kindergarten, while new registration and imports support Kindergarten–Grade 10; confirm a student’s class placement before changing it there.

## 05. Import records from a CSV file

1. **Administrator or school nurse:** Open **Data & Imports**. Use **Import student roster** (administrator only), **Import faculty profiles** (administrator or nurse), or **Import historical visits** (nurse only). **Download CSV template** shows the expected columns; **Choose CSV file** previews up to 1,000 rows from a CSV file up to 2 MB.
2. **Importer:** Review ready, duplicate, and invalid rows. Select ready rows to include. For duplicates, choose **Skip duplicates and import selected new rows** or **Cancel this import**; invalid and duplicate rows cannot be imported.
3. **Importer:** Choose **Import N selected rows**. The system checks the selection again; if any selected row fails, the whole batch is left unsaved. A successful batch reports imported and skipped counts.
4. **Importer:** To undo an untouched batch, choose **Roll back this batch** and confirm. Rollback removes the whole batch only when its records have no later edits, account links, or clinic activity; otherwise no rows are removed.
5. **Result:** Student imports contain roster identity and class-placement fields only. They do not import guardian links or health answers. Imported records appear in the corresponding patient or visit lists.
   **Study-scope note:** **Import historical visits** is available in the nurse screen, but migrating historical clinical records is outside the current study scope. For a demo, use only authorized fictional data.

## 06. Submit and review an online student health record

1. **Guardian:** Open **Student Health Record**, choose a linked student, complete or update the answers, and choose **Save draft**. Saving keeps a draft; it does not send answers to the clinic profile.
2. **Guardian:** Confirm the guardian attestation and choose **Submit for nurse review**. The submission enters the nurse review queue; it does not update the patient profile yet.
3. **School nurse:** Open **Health record review** → **Awaiting nurse review**. Review the answers, update **Documents received by clinic** only for documents the clinic has received, and enter **Feedback visible to guardian** when needed. Choose **Accept into patient profile** or **Request changes**.
4. **Result:** **Accept into patient profile** adds the accepted answers to the student’s clinic profile. If the nurse chooses **Request changes**, the guardian sees the feedback, updates the record, saves a draft, and submits again for review. The new submission returns to the nurse queue. The review page shows **Review before live use**; school approval of the notice and paper workflow remains pending.

## 07. Transcribe and review a paper health record

1. **School nurse:** In **Health record review**, choose the **Student record**, enter the **School year**, transcribe the answers, and mark **Guardian signature present on paper** and **Student signature present on paper** only when each signature is present. Choose **Save for nurse review**. The app stores presence checks, not a paper image.
2. **School nurse:** Find the transcription in **Awaiting nurse review**, review its answers, set **Documents received by clinic** separately from the guardian’s report of submitted documents, and enter any **Feedback visible to guardian**.
3. **School nurse:** Choose **Accept into patient profile** to add valid answers to the student’s profile, or **Request changes** to keep the submission out of the profile. A paper submission cannot be accepted unless **Guardian signature present on paper** was marked; the student signature is recorded as presence information.
4. **Result:** An accepted transcription updates the clinic profile. If changes are needed, transcribe a corrected paper form as a new revision and review it again. The health-record screen is marked **Review before live use**; school approval of the notice and paper workflow remains pending.

## 08. Record a student’s clinic arrival

1. **School nurse:** In **New Visit**, choose a student under **Patient**, then choose **Record arrival & notify guardian**.
2. **System:** Record a separate arrival event and try to notify the linked guardian. If the event was already recorded, the screen reports that instead of creating another arrival. The result shows notification delivery status.
3. **Result:** The arrival is recorded for the student. This action does not save a clinic visit; continue with **Save visit** when care has been provided.

## 09. Record a clinic visit and any care given

1. **School nurse:** In **New Visit**, choose **Patient**, review the allergy information, then enter **Visit type**, **Chief complaint**, **Disposition**, and **Treatment and care provided**.
2. **School nurse:** Enter available **Temperature** and **Pulse rate**, then complete **Clinician warning-sign screen**. The form no longer asks for a numeric pain score or generates an automated risk classification.
3. **School nurse:** Before saving, add care if needed: choose **Add item** under **Items dispensed**, select an eligible **Medication or supply**, and enter **Quantity**. Optionally choose **Schedule follow-up** and enter **Follow-up due date**. To prepare an AI-assisted note, choose **Generate summary draft**, review or edit it, then check **I reviewed and approve this summary for the record**. Generating the draft does not save the visit.
4. **School nurse:** If the warning-sign assessment identifies an urgent sign, document **Urgent warning-sign action** before saving. A missing assessment or required urgent action blocks the visit save. Record clinic date, complaint or illness, remarks, and signed-in nurse attribution alongside vitals, treatment, and disposition.
5. **School nurse:** Choose **Save visit**. If the save result is uncertain, choose **Retry same visit**; if a saved-record conflict is reported, open **Review patient history** before starting another visit.
6. **Result:** A successful save records the visit and any dispensing together, updates stock, and attempts a care-summary notice to linked guardians for a student. Guardians can view student visit details in **Visit History**. Faculty visits do not send guardian notices. Historical risk scores are preserved for old records only.

## 10. Manage appointments

1. **Guardian:** Open **Clinic scheduling**, choose a linked **Student**, **Appointment date**, **Available time**, and enter **Reason**. Choose **Request appointment**. The request is recorded as **Requested** and the clinic tries to notify linked users.
2. **Student:** After a guardian grants permission and an administrator sends a fresh identity-checked invitation, open **Clinic scheduling**, choose an available date and time, and request an appointment for yourself. The server derives the student patient identity from the authenticated account.
3. **School nurse:** Open **Clinic scheduling** → **Patient appointments and requests**. For a request, choose **Confirm** to make it **Scheduled**, or **Cancel** to make it **Cancelled**. The nurse may choose **Reschedule**, select a date and available time, and choose **Save new time** for an open request or scheduled appointment.
4. **School nurse:** After the appointment has taken place and its status is **Scheduled**, choose **Complete** to set **Completed**. This changes appointment status only; it does not save a clinic visit. A nurse may also choose **Schedule appointment** and create a **Scheduled** appointment directly, without a guardian request.
5. **Result:** Guardians can view the current status and decision reason for linked students; students see only their own appointment dates and statuses. For a **Requested** appointment, the nurse can **Confirm**, **Reject**, or **Cancel**; reject and cancel require a reason. A **Scheduled** appointment can be completed or cancelled, and open appointments can be rescheduled. Online scheduling is not an emergency service.

## 11. Maintain clinic inventory and restock items

1. **School nurse:** Open **Inventory** and choose **Add item**. Enter **Item name**, **Item type**, **Category**, **Starting stock**, **Unit**, and **Reorder level**, then choose **Add item**. For an existing item, choose **Edit** and **Update item**.
2. **School nurse:** To record received stock, choose **Restock** for an item, enter **Quantity received** and **Reason**, then choose **Confirm restock**. To correct a count, use the item’s add-one or remove-one control; each change updates the stock record.
3. **School nurse:** Items at or below their reorder level appear as **Low stock**. An archived item is unavailable for dispensing; choose **Restore** to return it, or **Archive** and confirm to remove an active item from dispensing.
4. **Result:** Inventory reflects the saved quantity and item status. There is no inventory requisition or purchase-approval flow in the current screen.

## 12. Track consent and process due reminders

1. **School nurse:** Open a student from **Patients** and find **Consent tracking**. Choose **Consent status**; if it is **Pending**, enter **Due date**. Choose **Save consent status**. Signed forms are not uploaded or stored here.
2. **Administrator:** Open **Communications** and choose **Run due reminders**. The system checks consent and follow-ups due today, overdue, or within the next 30 days, plus patients with three or more visits in 90 days. Repeated runs do not send the same reminder again.
3. **Result:** The system creates available in-app notices and attempts email delivery to linked accounts. The screen reports delivery failures or unconfirmed results; a failed email is not automatically retried.

## 13. View, print, and save a report

1. **School nurse or administrator:** Open **Reports**. Choose **Report period** (Daily, Weekly, Monthly, or Custom) and set **Start date** and **End date**. The report refreshes for that date range; small groups may be withheld to protect privacy.
2. **Viewer:** Choose **Print / PDF** or **Print view** to open the browser’s print flow, or choose **Save snapshot** to store the selected aggregate report for audit and future reference.
3. **Result:** A saved report appears under **Saved report snapshots**. Printing does not save a snapshot, and saving a snapshot does not print or export it.

## 14. Send a clinic notice

1. **Administrator:** Open **Communications**, choose a **Notice type**, enter **Subject** and **Message**, and select one or more active account roles under **Send to active accounts**.
2. **Administrator:** Check **I’ve checked the message and selected recipient roles.** and choose **Send clinic notice**. The system creates in-app notices and attempts email delivery for the selected active accounts.
3. **Result:** The screen reports the recipient count, in-app notices, emails sent, and email failures. Failed emails are not automatically retried; check delivery and follow up through the approved clinic channel.

## 15. Use Data & Imports and Reports

1. **Administrator or school nurse:** Open **Data & Imports** to set up a roster or load an authorized supported data file. Student imports contain roster identity and class placement only; they do not load health records.
2. **School nurse or administrator:** Open **Reports** to review clinic activity for a selected period. Small groups remain suppressed where needed to protect privacy; export and print follow the same suppression.
3. **Result:** Use imports for roster/data setup and reports for clinic oversight. Automated risk scoring and Risk Rules management are retired; historical scores remain only with old records for compatibility.
