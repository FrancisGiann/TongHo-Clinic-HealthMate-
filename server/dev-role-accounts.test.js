import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from './auth.js';
import { assertDevRoleAccountSeedEnabled, DEV_ROLE_ACCOUNTS } from './dev-role-accounts.js';

test('development role account seed requires development mode and explicit opt-in', () => {
  assert.throws(() => assertDevRoleAccountSeedEnabled({ NODE_ENV: 'production', SEED_DEV_ROLE_ACCOUNTS: 'true' }), /NODE_ENV=development/);
  assert.throws(() => assertDevRoleAccountSeedEnabled({ NODE_ENV: 'development' }), /SEED_DEV_ROLE_ACCOUNTS=true/);
  assert.doesNotThrow(() => assertDevRoleAccountSeedEnabled({ NODE_ENV: 'development', SEED_DEV_ROLE_ACCOUNTS: 'true' }));
});

test('fictional account seed includes only staff and guardian sign-in roles', () => {
  assert.deepEqual(new Set(DEV_ROLE_ACCOUNTS.map((account) => account.role)), new Set(['system_administrator', 'school_nurse', 'guardian']));
  assert.equal(new Set(DEV_ROLE_ACCOUNTS.map((account) => account.email)).size, 3);
  assert.equal(new Set(DEV_ROLE_ACCOUNTS.map((account) => account.password)).size, 3);
  for (const account of DEV_ROLE_ACCOUNTS) {
    assert.match(account.email, /@healthmate\.test$/);
    assert.equal(validatePassword(account.password), null);
  }
});
