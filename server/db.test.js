import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseTlsVerifiedForConfig } from './db.js';

test('verified PostgreSQL TLS rejects disabled verification and URL SSL overrides', () => {
  const url = 'postgresql://app:secret@db.example.test:5432/postgres';
  assert.equal(databaseTlsVerifiedForConfig(url, {}), true);
  assert.equal(databaseTlsVerifiedForConfig(url, { DB_SSL: 'false' }), false);
  assert.equal(databaseTlsVerifiedForConfig(url, { DB_SSL_REJECT_UNAUTHORIZED: 'false' }), false);
  for (const parameter of ['sslmode=require', 'sslmode=verify-full', 'sslrootcert=%2Ftmp%2Fca.crt', 'sslcert=%2Ftmp%2Fclient.crt', 'sslkey=%2Ftmp%2Fclient.key']) {
    assert.equal(databaseTlsVerifiedForConfig(`${url}?${parameter}`, {}), false, parameter);
  }
  assert.equal(databaseTlsVerifiedForConfig('invalid-url', {}), false);
});
