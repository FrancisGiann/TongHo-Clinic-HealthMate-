import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedProfileFields, normalizeDocumentReceiptStatus, normalizeHealthRecordAnswers, validatePaperSignatureForAcceptance } from './health-records.js';

const answers = (updates = {}) => ({
  bloodType: '',
  hospitalizationHistory: null,
  onTherapy: null,
  hasConcerns: null,
  allergies: '',
  allergiesStatus: '',
  conditions: '',
  conditionsStatus: '',
  medications: '',
  medicationsStatus: '',
  ...updates,
});

test('blank tri-state answers stay unknown while explicit No remains false', () => {
  const unknown = normalizeHealthRecordAnswers(answers());
  const explicitNo = normalizeHealthRecordAnswers(answers({ hospitalizationHistory: false, onTherapy: false, hasConcerns: false }));
  const legacyYes = normalizeHealthRecordAnswers(answers({ hospitalizationHistory: 'yes' }));

  assert.equal(unknown.valid, true);
  assert.equal(unknown.value.hospitalizationHistory, null);
  assert.equal(explicitNo.value.hospitalizationHistory, false);
  assert.equal(explicitNo.value.onTherapy, false);
  assert.equal(explicitNo.value.hasConcerns, false);
  assert.equal(legacyYes.value.hospitalizationHistory, true);
});

test('accepted projection retains unknown values and supports explicit none-reported clearing', () => {
  const baseline = {
    allergies: 'Peanuts', allergiesStatus: 'reported',
    conditions: 'Asthma', conditionsStatus: 'reported',
    medications: 'Inhaler', medicationsStatus: 'reported',
    hospitalizationHistory: true,
  };
  const unknown = acceptedProfileFields(answers(), baseline);
  assert.equal(unknown.allergies, 'Peanuts');
  assert.equal(unknown.allergiesStatus, 'unknown');
  assert.equal(unknown.hospitalizationHistory, true);

  const cleared = acceptedProfileFields(answers({ allergiesStatus: 'none', conditionsStatus: 'none', medicationsStatus: 'none' }), baseline);
  assert.equal(cleared.allergies, '');
  assert.equal(cleared.conditions, '');
  assert.equal(cleared.medications, '');
  assert.equal(cleared.allergiesStatus, 'none');

  const changedBackToUnknown = acceptedProfileFields(answers({ allergiesStatus: 'unknown' }), cleared);
  assert.equal(changedBackToUnknown.allergiesStatus, 'unknown');
  assert.equal(changedBackToUnknown.allergies, '');
});

test('paper-form categories preserve tri-state flags and medication names', () => {
  const result = normalizeHealthRecordAnswers(answers({
    pastIllness: { asthma: true, pneumonia: false, chickenpox: null },
    presentIllness: { skinDisorder: true, skinDisorderDetails: 'Eczema on arms', eyeDisorder: true, eyeDisorderDetails: 'Seasonal conjunctivitis' },
    medicationAtHome: { pain: true, painName: 'Acetaminophen', fever: false, feverName: '', allergies: null, allergiesName: '', stomachache: true, stomachacheName: 'Antacid' },
    therapyInterventions: 'Weekly speech therapy',
  }));

  assert.equal(result.valid, true);
  assert.equal(result.value.pastIllness.asthma, true);
  assert.equal(result.value.pastIllness.pneumonia, false);
  assert.equal(result.value.presentIllness.skinDisorder, true);
  assert.equal(result.value.presentIllness.skinDisorderDetails, 'Eczema on arms');
  assert.equal(result.value.presentIllness.eyeDisorderDetails, 'Seasonal conjunctivitis');
  assert.equal(result.value.medicationAtHome.painName, 'Acetaminophen');
  assert.equal(result.value.medicationAtHome.stomachacheName, 'Antacid');
  assert.equal(result.value.therapyInterventions, 'Weekly speech therapy');

  const projection = acceptedProfileFields(result.value);
  assert.equal(projection.presentIllness.skinDisorderDetails, 'Eczema on arms');
  assert.equal(projection.presentIllness.eyeDisorderDetails, 'Seasonal conjunctivitis');
});

test('skin and eye detail fields are bounded text values', () => {
  const overlong = normalizeHealthRecordAnswers(answers({ presentIllness: { skinDisorderDetails: 'x'.repeat(201) } }));
  const invalidType = normalizeHealthRecordAnswers(answers({ presentIllness: { eyeDisorderDetails: 3 } }));

  assert.equal(overlong.valid, false);
  assert.ok(overlong.errors['presentIllness.skinDisorderDetails']);
  assert.equal(invalidType.valid, false);
  assert.ok(invalidType.errors['presentIllness.eyeDisorderDetails']);
});

test('paper records require guardian signature presence before acceptance', () => {
  assert.deepEqual(validatePaperSignatureForAcceptance({ source: 'paper', paper_signature_presence: { guardianPresent: true } }), { valid: true });
  assert.deepEqual(validatePaperSignatureForAcceptance({ source: 'guardian', paper_signature_presence: null }), { valid: true });
  assert.deepEqual(validatePaperSignatureForAcceptance({ source: 'paper', paper_signature_presence: { guardianPresent: false, studentPresent: true } }), {
    valid: false,
    status: 409,
    code: 'GUARDIAN_PAPER_SIGNATURE_REQUIRED',
    message: 'A paper record cannot be accepted until a guardian signature is confirmed as present.',
  });
  assert.equal(validatePaperSignatureForAcceptance({ source: 'paper', paper_signature_presence: null }).status, 409);
});

test('blood type is optional and clinic document receipt requires all nurse-set flags', () => {
  assert.equal(normalizeHealthRecordAnswers(answers()).valid, true);
  assert.deepEqual(normalizeDocumentReceiptStatus(undefined), { valid: true, value: null });
  assert.equal(normalizeDocumentReceiptStatus({ psychiatricEvaluation: true }).valid, false);
  assert.deepEqual(normalizeDocumentReceiptStatus({ psychiatricEvaluation: true, diagnosticAssessment: false, medicationRecords: false }), {
    valid: true,
    value: { psychiatricEvaluation: true, diagnosticAssessment: false, medicationRecords: false },
  });
});
