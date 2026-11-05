const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-slot-diff-auth-tests';
const DAY = 24 * 60 * 60 * 1000;
let environment;
let authTime;

before(async () => {
  // Refuse to run against a remote host or the production project.
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(address, 'Start the local Firestore emulator before running these tests.');
  const [host, port] = address.split(':');
  assert.ok(['127.0.0.1', 'localhost'].includes(host), 'Only a local emulator is allowed.');
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
  });
});

after(async () => { await environment?.cleanup(); });

async function seed(entries) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await Promise.all(Object.entries(entries).map(([documentPath, data]) => setDoc(doc(context.firestore(), documentPath), data)));
  });
}

const sessionPath = (uid = 'alice', issuedAt = authTime) => `authSessions/${uid}/sessions/${issuedAt}`;
function client({ uid = 'alice', email = 'allowed@example.test', verified = true, provider = 'google.com', issuedAt = authTime } = {}) {
  return environment.authenticatedContext(uid, {
    email, email_verified: verified, auth_time: issuedAt,
    firebase: { sign_in_provider: provider, identities: { [provider]: [email] } },
  }).firestore();
}

beforeEach(async () => {
  await environment.clearFirestore();
  authTime = Math.floor(Date.now() / 1000) - 1;
  await seed({
    'allowedEmails/allowed@example.test': { enabled: true },
    'allowedEmails/disabled@example.test': { enabled: false },
    [sessionPath()]: { lastActiveAt: Timestamp.fromMillis(Date.now() - 60_000) },
    'slot_diff/store_20261104': {
      date: 20261104, storeId: 'store', totalDiff: 200,
      data: {
        a: { name: 'Test machine', machineNumber: '101', diff: 100, flag: 0, comment: '' },
        b: { name: 'Test machine', machineNumber: '102', diff: 100, flag: 0, comment: '' },
      },
    },
    'tooltips/store': { storeId: 'store', rows: [] },
    'config/namecCmbine': { map: {} },
    'config/shortName': { map: {} },
    'config/private': { value: 'not public' },
    'site777Snapshots/store_20261104': { data: {} },
    'site777Snapshots/store_20261104/oatariHistories/101': { oatariHistoryCount: 0 },
    'unlisted/private': { value: 'not public' },
  });
});

test('anonymous requests cannot read application data or grant themselves access', async () => {
  const db = environment.unauthenticatedContext().firestore();
  for (const documentPath of ['slot_diff/store_20261104', 'tooltips/store', 'config/shortName', 'site777Snapshots/store_20261104']) {
    await assertFails(getDoc(doc(db, documentPath)));
  }
  await assertFails(setDoc(doc(db, 'allowedEmails/allowed@example.test'), { enabled: true }));
});

test('a valid session does not bypass a missing, disabled, or revoked email allowlist entry', async () => {
  for (const email of ['unknown@example.test', 'disabled@example.test']) {
    await assertFails(getDoc(doc(client({ email }), 'slot_diff/store_20261104')));
  }
  await seed({ 'allowedEmails/allowed@example.test': { enabled: false } });
  await assertFails(getDoc(doc(client(), 'slot_diff/store_20261104')));
  await assertFails(updateDoc(doc(client(), sessionPath()), { lastActiveAt: serverTimestamp() }));
});

test('email allowlisting requires a Google sign-in and verified email', async () => {
  for (const options of [{ provider: 'password' }, { provider: 'anonymous' }, { verified: false }]) {
    const db = client(options);
    await assertFails(getDoc(doc(db, 'slot_diff/store_20261104')));
    await assertFails(getDoc(doc(db, 'allowedEmails/allowed@example.test')));
  }
});

test('users can read only their own lowercased email permission and cannot edit or list permissions', async () => {
  const db = client({ email: 'Allowed@Example.test' });
  await assertSucceeds(getDoc(doc(db, 'allowedEmails/allowed@example.test')));
  await assertSucceeds(getDoc(doc(client({ email: 'unknown@example.test' }), 'allowedEmails/unknown@example.test')));
  await assertFails(getDoc(doc(db, 'allowedEmails/disabled@example.test')));
  await assertFails(getDocs(collection(db, 'allowedEmails')));
  await assertFails(updateDoc(doc(db, 'allowedEmails/allowed@example.test'), { enabled: false }));
  await assertFails(setDoc(doc(db, 'allowedEmails/new@example.test'), { enabled: true }));
  await assertFails(deleteDoc(doc(db, 'allowedEmails/allowed@example.test')));
});

test('authorized users with an active session can read the app collections and its date query', async () => {
  const db = client();
  for (const documentPath of [
    'slot_diff/store_20261104', 'tooltips/store', 'config/namecCmbine', 'config/shortName',
    'site777Snapshots/store_20261104', 'site777Snapshots/store_20261104/oatariHistories/101',
  ]) await assertSucceeds(getDoc(doc(db, documentPath)));
  await assertSucceeds(getDocs(query(collection(db, 'slot_diff'), where('storeId', '==', 'store'), where('date', '>=', 20261101))));
  await assertFails(getDoc(doc(db, 'config/private')));
  await assertFails(getDocs(collection(db, 'config')));
  await assertFails(getDoc(doc(db, 'unlisted/private')));
});

test('the current auth_time selects the session; a different login cannot reuse another session', async () => {
  await assertFails(getDoc(doc(client({ issuedAt: authTime - 60 }), 'slot_diff/store_20261104')));
  await assertFails(getDoc(doc(client({ uid: 'bob' }), 'slot_diff/store_20261104')));
});

test('expired or future activity timestamps deny data reads and cannot be extended', async () => {
  for (const lastActiveAt of [Date.now() - 7 * DAY, Date.now() - 8 * DAY, Date.now() + DAY]) {
    await seed({ [sessionPath()]: { lastActiveAt: Timestamp.fromMillis(lastActiveAt) } });
    const db = client();
    await assertFails(getDoc(doc(db, 'slot_diff/store_20261104')));
    await assertFails(updateDoc(doc(db, sessionPath()), { lastActiveAt: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(db, sessionPath())));
  }
});

test('a session just inside the seven-day limit remains usable and can record server-timed activity', async () => {
  await seed({ [sessionPath()]: { lastActiveAt: Timestamp.fromMillis(Date.now() - 7 * DAY + 60_000) } });
  const db = client();
  await assertSucceeds(getDoc(doc(db, 'slot_diff/store_20261104')));
  await assertSucceeds(updateDoc(doc(db, sessionPath()), { lastActiveAt: serverTimestamp() }));
});

test('a fresh Google login can create only its own auth_time session with a server timestamp', async () => {
  const db = client({ uid: 'new-user' });
  await assertSucceeds(setDoc(doc(db, sessionPath('new-user')), { lastActiveAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, sessionPath('someone-else')), { lastActiveAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, sessionPath('new-user', authTime - 1)), { lastActiveAt: serverTimestamp() }));
});

test('old, future, unverified, and unlisted logins cannot create a new session', async () => {
  for (const options of [
    { uid: 'old-user', issuedAt: authTime - 600 },
    { uid: 'future-user', issuedAt: authTime + 600 },
    { uid: 'unverified-user', verified: false },
    { uid: 'unknown-user', email: 'unknown@example.test' },
    { uid: 'password-user', provider: 'password' },
  ]) {
    const db = client(options);
    await assertFails(setDoc(doc(db, sessionPath(options.uid, options.issuedAt ?? authTime)), { lastActiveAt: serverTimestamp() }));
  }
});

test('session writes reject fabricated timestamps and additional fields', async () => {
  const db = client();
  await assertFails(updateDoc(doc(db, sessionPath()), { lastActiveAt: Timestamp.fromMillis(Date.now() + DAY) }));
  await assertFails(updateDoc(doc(db, sessionPath()), { lastActiveAt: Timestamp.fromMillis(Date.now() - DAY) }));
  await assertFails(updateDoc(doc(db, sessionPath()), { lastActiveAt: serverTimestamp(), enabled: true }));
  const newDb = client({ uid: 'new-user' });
  await assertFails(setDoc(doc(newDb, sessionPath('new-user')), { lastActiveAt: serverTimestamp(), expiresAt: Timestamp.now() }));
});

test('users cannot read other users sessions, list sessions, or delete a session to recreate it', async () => {
  const db = client();
  await assertFails(getDoc(doc(db, sessionPath('bob'))));
  await assertFails(getDocs(collection(db, 'authSessions/alice/sessions')));
  await assertFails(deleteDoc(doc(db, sessionPath())));
});

test('flag and comment edits for multiple existing machines remain authorized', async () => {
  const db = client();
  const batch = writeBatch(db);
  batch.update(doc(db, 'slot_diff/store_20261104'), { 'data.a.flag': 9, 'data.a.comment': 'shared note' });
  batch.update(doc(db, 'slot_diff/store_20261104'), { 'data.b.flag': 9, 'data.b.comment': 'shared note' });
  await assertSucceeds(batch.commit());
  const result = await getDoc(doc(db, 'slot_diff/store_20261104'));
  assert.equal(result.data().data.a.flag, 9);
  assert.equal(result.data().data.b.comment, 'shared note');
});

test('normal users cannot change root metadata, add/remove machines, or create/delete slot records', async () => {
  const db = client();
  const ref = doc(db, 'slot_diff/store_20261104');
  await assertFails(updateDoc(ref, { date: 20261105 }));
  await assertFails(updateDoc(ref, { totalDiff: 99999 }));
  await assertFails(updateDoc(ref, { 'data.c': { machineNumber: '103' } }));
  await assertFails(updateDoc(ref, { 'data.a': deleteField() }));
  await assertFails(setDoc(doc(db, 'slot_diff/new'), { date: 20261105, data: {} }));
  await assertFails(deleteDoc(ref));
});

test('application data outside slot annotations stays read-only to normal users', async () => {
  const db = client();
  for (const documentPath of ['tooltips/store', 'config/shortName', 'site777Snapshots/store_20261104', 'site777Snapshots/store_20261104/oatariHistories/101']) {
    await assertFails(updateDoc(doc(db, documentPath), { changed: true }));
  }
});
