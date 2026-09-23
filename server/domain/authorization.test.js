import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicalWriteRoles, roleCanReadReports, roleCanWriteClinicalRecords, reportReadRoles } from './authorization.js';
import { requireRoles } from '../auth.js';

function runMiddleware(role, roles) {
  let statusCode = 200;
  let nextCalled = false;
  const response = {
    status(code) {
      statusCode = code;
      return { json: () => response };
    },
  };
  requireRoles(...roles)({ user: { role } }, response, () => { nextCalled = true; });
  return { statusCode, nextCalled };
}

test('clinical write boundary rejects administrators while allowing school nurses', () => {
  assert.deepEqual(runMiddleware('system_administrator', clinicalWriteRoles), { statusCode: 403, nextCalled: false });
  assert.deepEqual(runMiddleware('school_nurse', clinicalWriteRoles), { statusCode: 200, nextCalled: true });
});

test('report read boundary includes oversight administrators without granting clinical writes', () => {
  assert.equal(roleCanReadReports('system_administrator'), true);
  assert.equal(roleCanReadReports('school_nurse'), true);
  assert.equal(roleCanWriteClinicalRecords('system_administrator'), false);
  assert.deepEqual(reportReadRoles, ['school_nurse', 'system_administrator']);
});

test('nurse-only middleware rejects administrators and portal roles', () => {
  assert.deepEqual(runMiddleware('school_nurse', ['school_nurse']), { statusCode: 200, nextCalled: true });
  assert.deepEqual(runMiddleware('system_administrator', ['school_nurse']), { statusCode: 403, nextCalled: false });
  assert.deepEqual(runMiddleware('student', ['school_nurse']), { statusCode: 403, nextCalled: false });
});
