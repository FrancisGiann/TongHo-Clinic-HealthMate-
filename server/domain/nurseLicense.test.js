import test from 'node:test';
import assert from 'node:assert/strict';
import { recordNurseLicenseVerification, validateNurseLicenseUpdate } from './nurseLicense.js';

test('nurse license update trims values and requires explicit verification for a number', () => {
  assert.deepEqual(validateNurseLicenseUpdate({ prcLicenseNumber: '  PRC-123  ', verificationConfirmed: true }), {
    valid: true,
    licenseNumber: 'PRC-123',
    verified: true,
  });
  assert.equal(validateNurseLicenseUpdate({ prcLicenseNumber: 'PRC-123' }).code, 'VERIFICATION_CONFIRMATION_REQUIRED');
  assert.deepEqual(validateNurseLicenseUpdate({ prcLicenseNumber: '   ' }), { valid: true, licenseNumber: '', verified: false });
});

test('nurse license update rejects missing, non-string, and overlength values', () => {
  assert.equal(validateNurseLicenseUpdate({}).valid, false);
  assert.equal(validateNurseLicenseUpdate({ prcLicenseNumber: 123, verificationConfirmed: true }).valid, false);
  assert.equal(validateNurseLicenseUpdate({ prcLicenseNumber: 'x'.repeat(81), verificationConfirmed: true }).valid, false);
  assert.equal(validateNurseLicenseUpdate({ prcLicenseNumber: '', verificationConfirmed: 'yes' }).valid, false);
});

test('recording a nurse license uses parameterized values and stores the verifying administrator', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id,role FROM users')) return { rowCount: 1, rows: [{ id: 'nurse-id', role: 'school_nurse' }] };
      if (sql.startsWith('UPDATE users')) return { rowCount: 1, rows: [{ id: 'nurse-id', role: 'school_nurse', status: 'active', prc_license_verified: true }] };
      throw new Error(`Unexpected nurse-license query: ${sql}`);
    },
  };
  const validation = validateNurseLicenseUpdate({ prcLicenseNumber: "X' OR TRUE --", verificationConfirmed: true });
  const result = await recordNurseLicenseVerification(client, 'nurse-id', validation, 'admin-id');

  assert.deepEqual(result, { id: 'nurse-id', role: 'school_nurse', status: 'active', verified: true });
  assert.match(calls[1].sql, /WHERE id=\$3 AND role='school_nurse'/);
  assert.match(calls[1].sql, /prc_license_verified_by=CASE WHEN \$4 THEN \$2::uuid ELSE NULL END/);
  assert.deepEqual(calls[1].params, ["X' OR TRUE --", 'admin-id', 'nurse-id', true]);
  assert.equal(calls[1].sql.includes("X' OR TRUE --"), false);
});

test('clearing a nurse license removes verification without requiring confirmation', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id,role FROM users')) return { rowCount: 1, rows: [{ id: 'nurse-id', role: 'school_nurse' }] };
      if (sql.startsWith('UPDATE users')) return { rowCount: 1, rows: [{ id: 'nurse-id', role: 'school_nurse', status: 'active', prc_license_verified: false }] };
      throw new Error(`Unexpected nurse-license query: ${sql}`);
    },
  };
  const result = await recordNurseLicenseVerification(client, 'nurse-id', validateNurseLicenseUpdate({ prcLicenseNumber: '' }), 'admin-id');

  assert.equal(result.verified, false);
  assert.deepEqual(calls[1].params, ['', null, 'nurse-id', false]);
  assert.match(calls[1].sql, /prc_license_verified_at=CASE WHEN \$4 THEN NOW\(\) ELSE NULL END/);
});

test('license recording rejects missing and non-nurse account targets without updating', async () => {
  for (const row of [null, { id: 'admin-id', role: 'system_administrator' }]) {
    const calls = [];
    const client = {
      async query(sql) {
        calls.push(sql);
        if (sql.startsWith('SELECT id,role FROM users')) return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
        throw new Error('A non-nurse account must not be updated.');
      },
    };
    const expected = row ? 'NURSE_ACCOUNT_REQUIRED' : 'NOT_FOUND';
    await assert.rejects(
      recordNurseLicenseVerification(client, row?.id || 'missing-id', validateNurseLicenseUpdate({ prcLicenseNumber: '' }), 'admin-id'),
      (error) => error.code === expected,
    );
    assert.equal(calls.length, 1);
  }
});
