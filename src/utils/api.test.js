import test from 'node:test';
import assert from 'node:assert/strict';
import { api, apiRequest, CLINIC_DATA_REQUEST_TIMEOUT_MS } from './api.js';

function abortablePending(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

test('clinic-data GET times out while waiting for response headers', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal;
  globalThis.fetch = (_url, options) => {
    receivedSignal = options.signal;
    return abortablePending(options.signal);
  };
  try {
    await assert.rejects(
      apiRequest('/api/data', { timeoutMs: 5 }),
      (error) => error.code === 'REQUEST_TIMEOUT' && /taking too long to load/.test(error.message),
    );
    assert.equal(receivedSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('clinic-data GET timeout also covers a stalled response body', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal;
  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return {
      ok: true,
      json: () => abortablePending(options.signal),
    };
  };
  try {
    await assert.rejects(
      api.get('/api/data', { timeoutMs: 5 }),
      (error) => error.code === 'REQUEST_TIMEOUT',
    );
    assert.equal(receivedSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('successful clinic-data GET clears its timer before a later abort', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal;
  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return { ok: true, json: async () => ({ data: { schemaVersion: 48 } }) };
  };
  try {
    assert.deepEqual(await api.get('/api/data', { timeoutMs: 5 }), { schemaVersion: 48 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(receivedSignal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('clinic-data GET preserves a caller abort signal', async () => {
  const originalFetch = globalThis.fetch;
  const caller = new AbortController();
  let requestSignal;
  globalThis.fetch = (_url, options) => {
    requestSignal = options.signal;
    return abortablePending(options.signal);
  };
  try {
    const request = api.get('/api/data', { timeoutMs: 1000, signal: caller.signal });
    caller.abort();
    await assert.rejects(request, (error) => error.code === 'REQUEST_ABORTED');
    assert.equal(requestSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the clinic-data deadline is generous and does not abort clinic writes', async () => {
  assert.equal(CLINIC_DATA_REQUEST_TIMEOUT_MS, 60_000);
  const originalFetch = globalThis.fetch;
  let receivedSignal = 'unset';
  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return { ok: true, json: async () => ({ data: { schemaVersion: 49 } }) };
  };
  try {
    const result = await api.put('/api/data', { data: { students: [] }, version: 48 });
    assert.deepEqual(result, { schemaVersion: 49 });
    assert.equal(receivedSignal, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
