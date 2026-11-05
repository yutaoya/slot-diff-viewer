import type { User } from 'firebase/auth';
import { doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import {
  AccessDeniedError,
  isSessionExpired,
  readAccessSession,
  SESSION_IDLE_MS,
  SessionExpiredError,
  startAccessSession,
  touchAccessSession,
} from './authSession';

jest.mock('./firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: jest.fn((_db, ...parts) => ({ path: parts.join('/') })),
  getDocFromServer: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn(),
}));

const NOW = Date.UTC(2026, 10, 5, 3, 0, 0);
const AUTH_TIME = NOW / 1000;
const serverTimestampValue = { serverTimestamp: true };
const readServer = getDocFromServer as jest.Mock;
const transact = runTransaction as jest.Mock;
const transaction = { get: jest.fn(), set: jest.fn(), update: jest.fn() };
const snapshot = (data?: Record<string, unknown>) => ({ exists: () => data !== undefined, data: () => data });
const session = { uid: 'allowed-user', authTime: AUTH_TIME, lastActiveAt: NOW - 60_000 };
const user = (authTime: unknown = AUTH_TIME) => ({
  uid: session.uid,
  email: 'Allowed@Example.test',
  getIdTokenResult: jest.fn().mockResolvedValue({ claims: { auth_time: authTime } }),
} as unknown as User);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers('modern');
  jest.setSystemTime(NOW);
  (doc as jest.Mock).mockImplementation((_db, ...parts) => ({ path: parts.join('/') }));
  transaction.get.mockReset().mockResolvedValue(snapshot({ lastActiveAt: Timestamp.fromMillis(session.lastActiveAt) }));
  transact.mockReset().mockImplementation(async (_db, callback) => callback(transaction));
  (serverTimestamp as jest.Mock).mockReturnValue(serverTimestampValue);
  readServer.mockReset().mockImplementation(async (ref) => ref.path.startsWith('allowedEmails/')
    ? snapshot({ enabled: true })
    : snapshot({ lastActiveAt: Timestamp.fromMillis(NOW + 123) }));
});

afterEach(() => jest.useRealTimers());

it('expires exactly seven days after last activity, never one millisecond earlier', () => {
  expect(isSessionExpired(NOW, NOW + SESSION_IDLE_MS - 1)).toBe(false);
  expect(isSessionExpired(NOW, NOW + SESSION_IDLE_MS)).toBe(true);
  expect(isSessionExpired(NOW, NOW + SESSION_IDLE_MS + 1)).toBe(true);
});

it.each([NaN, Infinity, -Infinity])('rejects invalid activity time %s', (lastActiveAt) => {
  expect(isSessionExpired(lastActiveAt, NOW)).toBe(true);
});

it.each([undefined, false, 'true', 1])('requires a server allowlist entry explicitly enabled=true (%s)', async (enabled) => {
  readServer.mockResolvedValueOnce(enabled === undefined ? snapshot() : snapshot({ enabled }));
  await expect(startAccessSession(user())).rejects.toBeInstanceOf(AccessDeniedError);
  expect(readServer).toHaveBeenCalledWith({ path: 'allowedEmails/allowed@example.test' });
  expect(transact).not.toHaveBeenCalled();
});

it('does not fall back to cached permission when the server allowlist read fails', async () => {
  const error = new Error('server unavailable');
  readServer.mockRejectedValueOnce(error);
  await expect(startAccessSession(user())).rejects.toBe(error);
  expect(transact).not.toHaveBeenCalled();
});

it('rejects a login without an email address before reading authorization data', async () => {
  await expect(startAccessSession({ ...user(), email: null } as User)).rejects.toBeInstanceOf(AccessDeniedError);
  expect(readServer).not.toHaveBeenCalled();
  expect(transact).not.toHaveBeenCalled();
});

it.each([undefined, 0, -1, 1.5, 'invalid', Number.MAX_SAFE_INTEGER + 1])('rejects an invalid auth_time claim %s', async (authTime) => {
  const invalidUser = { uid: session.uid, getIdTokenResult: jest.fn().mockResolvedValue({ claims: { auth_time: authTime } }) } as unknown as User;
  await expect(startAccessSession(invalidUser)).rejects.toBeInstanceOf(AccessDeniedError);
  expect(readServer).not.toHaveBeenCalled();
  expect(transact).not.toHaveBeenCalled();
});

it('creates a session only after a fresh login and returns the resolved server activity time', async () => {
  transaction.get.mockResolvedValue(snapshot());
  const result = await startAccessSession(user());
  expect(transaction.set).toHaveBeenCalledWith(
    { path: `authSessions/${session.uid}/sessions/${AUTH_TIME}` },
    { lastActiveAt: serverTimestampValue },
  );
  expect(transaction.update).not.toHaveBeenCalled();
  expect(result).toEqual({ ...session, lastActiveAt: NOW + 123 });
});

it.each([AUTH_TIME - 300, AUTH_TIME - 301, AUTH_TIME + 1])('cannot recreate a missing session using an old or future login (%s)', async (authTime) => {
  transaction.get.mockResolvedValue(snapshot());
  await expect(startAccessSession(user(authTime))).rejects.toBeInstanceOf(SessionExpiredError);
  expect(transaction.set).not.toHaveBeenCalled();
  expect(transaction.update).not.toHaveBeenCalled();
});

it('does not recreate a missing session during activity refresh, even with a fresh auth_time', async () => {
  transaction.get.mockResolvedValue(snapshot());
  await expect(touchAccessSession(session)).rejects.toBeInstanceOf(SessionExpiredError);
  expect(transaction.set).not.toHaveBeenCalled();
  expect(transaction.update).not.toHaveBeenCalled();
});

it('uses current server activity when another tab extended a locally expired session', async () => {
  const updated = await touchAccessSession({ ...session, lastActiveAt: NOW - SESSION_IDLE_MS });
  expect(updated.lastActiveAt).toBe(NOW + 123);
  expect(transaction.update).toHaveBeenCalledTimes(1);
});

it('rechecks the transaction timestamp so stale client state cannot extend a server-expired session', async () => {
  transaction.get.mockResolvedValue(snapshot({ lastActiveAt: Timestamp.fromMillis(NOW - SESSION_IDLE_MS) }));
  await expect(touchAccessSession(session)).rejects.toBeInstanceOf(SessionExpiredError);
  expect(transaction.update).not.toHaveBeenCalled();
  expect(transaction.set).not.toHaveBeenCalled();
});

it('does not revive an expired existing session merely because the login claim is fresh', async () => {
  transaction.get.mockResolvedValue(snapshot({ lastActiveAt: Timestamp.fromMillis(NOW - SESSION_IDLE_MS) }));
  await expect(startAccessSession(user())).rejects.toBeInstanceOf(SessionExpiredError);
  expect(transaction.update).not.toHaveBeenCalled();
  expect(transaction.set).not.toHaveBeenCalled();
});

it.each([undefined, NOW, String(NOW), { seconds: NOW / 1000 }])('rejects malformed stored activity timestamps (%p)', async (lastActiveAt) => {
  transaction.get.mockResolvedValue(snapshot({ lastActiveAt }));
  await expect(touchAccessSession(session)).rejects.toBeInstanceOf(SessionExpiredError);
  expect(transaction.update).not.toHaveBeenCalled();
});

it('refreshes an unexpired session with serverTimestamp and uses the server response', async () => {
  const result = await touchAccessSession(session);
  expect(transaction.update).toHaveBeenCalledWith(
    { path: `authSessions/${session.uid}/sessions/${AUTH_TIME}` },
    { lastActiveAt: serverTimestampValue },
  );
  expect(result.lastActiveAt).toBe(NOW + 123);
  expect(result.lastActiveAt).not.toBe(Date.now());
});

it('fails closed if the post-write server timestamp is missing', async () => {
  readServer.mockResolvedValue(snapshot());
  await expect(touchAccessSession(session)).rejects.toBeInstanceOf(SessionExpiredError);
});

it('checks another tab activity without extending the session during a background expiry check', async () => {
  const updated = await readAccessSession({ ...session, lastActiveAt: NOW - SESSION_IDLE_MS });
  expect(updated.lastActiveAt).toBe(NOW + 123);
  expect(readServer).toHaveBeenCalledWith({ path: `authSessions/${session.uid}/sessions/${AUTH_TIME}` });
  expect(transact).not.toHaveBeenCalled();
});

it('rejects a server timestamp exactly seven days old when checking background expiry', async () => {
  readServer.mockResolvedValue(snapshot({ lastActiveAt: Timestamp.fromMillis(NOW - SESSION_IDLE_MS) }));
  await expect(readAccessSession(session)).rejects.toBeInstanceOf(SessionExpiredError);
  expect(transact).not.toHaveBeenCalled();
});
