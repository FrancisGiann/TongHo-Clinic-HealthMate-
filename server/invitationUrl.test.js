import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvitationActivationUrl } from './invitationUrl.js';

test('invitation activation URLs open the sign-in route and safely encode the token', () => {
  const activationUrl = new URL(buildInvitationActivationUrl('raw token/with+symbols', 'https://school.example/'));

  assert.equal(activationUrl.origin, 'https://school.example');
  assert.equal(activationUrl.pathname, '/login');
  assert.equal(activationUrl.searchParams.get('activate'), 'raw token/with+symbols');
});

test('invitation activation URLs use the configured app host even when it has a path', () => {
  const activationUrl = new URL(buildInvitationActivationUrl('token', 'https://school.example/subpath/'));

  assert.equal(activationUrl.origin, 'https://school.example');
  assert.equal(activationUrl.pathname, '/login');
});
