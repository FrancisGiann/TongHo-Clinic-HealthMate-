import test from 'node:test';
import assert from 'node:assert/strict';
import { otpEmail, invitationEmail, notificationEmail, guardianDecisionEmail } from './emailTemplates.js';

test('every email family has the same accessible shell and a complete text alternative', () => {
  const messages = ['login', 'guardian signup', 'password reset', 'verification'].map((purpose) => otpEmail('012345', purpose));
  messages.push(invitationEmail('Example Guardian', 'https://example.invalid/login?invite=synthetic&source=test'),
    notificationEmail({ name: 'Example', subject: 'Clinic update', body: 'First line\nSecond line', authorizedDetails: true }),
    notificationEmail({ name: 'Example', subject: 'School notice', body: 'Synthetic notice' }),
    guardianDecisionEmail(true, 'Example'), guardianDecisionEmail(false, 'Example'));
  for (const message of messages) {
    assert.match(message.html, /<html lang="en">/);
    assert.match(message.html, /role="presentation"/);
    assert.match(message.html, /Tong Ho Clinic/);
    assert.match(message.text, /HealthMate\+ \| Tong Ho Clinic/);
    assert.doesNotMatch(message.html, /<script|<img|@import|display:flex|display:grid/);
    assert.ok(message.subject && message.text && message.html);
  }
});

test('codes retain leading zeros and actual expiry in HTML and text; subjects remain stable', () => {
  const message = otpEmail('012345', 'password reset');
  assert.equal(message.subject, 'HealthMate+ password reset code');
  for (const body of [message.html, message.text]) {
    assert.match(body, /012345/);
    assert.match(body, /5 minutes/);
    assert.match(body, /Do not share/);
  }
  const invitation = invitationEmail('Example', 'https://example.invalid/login?invite=synthetic');
  for (const body of [invitation.text, invitation.html]) assert.match(body, /72 hours/);
  assert.match(invitation.text, /https:\/\/example.invalid\/login\?invite=synthetic/);
});

test('untrusted names, codes, messages, subjects and URL attributes are escaped', () => {
  const attack = '<script>alert("x")</script>';
  for (const message of [otpEmail(attack, attack), invitationEmail(attack, 'https://example.invalid/?x=" onmouseover="bad'), notificationEmail({ name: attack, subject: attack, body: attack + '\nNext' }), guardianDecisionEmail(false, attack)]) {
    assert.doesNotMatch(message.html, /<script>|href="[^"]*" onmouseover=/);
    assert.match(message.html, /&lt;script&gt;/);
  }
  assert.match(notificationEmail({ subject: 'Notice', body: 'One\nTwo' }).html, /One<br>Two/);
});

test('long synthetic messages and names remain intact, and decisions disclose no rejection reason', () => {
  const body = 'Long synthetic notice. '.repeat(100);
  assert.ok(notificationEmail({ name: 'Name'.repeat(50), subject: 'Notice', body }).text.includes(body));
  const rejected = guardianDecisionEmail(false, 'Example');
  assert.match(rejected.text, /was not approved/);
  assert.doesNotMatch(rejected.text, /student ID|medical|rejection reason/i);
});

test('approved guardian and nurse invitations provide ordinary sign-in links without replacing activation', () => {
  const url = 'https://healthmateplus.com/login';
  const approved = guardianDecisionEmail(true, 'Example', url);
  assert.ok(approved.html.includes(`href="${url}"`));
  assert.ok(approved.text.includes(`Sign in to HealthMate: ${url}`));
  assert.ok(!guardianDecisionEmail(false, 'Example', url).html.includes(`href="${url}"`));
  const invite = invitationEmail('Example Nurse', 'https://healthmateplus.com/login?activate=synthetic-only', url);
  assert.match(invite.text, /Activate your account: .*activate=synthetic-only/);
  assert.ok(invite.text.includes(`Already activated? Sign in to HealthMate: ${url}`));
});
