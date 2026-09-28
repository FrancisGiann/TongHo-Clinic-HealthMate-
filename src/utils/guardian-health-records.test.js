import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAlreadySubmittedForSchoolYear, isHealthRecordRenewalDue } from './guardian-health-records.js';

const answers = { bloodType: '', allergies: 'Peanuts', presentIllness: { skinDisorder: true, skinDisorderDetails: 'Eczema' } };

test('unchanged guardian answers can be submitted again for a new school year', () => {
  const lastYear = [{ school_year: '2025-2026', source: 'guardian', status: 'accepted', payload: answers }];
  const thisYear = [{ school_year: '2026-2027', source: 'guardian', status: 'accepted', payload: answers }];

  assert.equal(hasAlreadySubmittedForSchoolYear(lastYear, '2026-2027', answers), false);
  assert.equal(hasAlreadySubmittedForSchoolYear(thisYear, '2026-2027', { ...answers, presentIllness: { skinDisorderDetails: 'Eczema', skinDisorder: true } }), true);
  assert.equal(hasAlreadySubmittedForSchoolYear(thisYear, '2026-2027', { ...answers, allergies: 'Peanuts and dust' }), false);
});

test('a prior-year record is marked due until a submission exists for the current year', () => {
  const lastYear = [{ school_year: '2025-2026', source: 'paper', status: 'accepted' }];
  const bothYears = [{ school_year: '2026-2027', source: 'guardian', status: 'pending_review' }, ...lastYear];

  assert.equal(isHealthRecordRenewalDue(lastYear, '2026-2027'), true);
  assert.equal(isHealthRecordRenewalDue(bothYears, '2026-2027'), false);
  assert.equal(isHealthRecordRenewalDue([], '2026-2027'), false);
});
