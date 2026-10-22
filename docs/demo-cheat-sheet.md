# HealthMate+ demo process flows

## 01. Invite and activate an account

1. **Administrator:** Open **Users** and choose **Add new user**. Enter **Name**, **Email**, and **Role**. For a guardian, select a **Linked student** and enter the **Relationship**; choose **Send invitation**. The account stays invited until the recipient accepts the email link.
2. **Invitee:** Open the secure email link within 72 hours. On **Activate your account**, enter a **Username**, **Password**, and **Confirm password**, then choose **Activate account**. A guardian must already be linked to a student. Students do not have sign-in accounts.
3. **Result:** The account becomes active and can sign in. If the email does not arrive or the link expires, the administrator can choose **Resend invitation** from **Users**; the recipient must still activate the renewed link.

## 02. Sign in or recover a password

1. **Account holder:** Open **Sign in**, enter **Email / Username** and **Password**, then choose **Sign in securely**.
2. **Account holder:** Enter the six-digit email code in **Verification code** and choose **Verify and continue**. A valid code opens the home page for the account’s role. Production sign-in requires this email code.
3. **If the password is forgotten:** Choose **Forgot password?**, enter **Email / Username**, and choose **Send reset code**. Enter the **Reset code**, **New password**, and **Confirm password**, then choose **Reset password**. Return to sign in with the new password; existing sessions are revoked.
4. **Result:** The account holder reaches the role’s available pages. If a code is invalid or expired, request a fresh code and try again. An inactive account must be restored by an administrator.

## 03. Change account access and review security activity

1. **Choose one account task; these actions are separate, not a required sequence.**
2. **Administrator — link a guardian:** In **Users**, choose **Link student**, select a **Student record**, enter **Guardian relationship**, then choose **Save guardian link**. If the guardian is suspended, choose **Activate** separately after relinking.
3. **Administrator — change account status:** For an account row, choose **Deactivate** to remove access or **Activate** to restore eligible access. Deactivation signs out that account and expires unused invitations. An invited account must use its email link to activate.
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
2. **School nurse:** Enter available **Temperature** and **Pulse rate**, enter **Pain score (1–10)**, and complete **Clinician warning-sign screen**.
3. **School nurse:** Before saving, add care if needed: choose **Add item** under **Items dispensed**, select an eligible **Medication or supply**, and enter **Quantity**. Optionally choose **Schedule follow-up** and enter **Follow-up due date**. To prepare an AI-assisted note, choose **Generate summary draft**, review or edit it, then check **I reviewed and approve this summary for the record**. Generating the draft does not save the visit.
4. **School nurse:** Choose **Save visit**. The app evaluates the assessment and recent visits. A missing warning-sign screen or other required assessment data blocks saving. High-risk and review-required results need **Nurse review / acknowledgement** before the visit can be saved. This is decision support, not a diagnosis.
5. **School nurse, only if saving stops or review is required:** Correct missing fields or unavailable stock, add any required **Nurse review / acknowledgement**, then choose **Save visit** again. If the save result is uncertain, choose **Retry same visit**; if a saved-record conflict is reported, open **Review patient history** before starting another visit.
6. **Result:** A successful save records the visit and any dispensing together, updates stock, and attempts a care-summary notice to linked guardians for a student. Guardians can view student visit details in **Visit History**. Faculty visits do not send guardian notices.
   **Flow note:** With the **WHO IITT-informed partial screening (draft)** rule active, temperature alone may be missing if the nurse records **Nurse review / acknowledgement**. Other missing required inputs still block saving.

## 10. Manage appointments

1. **Guardian:** Open **Appointments**, choose a linked **Student**, **Appointment date**, **Available time**, and enter **Reason**. Choose **Request appointment**. The request is recorded as **Requested** and the clinic tries to notify linked users.
2. **School nurse:** Open **Appointments** → **Patient appointments and requests**. For a request, choose **Confirm** to make it **Scheduled**, or **Cancel** to make it **Cancelled**. The nurse may choose **Reschedule**, enter **New date and time**, and choose **Save new time** for an open request or scheduled appointment.
3. **School nurse:** After the appointment has taken place and its status is **Scheduled**, choose **Complete** to set **Completed**. This changes appointment status only; it does not save a clinic visit. A nurse may also choose **Schedule appointment** and create a **Scheduled** appointment directly, without a guardian request.
4. **Result:** The guardian can view the current status and any decision reason under **Appointments**. For a **Requested** appointment, the nurse can **Confirm**, **Reject**, or **Cancel**; reject and cancel require a reason. A **Scheduled** appointment can be completed or cancelled, and open appointments can be rescheduled. Online scheduling is not an emergency service.

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

## 15. Save and activate a risk-rule version

1. **Administrator or school nurse:** Open **Risk Rules** → **Advanced: manage custom rules**. Create or copy a rule and choose **Save for nurse review** (or **Save candidate for nurse review**). Saving creates a draft; assessments continue using the current rule.
2. **School nurse:** After an administrator has recorded the nurse’s verified PRC license, review the draft and choose **Approve and use version N**. The app checks that license record and then marks the version approved and in use. Administrators cannot approve the rule.
3. **Result and limit:** The app uses an approved version for later assessment prompts, while a sample rule is used if no custom version is approved. The sample is demonstration-only. The app’s license check does not establish that a rule has been clinically validated or approved by the school; a licensed PTHI clinician must approve the actual clinical indicators before live use.
