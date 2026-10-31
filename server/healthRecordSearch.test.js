import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

test('health record search binds a literal student name/ID filter before paginating queue and history', async () => {
  const calls = [];
  const app = createApp({ queryFn: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: Array.from({ length: 101 }, (_, id) => ({ id: `synthetic-${id}` })) };
  } });
  const route = app.router.stack.find(layer => layer.route?.path === '/api/nurse/health-record-submissions').route;
  const handler = route.stack.at(-1).handle;
  for (const history of [false, true]) {
    let body;
    await handler({ query: { history: String(history), q: "  Synthetic_%' Student  ", offset: '100' } }, { json(value) { body = value; } });
    const { sql, params } = calls.at(-1);
    assert.deepEqual(params, [history, 101, 100, "Synthetic_%' Student"]);
    assert.match(sql, /strpos\(lower\(concat_ws\(' ', p.data->>'name', p.data->>'studentId'\)\), lower\(\$4\)\) > 0/);
    assert.ok(sql.indexOf('AND ($4') < sql.indexOf('LIMIT $2'));
    assert.ok(!sql.includes("Synthetic_%' Student"));
    assert.equal(body.data.submissions.length, 100);
    assert.equal(body.data.nextOffset, 200);
  }
  let body;
  await handler({ query: {} }, { json(value) { body = value; } });
  assert.deepEqual(calls.at(-1).params, [false, 101, 0, '']);
  assert.equal(body.data.nextOffset, 100);
  await handler({ query: { q: 'x'.repeat(500) } }, { json() {} });
  assert.equal(calls.at(-1).params[3].length, 200);
});
