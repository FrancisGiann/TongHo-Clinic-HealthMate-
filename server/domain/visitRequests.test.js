import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrReplayVisitRequest, findVisitRequest, matchesVisitRequest, publicVisitRecord, validVisitRequestId, visitRequestFingerprint } from './visitRequests.js';

test('visit request keys require UUIDs and normalized visit payloads have stable fingerprints', () => {
  assert.equal(validVisitRequestId('f7c1e1c1-e3b2-4f88-a808-b7d1e5b2f021'), true);
  assert.equal(validVisitRequestId('not-a-uuid'), false);
  assert.equal(visitRequestFingerprint({ complaint: 'Headache', treatment: 'Rest' }), visitRequestFingerprint({ complaint: 'Headache', treatment: 'Rest' }));
  assert.notEqual(visitRequestFingerprint({ complaint: 'Headache', treatment: 'Rest' }), visitRequestFingerprint({ complaint: 'Headache', treatment: 'Hydration' }));
});

test('visit request replay requires both the original actor and exact validated payload', () => {
  const fingerprint = visitRequestFingerprint({ patientId: 'student-1', treatment: 'Rest' });
  const existing = { created_by: 'nurse-1', data: { _requestFingerprint: fingerprint } };

  assert.equal(matchesVisitRequest(existing, 'nurse-1', fingerprint), true);
  assert.equal(matchesVisitRequest(existing, 'nurse-2', fingerprint), false);
  assert.equal(matchesVisitRequest(existing, 'nurse-1', visitRequestFingerprint({ patientId: 'student-1', treatment: 'Ice' })), false);
  assert.deepEqual(publicVisitRecord({ id: 'visit-1', _requestFingerprint: fingerprint, treatment: 'Rest' }), { id: 'visit-1', treatment: 'Rest' });
});

test('visit request replay skips encounter writes and conflicts on changed payload or owner', async () => {
  const store = new Map();
  let dispenseCount = 0;
  const client = {
    async query(sql, [requestId]) {
      const record = store.get(requestId);
      return { rowCount: record ? 1 : 0, rows: record ? [record] : [] };
    },
  };
  const requestId = 'f7c1e1c1-e3b2-4f88-a808-b7d1e5b2f021';
  const input = { patientId: 'student-1', treatment: 'Rest' };
  const fingerprint = visitRequestFingerprint(input);
  const create = async () => {
    dispenseCount += 1;
    const visit = { id: requestId, treatment: input.treatment, _requestFingerprint: fingerprint, riskAssessment: { category: 'low' } };
    store.set(requestId, { id: requestId, patient_id: input.patientId, created_by: 'nurse-1', data: visit, patient_type: 'student', patient_name: 'Fictional Patient' });
    return { visit, patientType: 'student', patientName: 'Fictional Patient' };
  };

  const created = await createOrReplayVisitRequest(client, { requestId, userId: 'nurse-1', fingerprint, create });
  const replayed = await createOrReplayVisitRequest(client, { requestId, userId: 'nurse-1', fingerprint, create });
  const changed = await createOrReplayVisitRequest(client, { requestId, userId: 'nurse-1', fingerprint: visitRequestFingerprint({ ...input, treatment: 'Ice' }), create });
  const otherOwner = await createOrReplayVisitRequest(client, { requestId, userId: 'nurse-2', fingerprint, create });

  assert.equal(created.kind, 'created');
  assert.equal(replayed.kind, 'replay');
  assert.equal(replayed.visit._requestFingerprint, undefined);
  assert.equal(changed.kind, 'conflict');
  assert.equal(otherOwner.kind, 'conflict');
  assert.equal(dispenseCount, 1);
});

test('early visit request lookup uses the same owner and payload check', async () => {
  const fingerprint = visitRequestFingerprint({ patientId: 'student-1', treatment: 'Rest' });
  let statement = '';
  const replay = await findVisitRequest(async (sql, params) => {
    statement = sql;
    assert.deepEqual(params, ['f7c1e1c1-e3b2-4f88-a808-b7d1e5b2f021']);
    return { rowCount: 1, rows: [{ id: params[0], created_by: 'nurse-1', data: { _requestFingerprint: fingerprint, treatment: 'Rest' }, patient_type: 'student', patient_name: 'Fictional Patient' }] };
  }, 'f7c1e1c1-e3b2-4f88-a808-b7d1e5b2f021', 'nurse-1', fingerprint);

  assert.match(statement, /WHERE v\.id=\$1/);
  assert.equal(replay.kind, 'replay');
  assert.equal(replay.visit._requestFingerprint, undefined);
});
