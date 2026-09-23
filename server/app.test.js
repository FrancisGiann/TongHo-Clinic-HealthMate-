import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

test('application factory exposes an Express request handler', () => {
  const app = createApp();
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.use, 'function');
  assert.equal(typeof app.listen, 'function');
  assert.equal(app.get('trust proxy'), 1);
});

test('every inventory write route applies a nurse-only authorization guard', () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => layer.route?.path?.startsWith('/api/inventory'))
    .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods), guard: layer.route.stack[0].handle }));

  assert.deepEqual(routes.map(({ path, methods }) => [path, methods]), [
    ['/api/inventory', ['post']],
    ['/api/inventory/:id', ['patch']],
    ['/api/inventory/:id/stock-adjustments', ['post']],
    ['/api/inventory/:id/archive', ['patch']],
  ]);
  for (const route of routes) {
    const result = (role) => {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      route.guard({ user: { role } }, response, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    };
    assert.deepEqual(result('school_nurse'), { statusCode: 200, nextCalled: true }, `${route.path} allows nurses`);
    assert.deepEqual(result('system_administrator'), { statusCode: 403, nextCalled: false }, `${route.path} rejects administrators`);
    assert.deepEqual(result('student'), { statusCode: 403, nextCalled: false }, `${route.path} rejects portal users`);
  }
});

test('visit creation and clinical snapshot writes are restricted to school nurses', () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => (layer.route?.path === '/api/visits' && layer.route.methods.post)
      || (layer.route?.path === '/api/data' && layer.route.methods.put))
    .map((layer) => ({ path: layer.route.path, guard: layer.route.stack[0].handle }));

  assert.deepEqual(routes.map(({ path }) => path).sort(), ['/api/data', '/api/visits']);
  for (const route of routes) {
    const result = (role) => {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      route.guard({ user: { role } }, response, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    };
    assert.deepEqual(result('school_nurse'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(result('system_administrator'), { statusCode: 403, nextCalled: false });
    assert.deepEqual(result('student'), { statusCode: 403, nextCalled: false });
    assert.deepEqual(result('guardian'), { statusCode: 403, nextCalled: false });
  }
});
