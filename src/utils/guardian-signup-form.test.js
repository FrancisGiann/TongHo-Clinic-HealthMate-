import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../pages/Login.jsx', import.meta.url), 'utf8');
// Exercise the actual component event handlers with state/API doubles. This is
// not a DOM test: it guards the blank optional-field crash before the API call.
function handler(name) {
  const start = source.indexOf(`  const ${name} = `);
  assert.notEqual(start, -1);
  const end = source.indexOf('\n  };', start);
  return source.slice(start, end + 5).replace(`const ${name} =`, `globalThis.${name} =`);
}
function harness() {
  const context = vm.createContext({
    guardianSignup: {}, guardianSignupStep: 1, mode: 'signin', requests: [], loading: false,
    clearMessages() {}, setGuardianSignupChallengeId() {}, setCode() {},
    setGuardianSignupStep() {}, setMode() {}, setSuccess() {}, setGuardianSignupResendSeconds() {},
    validatePasswordStrength: () => ({ valid: true }), normalizeUsername: v => v.trim().toLowerCase(),
    reportSignupError: message => { throw new Error(message); },
  });
  context.setGuardianSignup = value => { context.guardianSignup = typeof value === 'function' ? value(context.guardianSignup) : value; };
  context.setGuardianSignupStep = value => { context.guardianSignupStep = typeof value === 'function' ? value(context.guardianSignupStep) : value; };
  context.setMode = value => { context.mode = value; };
  context.setLoading = value => { context.loading = value; };
  context.requestGuardianSignup = async value => { context.requests.push(value); return {success:true,challengeId:'synthetic'}; };
  for (const name of ['startGuardianSignup','exitGuardianSignup','moveGuardianSignupBack','sendGuardianSignupCode','submitGuardianSignupStep']) vm.runInContext(handler(name), context);
  return context;
}
for (const restart of [false, true]) test(`signup with untouched optional section and student ID${restart ? ' after cancel/reopen' : ''} reaches API`, async () => {
  const h = harness();
  h.startGuardianSignup();
  if (restart) { h.guardianSignup.section = 'Old section'; h.exitGuardianSignup(); h.startGuardianSignup(); }
  Object.assign(h.guardianSignup, {name:'Synthetic Parent',email:'parent@example.test',username:'parent',password:'SyntheticPassword1!',confirmPassword:'SyntheticPassword1!',childName:'Synthetic Student',gradeLevel:'Grade 4'});
  assert.equal(h.mode, 'guardian-signup');
  assert.equal(h.guardianSignupStep, 1);
  await h.submitGuardianSignupStep({preventDefault(){}});
  assert.equal(h.guardianSignupStep, 2);
  await h.submitGuardianSignupStep({preventDefault(){}});
  assert.equal(h.guardianSignupStep, 3);
  h.moveGuardianSignupBack();
  assert.equal(h.guardianSignupStep, 2);
  await h.submitGuardianSignupStep({preventDefault(){}});
  assert.equal(h.guardianSignupStep, 3);
  assert.equal(h.requests.length, 0);
  await h.submitGuardianSignupStep({preventDefault(){}});
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].section,'');
  assert.equal(h.requests[0].studentId,'');
  assert.equal(h.requests[0].childName,'Synthetic Student');
  assert.equal(h.loading,false);
  assert.equal(h.mode, 'guardian-signup-verify');
  assert.equal(h.guardianSignupStep, 4);
});
