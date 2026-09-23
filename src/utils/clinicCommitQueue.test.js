import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueClinicCommit } from './clinicCommitQueue.js';

test('simultaneous clinic commits read successive versions from one serialized queue', async () => {
  const queue = { current: Promise.resolve() };
  const saves = [];
  let version = 1;
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const commit = (label) => enqueueClinicCommit(queue, async () => {
    const submittedVersion = version;
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    saves.push({ label, version: submittedVersion });
    version += 1;
    activeRequests -= 1;
    return submittedVersion;
  });

  const results = await Promise.all([commit('first'), commit('second')]);
  assert.deepEqual(results, [1, 2]);
  assert.deepEqual(saves, [{ label: 'first', version: 1 }, { label: 'second', version: 2 }]);
  assert.equal(maximumActiveRequests, 1);
});

test('a failed clinic commit does not block later queued work', async () => {
  const queue = { current: Promise.resolve() };
  const failed = enqueueClinicCommit(queue, async () => { throw new Error('save failed'); });
  const succeeding = enqueueClinicCommit(queue, async () => 'saved');
  await assert.rejects(failed, /save failed/);
  assert.equal(await succeeding, 'saved');
});
