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
