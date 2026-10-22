import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { createDefaultLandingContent } from './domain/landingContent.js';

function route(app, path, method) {
  const found = app.router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
  assert.ok(found, `${method.toUpperCase()} ${path} exists`);
  return found.route;
}

function responseRecorder() {
  let statusCode = 200;
  let body;
  const response = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  return { response, getResult: () => ({ statusCode, body }) };
}

function request({ version = 1, content = createDefaultLandingContent(), role = 'system_administrator' } = {}) {
  return { body: { version, content }, user: { id: 'admin-user', role }, headers: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
}

test('public landing endpoint queries and returns published projection only; CMS content routes are administrator-only', async () => {
  const draftContent = createDefaultLandingContent();
  draftContent.hero.headline = 'Unpublished draft secret';
  const publishedContent = createDefaultLandingContent();
  publishedContent.hero.headline = 'Published headline';
  let queryText = '';
  const app = createApp({ queryFn: async (sql) => {
    queryText = sql;
    return { rows: [{ published_content: publishedContent, draft_content: draftContent }] };
  } });
  const publicRoute = route(app, '/api/landing-content', 'get');
  const recorded = responseRecorder();
  await publicRoute.stack.at(-1).handle({ query: { preview: 'draft' } }, recorded.response);
  const result = recorded.getResult();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.hero.headline, 'Published headline');
  assert.equal('draftContent' in result.body.data, false);
  assert.notEqual(result.body.data.hero.headline, 'Unpublished draft secret');
  assert.doesNotMatch(queryText, /draft_content/i);

  for (const [path, method] of [
    ['/api/admin/landing-content', 'get'],
    ['/api/admin/landing-content/draft', 'put'],
    ['/api/admin/landing-content/publish', 'post'],
  ]) {
    const guardedRoute = route(app, path, method);
    const guard = guardedRoute.stack[0].handle;
    for (const [role, statusCode] of [['system_administrator', 200], ['school_nurse', 403], ['guardian', 403], [null, 401]]) {
      const response = responseRecorder();
      let nextCalled = false;
      guard({ user: role ? { role } : undefined }, response.response, () => { nextCalled = true; });
      assert.equal(response.getResult().statusCode, statusCode, `${role || 'anonymous'} ${method} ${path}`);
      assert.equal(nextCalled, statusCode === 200);
    }
  }
});

test('draft save validates input, locks and version-checks the row, then audits in the same transaction', async () => {
  const state = { contentVersion: 7, draftContent: createDefaultLandingContent(), publishedContent: createDefaultLandingContent(), draftUpdatedAt: null, publishedAt: null };
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (/SELECT content_version FROM branding_settings/.test(sql)) return { rows: [{ content_version: state.contentVersion }] };
      if (/SET draft_content=/.test(sql)) {
        state.draftContent = JSON.parse(params[0]);
        state.contentVersion += 1;
        state.draftUpdatedAt = '2026-10-22T02:00:00.000Z';
        return { rows: [{ content_version: state.contentVersion, draft_content: state.draftContent, published_content: state.publishedContent, draft_updated_at: state.draftUpdatedAt, published_at: state.publishedAt }] };
      }
      if (/INSERT INTO audit_logs/.test(sql)) return { rowCount: 1 };
      throw new Error(`Unexpected content-save query: ${sql}`);
    },
  };
  let transactionCount = 0;
  const app = createApp({ transactionFn: async (work) => { transactionCount += 1; return work(client); } });
  const handler = route(app, '/api/admin/landing-content/draft', 'put').stack.at(-1).handle;
  const content = createDefaultLandingContent();
  content.hero.headline = 'A saved clinic update';
  const recorded = responseRecorder();
  await handler(request({ version: 7, content }), recorded.response);
  assert.equal(recorded.getResult().statusCode, 200);
  assert.equal(recorded.getResult().body.data.contentVersion, 8);
  assert.equal(recorded.getResult().body.data.draftContent.hero.headline, 'A saved clinic update');
  assert.equal(transactionCount, 1);
  assert.match(statements[0].sql, /FOR UPDATE/);
  assert.equal(statements.at(-1).params[1], 'LANDING_CONTENT_DRAFT_SAVED');
  assert.equal(statements.at(-1).params[3], 'draft');

  let invalidTransactionCount = 0;
  const invalidApp = createApp({ transactionFn: async () => { invalidTransactionCount += 1; } });
  const invalidHandler = route(invalidApp, '/api/admin/landing-content/draft', 'put').stack.at(-1).handle;
  const invalid = createDefaultLandingContent();
  invalid.hero.headline = '';
  const invalidResponse = responseRecorder();
  await invalidHandler(request({ content: invalid }), invalidResponse.response);
  assert.equal(invalidResponse.getResult().statusCode, 400);
  assert.equal(invalidTransactionCount, 0);
});

test('stale draft saves return 409 without replacing local content or writing an audit event', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (/SELECT content_version FROM branding_settings/.test(sql)) return { rows: [{ content_version: 9 }] };
    throw new Error(`Stale save must stop before write: ${sql}`);
  } };
  const app = createApp({ transactionFn: (work) => work(client) });
  const handler = route(app, '/api/admin/landing-content/draft', 'put').stack.at(-1).handle;
  const recorded = responseRecorder();
  await handler(request({ version: 8 }), recorded.response);
  assert.equal(recorded.getResult().statusCode, 409);
  assert.equal(recorded.getResult().body.error.code, 'LANDING_CONTENT_VERSION_CONFLICT');
  assert.equal(statements.length, 1);
});

test('publish atomically copies only the saved draft, increments its version, and audits publication', async () => {
  const savedDraft = createDefaultLandingContent();
  savedDraft.hero.headline = 'Saved draft copy';
  const unsavedClientCopy = createDefaultLandingContent();
  unsavedClientCopy.hero.headline = 'Unsaved browser copy';
  const statements = [];
  let published;
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (/SELECT content_version,draft_content FROM branding_settings/.test(sql)) {
        return { rows: [{ content_version: 4, draft_content: savedDraft }] };
      }
      if (/SET published_content=/.test(sql)) {
        published = JSON.parse(params[0]);
        return { rows: [{ content_version: 5, draft_content: savedDraft, published_content: published, draft_updated_at: '2026-10-22T01:00:00Z', published_at: '2026-10-22T02:00:00Z' }] };
      }
      if (/INSERT INTO audit_logs/.test(sql)) return { rowCount: 1 };
      throw new Error(`Unexpected publish query: ${sql}`);
    },
  };
  const app = createApp({ transactionFn: (work) => work(client) });
  const handler = route(app, '/api/admin/landing-content/publish', 'post').stack.at(-1).handle;
  const recorded = responseRecorder();
  await handler(request({ version: 4, content: unsavedClientCopy }), recorded.response);
  assert.equal(recorded.getResult().statusCode, 200);
  assert.equal(recorded.getResult().body.data.contentVersion, 5);
  assert.equal(published.hero.headline, 'Saved draft copy');
  assert.notEqual(published.hero.headline, unsavedClientCopy.hero.headline);
  assert.match(statements[0].sql, /FOR UPDATE/);
  assert.equal(statements.at(-1).params[1], 'LANDING_CONTENT_PUBLISHED');
});
