import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEncounter, templateSummary } from './ai.js';

test('template summary excludes patient identity fields', () => {
  const summary = templateSummary({
    patientName: 'Sensitive Name',
    guardianPhone: '+63 900 000 0000',
    type: 'Illness',
    chiefComplaint: 'Headache',
    treatment: 'Rest',
    disposition: 'Returned to class',
  });
  assert.match(summary, /Headache/);
  assert.doesNotMatch(summary, /Sensitive Name/);
  assert.doesNotMatch(summary, /900 000/);
});

test('template fallback summary includes the supplied visit type and chief complaint', async () => {
  const previousEndpoint = process.env.AI_SUMMARY_ENDPOINT;
  const previousApiKey = process.env.AI_SUMMARY_API_KEY;
  delete process.env.AI_SUMMARY_ENDPOINT;
  delete process.env.AI_SUMMARY_API_KEY;

  try {
    const result = await summarizeEncounter({
      type: 'Illness',
      chiefComplaint: 'Headache',
      treatment: 'Rest and hydration',
    });

    assert.equal(result.provider, 'template');
    assert.match(result.draft, /Illness consultation for Headache\./);
  } finally {
    if (previousEndpoint === undefined) delete process.env.AI_SUMMARY_ENDPOINT;
    else process.env.AI_SUMMARY_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_SUMMARY_API_KEY;
    else process.env.AI_SUMMARY_API_KEY = previousApiKey;
  }
});
