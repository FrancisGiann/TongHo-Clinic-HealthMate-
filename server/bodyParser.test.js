import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import express from 'express';

async function parse(bytes, { encoding, limit = '16kb' } = {}) {
  const req = new PassThrough();
  req.headers = { 'content-type': 'application/json', 'content-length': String(bytes.length), ...(encoding ? { 'content-encoding': encoding } : {}) };
  req.method = 'POST';
  const result = new Promise(resolve => express.json({ limit })(req, {}, error => resolve({ error, body: req.body })));
  req.end(bytes);
  const parsed = await result;
  await new Promise(resolve => setImmediate(resolve));
  return parsed;
}

test('JSON parser accepts ordinary and gzip JSON', async () => {
  for (const encoding of [undefined, 'gzip']) {
    const json = Buffer.from('{"synthetic":true}');
    const result = await parse(encoding ? gzipSync(json) : json, { encoding });
    assert.ifError(result.error);
    assert.deepEqual(result.body, { synthetic: true });
  }
});
test('malformed and oversized JSON return controlled errors', async () => {
  assert.equal((await parse(Buffer.from('{broken'))).error.status, 400);
  assert.equal((await parse(Buffer.from(JSON.stringify({ text: 'x'.repeat(100) })), { limit: '16b' })).error.status, 413);
});
test('gzip trailing garbage cannot escape as an uncaught decoder exception', async () => {
  const bytes = Buffer.concat([gzipSync(Buffer.from('{"synthetic":true}')), Buffer.from('invalid trailing bytes')]);
  const result = await parse(bytes, { encoding: 'gzip' });
  assert.ok(result.error || result.body?.synthetic === true);
  if (result.error) assert.equal(result.error.status, 400);
  // Also ensure the parser can process the next request after this malformed one.
  assert.ifError((await parse(Buffer.from('{}'))).error);
});
