import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldLoadReportsPatientPicker } from './reportPickerScope.js';

test('patient picker is limited to nurse patient and consultation reports', () => {
  assert.equal(shouldLoadReportsPatientPicker('school_nurse', 'patient'), true);
  assert.equal(shouldLoadReportsPatientPicker('school_nurse', 'consultation'), true);
  assert.equal(shouldLoadReportsPatientPicker('school_nurse', 'clinic'), false);
  assert.equal(shouldLoadReportsPatientPicker('system_administrator', 'clinic'), false);
  assert.equal(shouldLoadReportsPatientPicker('system_administrator', 'patient'), false);
  assert.equal(shouldLoadReportsPatientPicker('guardian', 'consultation'), false);
});
