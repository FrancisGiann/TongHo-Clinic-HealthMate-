import test from 'node:test';
import assert from 'node:assert/strict';
import { getSafeReturnPath } from './navigation.js';

test('safe return paths retain a deep link path, query, and hash', () => {
  assert.equal(getSafeReturnPath({
    pathname: '/students/123',
    search: '?tab=visits&filter=recent',
    hash: '#history',
  }), '/students/123?tab=visits&filter=recent#history');
});

test('safe return paths reject external, protocol-relative, and login destinations', () => {
  assert.equal(getSafeReturnPath({ pathname: '//example.com/path' }), '/');
  assert.equal(getSafeReturnPath({ pathname: '/\\\\example.com/path' }), '/');
  assert.equal(getSafeReturnPath({ pathname: '/login', search: '?returnTo=/students' }), '/');
  assert.equal(getSafeReturnPath({ pathname: 'https://example.com/path' }), '/');
});

test('safe return paths remove account activation tokens', () => {
  assert.equal(getSafeReturnPath({
    pathname: '/appointments',
    search: '?activate=secret&month=may',
    hash: '#upcoming',
  }), '/appointments?month=may#upcoming');
});
