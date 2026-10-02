import test from 'node:test';
import assert from 'node:assert/strict';
import { listInAppNotifications, markInAppNotificationRead } from './notifications.js';

const notices = [
  { id: 'app-owned', user_id: 'guardian-1', channel: 'in_app', status: 'queued' },
  { id: 'email-owned', user_id: 'guardian-1', channel: 'email', status: 'sent' },
  { id: 'app-other', user_id: 'guardian-2', channel: 'in_app', status: 'queued' },
];

test('notification listing includes only the signed-in user’s in-app channel', async () => {
  let sql;
  let params;
  const result = await listInAppNotifications('guardian-1', async (statement, values) => {
    sql = statement;
    params = values;
    return { rows: notices.filter((notice) => notice.user_id === values[0] && notice.channel === 'in_app') };
  });

  assert.match(sql, /user_id=\$1/);
  assert.match(sql, /channel='in_app'/);
  assert.deepEqual(params, ['guardian-1']);
  assert.deepEqual(result.rows.map(({ id }) => id), ['app-owned']);
});

test('marking read cannot alter email delivery state or another user’s notice', async () => {
  const queryCalls = [];
  const queryFn = async (sql, params) => {
    queryCalls.push({ sql, params });
    const notice = notices.find((entry) => entry.id === params[0]
      && entry.user_id === params[1]
      && entry.channel === 'in_app');
    if (!notice) return { rows: [], rowCount: 0 };
    notice.status = 'read';
    return { rows: [notice], rowCount: 1 };
  };

  const owned = await markInAppNotificationRead('app-owned', 'guardian-1', queryFn);
  const email = await markInAppNotificationRead('email-owned', 'guardian-1', queryFn);
  const other = await markInAppNotificationRead('app-other', 'guardian-1', queryFn);

  assert.match(queryCalls[0].sql, /user_id=\$2/);
  assert.match(queryCalls[0].sql, /channel='in_app'/);
  assert.deepEqual(queryCalls[0].params, ['app-owned', 'guardian-1']);
  assert.equal(owned.rowCount, 1);
  assert.equal(email.rowCount, 0);
  assert.equal(other.rowCount, 0);
  assert.equal(notices.find(({ id }) => id === 'app-owned').status, 'read');
  assert.equal(notices.find(({ id }) => id === 'email-owned').status, 'sent');
  assert.equal(notices.find(({ id }) => id === 'app-other').status, 'queued');
});
