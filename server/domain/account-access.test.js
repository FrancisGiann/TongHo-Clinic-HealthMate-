import test from 'node:test';
import assert from 'node:assert/strict';
import { activateInvitedAccount, changeAccountStatus, renewPendingInvitation } from './account-access.js';

function createStore({ role = 'school_nurse', status = 'invited', invitations = null, users = null, guardianLinks = [], sessions = [], reservedUsernames = [] } = {}) {
  const id = '12345678-1234-4234-8234-123456789abc';
  const email = 'nurse@example.test';
  const now = Date.now();
  return {
    users: users || [{ id, username: `invited-${id.slice(0, 8)}`, email, name: 'Test Nurse', role, status, password_hash: 'placeholder' }],
    invitations: invitations || [{ id: 'invitation-1', tokenHash: 'hash-1', email, role, patientId: null, acceptedAt: null, expiresAt: new Date(now + 60_000), invitedBy: 'admin-1' }],
    guardianLinks,
    sessions,
    reservedUsernames,
    failQuery: null,
    lockTails: new Map(),
    log: [],
  };
}

function createTransaction(store, { rollback = true } = {}) {
  return async (work) => {
    const snapshot = structuredClone({
      users: store.users,
      invitations: store.invitations,
      sessions: store.sessions,
      reservedUsernames: store.reservedUsernames,
    });
    const heldLocks = [];
    const ownedLocks = new Set();
    const acquire = async (key) => {
      if (ownedLocks.has(key)) return;
      const previous = store.lockTails.get(key) || Promise.resolve();
      let unlock;
      const held = new Promise((resolve) => { unlock = resolve; });
      const tail = previous.then(() => held);
      store.lockTails.set(key, tail);
      await previous;
      ownedLocks.add(key);
      heldLocks.push(() => {
        unlock();
        if (store.lockTails.get(key) === tail) store.lockTails.delete(key);
      });
    };
    const client = {
      async query(source, params = []) {
        const sql = source.replace(/\s+/g, ' ').trim().toLowerCase();
        store.log.push(sql);
        if (store.failQuery && sql.startsWith(store.failQuery)) throw new Error('simulated database failure');

        if (sql.startsWith('select id,email,role from invitations') && !sql.includes('for update')) {
          const row = store.invitations.find((item) => item.tokenHash === params[0]
            && !item.acceptedAt && new Date(item.expiresAt).getTime() > Date.now());
          return { rows: row ? [{ id: row.id, email: row.email, role: row.role }] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.startsWith('select * from users where lower(email)')) {
          const found = store.users.find((item) => item.email.toLowerCase() === String(params[0]).toLowerCase());
          if (found) await acquire(`user:${found.id}`);
          const row = found && store.users.find((item) => item.id === found.id);
          return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.startsWith('select id,email,role,status from users where id=$1 for update')
          || sql.startsWith('select id,username,email,name,role,status from users where id=$1 for update')) {
          const found = store.users.find((item) => item.id === params[0]);
          if (found) await acquire(`user:${found.id}`);
          const row = found && store.users.find((item) => item.id === found.id);
          return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.startsWith('select id,email,role from invitations') && sql.includes('for update')) {
          const found = store.invitations.find((item) => item.id === params[0] && item.tokenHash === params[1]
            && !item.acceptedAt && new Date(item.expiresAt).getTime() > Date.now());
          if (found) await acquire(`invitation:${found.id}`);
          const row = found && store.invitations.find((item) => item.id === found.id && !item.acceptedAt
            && new Date(item.expiresAt).getTime() > Date.now());
          return { rows: row ? [{ id: row.id, email: row.email, role: row.role }] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.startsWith('select 1 from guardian_patient_links')) {
          const found = store.guardianLinks.some((link) => link.guardianUserId === params[0] && link.patientType === 'student');
          return { rows: found ? [{}] : [], rowCount: found ? 1 : 0 };
        }
        if (sql.startsWith('select 1 from invitations where lower(email)=lower($1) and accepted_at is not null')) {
          const found = store.invitations.some((item) => item.email.toLowerCase() === String(params[0]).toLowerCase() && item.acceptedAt);
          return { rows: found ? [{}] : [], rowCount: found ? 1 : 0 };
        }
        if (sql.startsWith("update users set username=$1,password_hash=$2,status='active'")) {
          const [username, passwordHash, userId, role] = params;
          if (store.reservedUsernames.includes(username) || store.users.some((user) => user.id !== userId && user.username === username)) {
            const error = new Error('unique username conflict');
            error.code = '23505';
            throw error;
          }
          const user = store.users.find((item) => item.id === userId && item.status === 'invited' && item.role === role);
          if (!user) return { rows: [], rowCount: 0 };
          Object.assign(user, { username, password_hash: passwordHash, status: 'active' });
          return { rows: [{ id: userId }], rowCount: 1 };
        }
        if (sql.startsWith('update invitations set accepted_at=now()') && sql.includes('where id=$1')) {
          const invitation = store.invitations.find((item) => item.id === params[0] && !item.acceptedAt
            && new Date(item.expiresAt).getTime() > Date.now());
          if (!invitation) return { rows: [], rowCount: 0 };
          invitation.acceptedAt = new Date();
          return { rows: [{ id: invitation.id }], rowCount: 1 };
        }
        if (sql.startsWith('update users set status=$1,updated_at=now() where id=$2 returning *')) {
          const user = store.users.find((item) => item.id === params[1]);
          if (!user) return { rows: [], rowCount: 0 };
          user.status = params[0];
          return { rows: [structuredClone(user)], rowCount: 1 };
        }
        if (sql.startsWith('update invitations set expires_at=least(expires_at,now())')) {
          const email = String(params[0]).toLowerCase();
          let count = 0;
          for (const invitation of store.invitations) {
            if (invitation.email.toLowerCase() === email && !invitation.acceptedAt) {
              invitation.expiresAt = new Date(Math.min(new Date(invitation.expiresAt).getTime(), Date.now()));
              count += 1;
            }
          }
          return { rows: [], rowCount: count };
        }
        if (sql.startsWith('delete from sessions where user_id=$1')) {
          store.sessions = store.sessions.filter((session) => session.userId !== params[0]);
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('update invitations set accepted_at=now() where lower(email)')) {
          const email = String(params[0]).toLowerCase();
          let count = 0;
          for (const invitation of store.invitations) {
            if (invitation.email.toLowerCase() === email && !invitation.acceptedAt) {
              invitation.acceptedAt = new Date();
              count += 1;
            }
          }
          return { rows: [], rowCount: count };
        }
        if (sql.startsWith('insert into invitations')) {
          const [id, tokenHash, email, role, invitedBy] = params;
          const prior = store.invitations.filter((item) => item.email.toLowerCase() === email.toLowerCase())
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
          store.invitations.push({ id, tokenHash, email, role, patientId: prior?.patientId || null, invitedBy, acceptedAt: null, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) });
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("update users set status='invited',updated_at=now()")) {
          const user = store.users.find((item) => item.id === params[0] && item.status === 'deactivated');
          if (!user) return { rows: [], rowCount: 0 };
          user.status = 'invited';
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unhandled test query: ${sql}`);
      },
    };
    try {
      return await work(client);
    } catch (error) {
      if (rollback) Object.assign(store, snapshot);
      throw error;
    } finally {
      for (const release of heldLocks.reverse()) release();
    }
  };
}

function errorIs(status, code) {
  return (error) => error.status === status && error.code === code;
}

test('a valid invitation activates its matching invited account and consumes the token atomically', async () => {
  const store = createStore();
  const account = await createTransaction(store)((client) => activateInvitedAccount(client, {
    tokenHash: 'hash-1', username: 'nurse.one', passwordHash: 'new-hash',
  }));

  assert.deepEqual(account, { id: store.users[0].id, role: 'school_nurse' });
  assert.equal(store.users[0].status, 'active');
  assert.equal(store.users[0].username, 'nurse.one');
  assert.equal(store.users[0].password_hash, 'new-hash');
  assert.ok(store.invitations[0].acceptedAt);
  const accountLock = store.log.findIndex((sql) => sql.includes('users where lower(email)') && sql.includes('for update'));
  const invitationLock = store.log.findIndex((sql) => sql.includes('invitations') && sql.includes('for update'));
  assert.ok(accountLock >= 0 && invitationLock > accountLock, 'the account lock precedes the invitation lock');
});

test('activation rejects expired, consumed, missing-account, role-mismatched, and inactive-account invitations', async () => {
  for (const invitation of [
    { id: 'expired', tokenHash: 'hash-1', email: 'nurse@example.test', role: 'school_nurse', acceptedAt: null, expiresAt: new Date(Date.now() - 1000) },
    { id: 'used', tokenHash: 'hash-1', email: 'nurse@example.test', role: 'school_nurse', acceptedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  ]) {
    const store = createStore({ invitations: [invitation] });
    await assert.rejects(createTransaction(store)((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'nurse.one', passwordHash: 'hash' })), errorIs(400, 'INVALID_INVITATION'));
  }

  const missing = createStore({ users: [] });
  await assert.rejects(createTransaction(missing)((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'nurse.one', passwordHash: 'hash' })), errorIs(400, 'INVALID_INVITATION'));

  const mismatch = createStore({ role: 'guardian', invitations: [{ id: 'invitation-1', tokenHash: 'hash-1', email: 'nurse@example.test', role: 'school_nurse', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000) }] });
  await assert.rejects(createTransaction(mismatch)((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'nurse.one', passwordHash: 'hash' })), errorIs(400, 'INVALID_INVITATION'));

  for (const status of ['deactivated', 'suspended', 'active']) {
    const store = createStore({ status });
    await assert.rejects(createTransaction(store)((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'nurse.one', passwordHash: 'hash' })), errorIs(400, 'INVALID_INVITATION'));
    assert.equal(store.users[0].status, status);
    assert.equal(store.invitations[0].acceptedAt, null);
  }
});

test('student invitations remain disabled and guardian activation still requires a student link', async () => {
  const studentInvitation = { id: 'student-invite', tokenHash: 'hash-1', email: 'student@example.test', role: 'student', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const studentStore = createStore({ invitations: [studentInvitation] });
  await assert.rejects(createTransaction(studentStore)((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'student.one', passwordHash: 'hash' })), errorIs(410, 'STUDENT_INVITATIONS_REMOVED'));

  const guardian = { id: 'guardian-1', username: 'invited-guardian', email: 'guardian@example.test', name: 'Parent', role: 'guardian', status: 'invited', password_hash: 'placeholder' };
  const invitation = { id: 'guardian-invite', tokenHash: 'guardian-hash', email: guardian.email, role: 'guardian', patientId: 'student-1', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const guardianStore = createStore({ users: [guardian], invitations: [invitation] });
  await assert.rejects(createTransaction(guardianStore)((client) => activateInvitedAccount(client, { tokenHash: 'guardian-hash', username: 'parent.one', passwordHash: 'hash' })), errorIs(409, 'GUARDIAN_LINK_REQUIRED'));
  assert.equal(guardianStore.invitations[0].acceptedAt, null);
  guardianStore.guardianLinks.push({ guardianUserId: guardian.id, patientType: 'faculty' });
  await assert.rejects(createTransaction(guardianStore)((client) => activateInvitedAccount(client, { tokenHash: 'guardian-hash', username: 'parent.one', passwordHash: 'hash' })), errorIs(409, 'GUARDIAN_LINK_REQUIRED'));
  guardianStore.guardianLinks.push({ guardianUserId: guardian.id, patientType: 'student' });
  await createTransaction(guardianStore)((client) => activateInvitedAccount(client, { tokenHash: 'guardian-hash', username: 'parent.one', passwordHash: 'hash' }));
  assert.equal(guardianStore.users[0].status, 'active');
});

test('concurrent use of one invitation activates only once', async () => {
  const store = createStore();
  const transaction = createTransaction(store, { rollback: false });
  const attempt = (username) => transaction((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username, passwordHash: `${username}-hash` }));
  const results = await Promise.allSettled([attempt('nurse.one'), attempt('nurse.two')]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(store.users[0].status, 'active');
  assert.ok(store.invitations[0].acceptedAt);
  assert.ok(['nurse.one', 'nurse.two'].includes(store.users[0].username));
});

test('a username conflict leaves the invitation available for a retry', async () => {
  const store = createStore({ reservedUsernames: ['taken.name'] });
  await assert.rejects(createTransaction(store, { rollback: false })((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'taken.name', passwordHash: 'hash' })), (error) => error.code === '23505');
  assert.equal(store.users[0].status, 'invited');
  assert.equal(store.invitations[0].acceptedAt, null);

  await createTransaction(store)((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'available.name', passwordHash: 'hash' }));
  assert.equal(store.users[0].username, 'available.name');
  assert.ok(store.invitations[0].acceptedAt);
});

test('deactivation and suspension revoke unused invitations and sessions in one transaction', async () => {
  for (const status of ['deactivated', 'suspended']) {
    const store = createStore({ status: 'invited', sessions: [{ id: 'session-1', userId: '12345678-1234-4234-8234-123456789abc' }] });
    const user = await createTransaction(store)((client) => changeAccountStatus(client, {
      userId: store.users[0].id, status, actorId: 'admin-1',
    }));
    assert.equal(user.status, status);
    assert.equal(store.users[0].status, status);
    assert.ok(new Date(store.invitations[0].expiresAt).getTime() <= Date.now());
    assert.deepEqual(store.sessions, []);
    const accountLock = store.log.findIndex((sql) => sql.includes('users where id=$1 for update'));
    const invitationRevoke = store.log.findIndex((sql) => sql.includes('update invitations set expires_at'));
    assert.ok(invitationRevoke > accountLock, 'the account row is locked before pending invitations are revoked');
  }
});

test('a failed session cleanup rolls back account status and invitation revocation', async () => {
  const store = createStore({ sessions: [{ id: 'session-1', userId: '12345678-1234-4234-8234-123456789abc' }] });
  store.failQuery = 'delete from sessions';
  await assert.rejects(createTransaction(store)((client) => changeAccountStatus(client, {
    userId: store.users[0].id, status: 'deactivated', actorId: 'admin-1',
  })));
  assert.equal(store.users[0].status, 'invited');
  assert.ok(new Date(store.invitations[0].expiresAt).getTime() > Date.now());
  assert.equal(store.invitations[0].acceptedAt, null);
  assert.equal(store.sessions.length, 1);
});

test('a status change racing activation cannot be undone by the invitation', async () => {
  const store = createStore();
  const transaction = createTransaction(store, { rollback: false });
  const activation = transaction((client) => activateInvitedAccount(client, { tokenHash: 'hash-1', username: 'nurse.one', passwordHash: 'hash' }));
  const deactivation = transaction((client) => changeAccountStatus(client, { userId: store.users[0].id, status: 'deactivated', actorId: 'admin-1' }));
  const [activationResult, statusResult] = await Promise.allSettled([activation, deactivation]);

  assert.equal(statusResult.status, 'fulfilled');
  assert.equal(store.users[0].status, 'deactivated');
  assert.deepEqual(store.sessions, []);
  if (activationResult.status === 'rejected') assert.equal(store.invitations[0].acceptedAt, null);
});

test('canceled never-activated accounts can receive a fresh invitation, while regular deactivated accounts cannot', async () => {
  const canceled = createStore({ status: 'deactivated', invitations: [{ id: 'invitation-1', tokenHash: 'hash-1', email: 'nurse@example.test', role: 'school_nurse', patientId: 'student-1', acceptedAt: null, expiresAt: new Date(Date.now() - 1000) }] });
  const renewed = await createTransaction(canceled)((client) => renewPendingInvitation(client, {
    userId: canceled.users[0].id, invitationId: 'invitation-2', tokenHash: 'hash-2', invitedBy: 'admin-1',
  }));
  assert.equal(renewed.status, 'invited');
  assert.equal(canceled.users[0].status, 'invited');
  assert.ok(new Date(canceled.invitations[0].expiresAt).getTime() <= Date.now());
  assert.equal(canceled.invitations[0].acceptedAt, null);
  assert.equal(canceled.invitations[1].tokenHash, 'hash-2');
  assert.equal(canceled.invitations[1].patientId, 'student-1');
  assert.ok(new Date(canceled.invitations[1].expiresAt).getTime() > Date.now());

  const regular = createStore({ status: 'deactivated' });
  regular.users[0].username = 'nurse.one';
  await assert.rejects(createTransaction(regular)((client) => renewPendingInvitation(client, {
    userId: regular.users[0].id, invitationId: 'invitation-2', tokenHash: 'hash-2', invitedBy: 'admin-1',
  })), errorIs(409, 'NOT_INVITED'));

  const acceptedAccount = createStore({ status: 'deactivated' });
  acceptedAccount.invitations[0].acceptedAt = new Date();
  await assert.rejects(createTransaction(acceptedAccount)((client) => renewPendingInvitation(client, {
    userId: acceptedAccount.users[0].id, invitationId: 'invitation-2', tokenHash: 'hash-2', invitedBy: 'admin-1',
  })), errorIs(409, 'NOT_INVITED'));

  const suspended = createStore({ status: 'suspended' });
  await assert.rejects(createTransaction(suspended)((client) => renewPendingInvitation(client, {
    userId: suspended.users[0].id, invitationId: 'invitation-2', tokenHash: 'hash-2', invitedBy: 'admin-1',
  })), errorIs(409, 'NOT_INVITED'));
});
