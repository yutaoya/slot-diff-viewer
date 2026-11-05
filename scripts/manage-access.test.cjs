'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { run, normalizeEmail } = require('./manage-access.cjs');

function fakeAdmin(responses = []) {
  const calls = [];
  return {
    calls,
    createAdminClient: async () => ({ request: async (url, options = {}) => {
      calls.push({ url, ...options });
      return responses.shift() ?? null;
    } }),
    log: () => {},
  };
}

const args = ['--email', 'Example.User@GMAIL.com', '--project', 'demo-slotdiff-auth'];

test('allow-email defaults to a read-only preview', async () => {
  const admin = fakeAdmin();
  const result = await run(['allow-email', ...args], admin);
  assert.equal(result.applied, false);
  assert.equal(result.email, 'example.user@gmail.com');
  assert.equal(admin.calls.length, 1);
  assert.equal(admin.calls[0].method, undefined);
});

test('an explicit grant updates only the normalized email enabled field', async () => {
  const admin = fakeAdmin();
  await run(['allow-email', ...args, '--apply'], admin);
  assert.equal(admin.calls.length, 2);
  assert.match(admin.calls[1].url, /allowedEmails\/example\.user%40gmail\.com\?updateMask\.fieldPaths=enabled$/);
  assert.equal(admin.calls[1].method, 'PATCH');
  assert.deepEqual(admin.calls[1].body, { fields: { enabled: { booleanValue: true } } });
});

test('revocation disables access without deleting an Auth user', async () => {
  const admin = fakeAdmin([{ fields: { enabled: { booleanValue: true } } }]);
  const result = await run(['revoke-email', ...args, '--apply'], admin);
  assert.equal(result.previousEnabled, true);
  assert.deepEqual(admin.calls[1].body, { fields: { enabled: { booleanValue: false } } });
  assert.ok(admin.calls.every(call => !call.url.includes('accounts')));
});

test('status excludes credentials returned by administrator APIs', async () => {
  const output = [];
  const admin = fakeAdmin([
    { signIn: { hashConfig: { signerKey: 'DO_NOT_PRINT' } }, authorizedDomains: ['example.com'] },
    { enabled: true, clientId: 'client', clientSecret: 'DO_NOT_PRINT' },
  ]);
  await run(['status', '--project', 'demo-slotdiff-auth'], { ...admin, log: text => output.push(text) });
  assert.ok(!output.join('\n').includes('DO_NOT_PRINT'));
});

test('rejects path separators and malformed email addresses', () => {
  assert.throws(() => normalizeEmail('../user@example.com'));
  assert.throws(() => normalizeEmail('missing-address'));
});
