import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, ensureSameOrigin, loginOtpRequired, requestOriginAllowed } from './security.js';
import { createApp } from './app.js';

test('development origins include configured URLs and local Vite fallback ports', () => {
  const env = {
    NODE_ENV: 'development',
    APP_URL: 'http://localhost:5173/',
    DEV_APP_URL: 'http://clinic.local:5173/app',
  };

  assert.equal(requestOriginAllowed('http://localhost:5173', env), true);
  assert.equal(requestOriginAllowed('http://localhost:5174', env), true);
  assert.equal(requestOriginAllowed('http://127.0.0.1:5175', env), true);
  assert.equal(requestOriginAllowed('http://[::1]:5176', env), true);
  assert.equal(requestOriginAllowed('http://clinic.local:5173', env), true);
  assert.equal(requestOriginAllowed('http://evil.example:5173', env), false);
  assert.equal(requestOriginAllowed('null', env), false);
});

test('same-origin middleware accepts localhost:5175 and rejects an untrusted host', () => {
  const originalEnvironment = new Map(
    ['NODE_ENV', 'APP_URL', 'DEV_APP_URL'].map((key) => [key, process.env[key]]),
  );
  process.env.NODE_ENV = 'development';
  process.env.APP_URL = 'http://localhost:5173';
  process.env.DEV_APP_URL = 'http://localhost:5173';

  try {
    const registeredGate = createApp().router.stack.find((layer) => layer.handle === ensureSameOrigin)?.handle;
    assert.equal(registeredGate, ensureSameOrigin);

    const invoke = (origin) => {
      let statusCode = 200;
      let responseBody;
      let nextCalled = false;
      const response = {
        status(code) { statusCode = code; return this; },
        json(body) { responseBody = body; return this; },
      };
      registeredGate({ method: 'POST', headers: { origin } }, response, () => { nextCalled = true; });
      return { statusCode, responseBody, nextCalled };
    };

    assert.deepEqual(invoke('http://localhost:5175'), { statusCode: 200, responseBody: undefined, nextCalled: true });
    assert.deepEqual(invoke('http://untrusted.example:5175'), {
      statusCode: 403,
      responseBody: { error: { code: 'ORIGIN_REJECTED', message: 'The request origin is not allowed.' } },
      nextCalled: false,
    });
  } finally {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('production accepts only the configured application origin', () => {
  const env = {
    NODE_ENV: 'production',
    APP_URL: 'https://clinic.example.edu.ph/',
    DEV_APP_URL: 'http://localhost:5173',
  };

  assert.deepEqual(allowedOrigins(env), ['https://clinic.example.edu.ph']);
  assert.equal(requestOriginAllowed('https://clinic.example.edu.ph', env), true);
  assert.equal(requestOriginAllowed('http://localhost:5173', env), false);
});

test('local development origins are not enabled in test or unset environments', () => {
  for (const nodeEnv of ['test', undefined]) {
    const env = {
      ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
      APP_URL: 'https://clinic.example.edu.ph',
      DEV_APP_URL: 'http://localhost:5173',
    };
    assert.deepEqual(allowedOrigins(env), ['https://clinic.example.edu.ph']);
    assert.equal(requestOriginAllowed('http://localhost:5175', env), false);
  }
});

test('login OTP can be disabled only in development', () => {
  assert.equal(loginOtpRequired({ NODE_ENV: 'development', REQUIRE_LOGIN_OTP: 'false' }), false);
  assert.equal(loginOtpRequired({ NODE_ENV: 'development' }), true);
  assert.equal(loginOtpRequired({ NODE_ENV: 'development', REQUIRE_LOGIN_OTP: 'true' }), true);
  assert.equal(loginOtpRequired({ NODE_ENV: 'production', REQUIRE_LOGIN_OTP: 'false' }), true);
  assert.equal(loginOtpRequired({ NODE_ENV: 'test', REQUIRE_LOGIN_OTP: 'false' }), true);
  assert.equal(loginOtpRequired({ REQUIRE_LOGIN_OTP: 'false' }), true);
});
