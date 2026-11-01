import test from 'node:test';
import assert from 'node:assert/strict';
import { mayReusePendingScopeData, patientDirectorySearch, resolveClinicDataScope } from './clinicDataScope.js';

test('nurse directory query changes retain one page owner while updating request scope', () => {
  const first = resolveClinicDataScope('school_nurse', '/students', '?q=Ana&page=1');
  const next = resolveClinicDataScope('school_nurse', '/students', '?q=Anabel&page=1');
  assert.equal(first.group, 'directory');
  assert.equal(next.group, first.group);
  assert.notEqual(next.requestKey, first.requestKey);
  assert.equal(patientDirectorySearch('?q=Anabel&filter=student&page=1'), 'q=Anabel&type=student&page=1');
  assert.equal(mayReusePendingScopeData('directory', 'session:1:school_nurse:directory', 'session:1:school_nurse:directory'), true);
  assert.equal(mayReusePendingScopeData('directory', 'session:old:school_nurse:directory', 'session:new:school_nurse:directory'), false);
  assert.equal(mayReusePendingScopeData('patient', 'session:1:school_nurse:patient:old', 'session:1:school_nurse:patient:new'), false);
});

test('profile and consultation print URLs use the selected patient detail scope', () => {
  const profile = resolveClinicDataScope('school_nurse', '/students/patient%2F1');
  const consultation = resolveClinicDataScope('school_nurse', '/students/patient-1/visits/visit-1/print');
  const pass = resolveClinicDataScope('school_nurse', '/students/patient-2/passes/clinic');
  assert.equal(profile.kind, 'patient');
  assert.equal(profile.patientId, 'patient/1');
  assert.equal(consultation.patientId, 'patient-1');
  assert.equal(consultation.group, 'patient:patient-1');
  assert.equal(pass.patientId, 'patient-2');
});

test('dashboard and reports use bounded nurse scopes while legacy destinations retain full data', () => {
  assert.equal(resolveClinicDataScope('school_nurse', '/').kind, 'dashboard');
  assert.equal(resolveClinicDataScope('school_nurse', '/reports').kind, 'report');
  assert.equal(resolveClinicDataScope('school_nurse', '/appointments').kind, 'full');
  assert.equal(resolveClinicDataScope('guardian', '/students').kind, 'full');
});
