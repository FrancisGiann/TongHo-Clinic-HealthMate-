/*
 * CLINIC HEALTH RECORD — GOOGLE SHEETS BACKEND
 *
 * SETUP INSTRUCTIONS:
 * 1. Create a new Google Sheet (or open an existing one).
 * 2. In the Sheet, go to Extensions > Apps Script.
 * 3. Delete any starter code and paste this entire file in.
 * 4. Click "Deploy" > "New deployment".
 *    - Type: "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone" (required so the form can submit without login)
 * 5. Click "Deploy", authorize the permissions when prompted.
 * 6. Copy the "Web app URL" you're given and paste it into
 *      GOOGLE_SHEETS_WEB_APP_URL near the top of StudentRegistration.jsx.
 * 7. Reload the sheet once — this script auto-creates a header row
 *    the first time a submission comes in.
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Responses") ||
    SpreadsheetApp.getActiveSpreadsheet().insertSheet("Responses");

  var headers = [
    "Timestamp",
    "Student ID",
    "Full Name",
    "Grade Level",
    "Section",
    "Class Adviser",
    "Birth Date",
    "Gender",
    "Guardian Name",
    "Guardian Phone",
    "Relationship to Student",
    "Blood Type",
    "Known Allergies",
    "Existing Medical Conditions",
    "Current Medications"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }

  var data = e.parameter;
  var row = [
    new Date(),
    data.studentId || "",
    data.fullName || "",
    data.gradeLevel || "",
    data.section || "",
    data.classAdviser || "",
    data.birthDate || "",
    data.gender || "",
    data.guardianName || "",
    data.guardianPhone || "",
    data.relationship || "",
    data.bloodType || "",
    data.allergies || "",
    data.medicalConditions || "",
    data.medications || ""
  ];

  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ result: "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "Clinic Health Record endpoint is live" }))
    .setMimeType(ContentService.MimeType.JSON);
}
