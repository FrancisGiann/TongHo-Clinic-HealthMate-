import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabasePrivateStorage } from './supabasePrivateStorage.js';

test('private storage uses the configured bucket and credential only in server-side request headers', async () => {
  const calls = [];
  const storage = new SupabasePrivateStorage({
    env: { SUPABASE_URL: 'https://unit-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-secret', SUPABASE_STORAGE_BUCKET: 'private' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('image').buffer };
    },
  });
  await storage.upload('private', 'incidents/one/photo.png', Buffer.from([1, 2]), 'image/png');
  assert.equal(calls[0].url, 'https://unit-test.supabase.co/storage/v1/object/private/incidents/one/photo.png');
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-secret');
  assert.equal(JSON.stringify(calls[0]).includes('test-secret'), true);
  assert.throws(() => storage.objectUrl('private', 'branding/../incidents/one'), { code: 'INVALID_STORAGE_KEY' });
  assert.throws(() => storage.objectUrl('other', 'incidents/one'), { code: 'STORAGE_UNAVAILABLE' });
});

test('storage failures expose only a safe code and object removal uses the private bucket API', async () => {
  const deleteCalls = [];
  const storage = new SupabasePrivateStorage({
    env: { SUPABASE_URL: 'https://unit-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret', SUPABASE_STORAGE_BUCKET: 'private' },
    fetchImpl: async (url, options) => {
      if (options.method === 'DELETE') { deleteCalls.push({ url, options }); return { ok: true, status: 200 }; }
      return { ok: false, status: 503, text: async () => 'secret provider details' };
    },
  });
  await assert.rejects(storage.upload('private', 'branding/logo.png', Buffer.from([1]), 'image/png'), (error) => {
    assert.equal(error.code, 'STORAGE_WRITE_503');
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  assert.equal(await storage.remove('private', 'incidents/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png'), true);
  assert.equal(deleteCalls[0].url, 'https://unit-test.supabase.co/storage/v1/object/private');
  assert.equal(JSON.parse(deleteCalls[0].options.body).prefixes[0].startsWith('incidents/'), true);
});
