import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialPass, resolvePrintContext, summaryFields, complaintLabels } from './printDocuments.js';
const data = { settings: { nurseName: 'Configured Nurse', schoolYear: '2026–2027' }, students: [{ id: 's', patientType: 'student', name: 'Synthetic Student', studentId: 'TEST', gradeLevel: 'Grade 3', notes: 'PRIVATE' }, { id: 'f', patientType: 'faculty' }], visits: [{ id: 'v', studentId: 's', date: '2024-01-01', time: '09:00', chiefComplaint: 'Selected complaint', notes: 'PRIVATE', consultationSummary: 'Unverified', nurseName: 'Recorded Nurse' }, { id: 'other', studentId: 'elsewhere' }] };
const nurse = { role: 'school_nurse' };
test('direct entry requires nurse, student, matching visit and known form type', () => {
 for (const role of ['guardian', 'system_administrator', 'student', undefined]) assert.equal(resolvePrintContext(data, { role }, 's', 'v'), null);
 for (const [student, visit, type] of [['f', null, 'clinic'], ['missing', null, 'gate'], ['s', 'other', 'clinic'], ['s', 'missing'], ['s', null, 'bad'], ['s', null]]) assert.equal(resolvePrintContext(data, nurse, student, visit, type), null);
 assert.ok(resolvePrintContext(data, nurse, 's', 'v'));
 assert.ok(resolvePrintContext(data, nurse, 's', null, 'gate'));
});
test('summary projects one visit without private notes, current grade or unapproved summary', () => {
 const context = resolvePrintContext(data, nurse, 's', 'v');
 const fields = summaryFields(context);
 assert.equal(fields.complaint, 'Selected complaint'); assert.equal(fields.date, '2024-01-01'); assert.equal(fields.nurse, 'Recorded Nurse'); assert.equal(fields.summary, '');
 assert.ok(!JSON.stringify(fields).includes('PRIVATE')); assert.ok(!('grade' in fields));
 assert.equal(summaryFields({ ...context, visit: { ...context.visit, summaryApprovedBy: 'n', consultationSummary: 'Approved' } }).summary, 'Approved');
});
test('pass uses settings nurse and independent state, never visit save time or clinical notes', () => {
 const before = JSON.stringify(data); const draft = initialPass(resolvePrintContext(data, nurse, 's', 'v', 'clinic'));
 assert.equal(draft.nurse, 'Configured Nurse'); assert.equal(draft.timeIn, ''); assert.equal(draft.timeOut, ''); assert.equal(draft.timeArrived, ''); assert.equal(draft.reason, ''); assert.equal(draft.notes, ''); assert.deepEqual(draft.complaints, []);
 draft.name = 'Changed'; draft.complaints.push('Injury'); assert.equal(JSON.stringify(data), before);
 assert.equal(initialPass(resolvePrintContext(data, nurse, 's', null, 'gate'), new Date('2026-01-01T20:00:00Z')).date, '2026-01-02');
 assert.deepEqual(complaintLabels, ['Headache', 'Stomachache', 'Toothache', 'Injury', 'Others']);
});
test('print workspace has no persistence or network dependencies', () => {
 const source = readFileSync(new URL('../pages/VisitPrint.jsx', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /localStorage|sessionStorage|commitData|saveData|fetch\(|api\./);
});
