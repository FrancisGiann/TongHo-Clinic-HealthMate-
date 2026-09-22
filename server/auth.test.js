import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, normalizeIdentifier, validEmail, validatePassword } from './auth.js';

test('authentication input helpers normalize identifiers and validate email', () => {
  assert.equal(normalizeIdentifier('  Nurse@Example.COM '), 'nurse@example.com');
  assert.equal(validEmail('nurse@example.com'), true);
  assert.equal(validEmail('not-an-email'), false);
});

test('password policy requires length and character classes', () => {
  assert.match(validatePassword('short') || '', /12 characters/);
  assert.match(validatePassword('alllowercase123') || '', /uppercase/i);
  assert.equal(validatePassword('StrongPassword1!'), null);
});

test('secret hashing is deterministic without returning the source value', () => {
  const first = hashSecret('sensitive-token');
  assert.equal(first, hashSecret('sensitive-token'));
  assert.notEqual(first, 'sensitive-token');
  assert.equal(first.length, 64);
});
