import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPendingVisitSubmission, getPendingVisitSubmission, rememberPendingVisitSubmission } from './visitSubmission.js';

test('uncertain visit submissions survive route remounts in memory and stay isolated by user', () => {
  const draft = {
    patientId: 'fictional-student-1',
    requestId: 'f7c1e1c1-e3b2-4f88-a808-b7d1e5b2f021',
    outcomeUnknown: true,
    payload: { chiefComplaint: 'Headache', treatment: 'Rest' },
  };
  rememberPendingVisitSubmission('nurse-1', draft);
  draft.payload.treatment = 'Changed after submit';

  assert.deepEqual(getPendingVisitSubmission('nurse-1'), {
    patientId: 'fictional-student-1',
    requestId: 'f7c1e1c1-e3b2-4f88-a808-b7d1e5b2f021',
    outcomeUnknown: true,
    payload: { chiefComplaint: 'Headache', treatment: 'Rest' },
  });
  assert.equal(getPendingVisitSubmission('nurse-2'), null);
  rememberPendingVisitSubmission('nurse-1', { ...draft, outcomeUnknown: false, payload: { chiefComplaint: 'Stomachache', treatment: 'Water' } });
  assert.deepEqual(getPendingVisitSubmission('nurse-1'), {
    patientId: 'fictional-student-1',
    requestId: 'f7c1e1c1-e3b2-4f88-a808-b7d1e5b2f021',
    outcomeUnknown: false,
    payload: { chiefComplaint: 'Stomachache', treatment: 'Water' },
  });
  clearPendingVisitSubmission('nurse-1');
  assert.equal(getPendingVisitSubmission('nurse-1'), null);
});
