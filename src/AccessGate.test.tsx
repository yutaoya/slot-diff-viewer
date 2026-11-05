import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { auth } from './firebase';
import {
  AccessDeniedError, AccessSession, isSessionExpired, readAccessSession,
  SESSION_IDLE_MS, SESSION_TOUCH_INTERVAL_MS, SessionExpiredError,
  startAccessSession, touchAccessSession,
} from './authSession';
import { AccessGate } from './AccessGate';
import { AccountControls } from './AccountControls';

jest.mock('./firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: jest.fn().mockImplementation(() => ({ setCustomParameters: jest.fn() })),
  onIdTokenChanged: jest.fn(),
  signInWithPopup: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db, ...parts) => ({ path: parts.join('/') })),
  onSnapshot: jest.fn(),
  Timestamp: class Timestamp {
    millis: number;
    constructor(value: number) { this.millis = value; }
    static fromMillis(millis: number) { return new Timestamp(millis); }
    toMillis() { return this.millis; }
  },
}));
jest.mock('./authSession', () => ({
  ...jest.requireActual('./authSession'),
  startAccessSession: jest.fn(),
  touchAccessSession: jest.fn(),
  readAccessSession: jest.fn(),
}));

const NOW = Date.UTC(2026, 10, 5, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const baseSession: AccessSession = { uid: 'user-a', authTime: NOW / 1000, lastActiveAt: NOW };
const begin = startAccessSession as jest.Mock;
const touch = touchAccessSession as jest.Mock;
const read = readAccessSession as jest.Mock;
const logout = signOut as jest.Mock;
const popup = signInWithPopup as jest.Mock;
type TestUser = { uid: string; email: string; displayName?: string | null; getIdTokenResult: jest.Mock };
let authNext: (user: TestUser | null) => Promise<void>;
let authError: () => void;
const stopAuth = jest.fn();
const observers = new Map<string, { next: (snapshot: any) => void; error: () => void; stop: jest.Mock }>();
const makeUser = (uid = baseSession.uid, authTime = baseSession.authTime): TestUser => ({
  uid, email: `${uid}@example.com`,
  getIdTokenResult: jest.fn().mockResolvedValue({ claims: { auth_time: authTime } }),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mountGate(showAccountControls = false) {
  return render(<AccessGate><div data-testid="private-grid">{showAccountControls ? <AccountControls /> : null}private data</div></AccessGate>);
}
async function emitAuth(user: TestUser | null) {
  (auth as any).currentUser = user;
  await act(async () => { await authNext(user); });
}
async function authorize(session = baseSession) {
  const user = makeUser(session.uid, session.authTime);
  begin.mockResolvedValueOnce(session);
  await emitAuth(user);
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
  return user;
}
async function tick(milliseconds: number) {
  await act(async () => { jest.advanceTimersByTime(milliseconds); });
}
async function snapshot(path: string, data: any, metadata: Partial<{ fromCache: boolean; hasPendingWrites: boolean }> = {}) {
  await act(async () => {
    const watcher = observers.get(path);
    if (!watcher) throw new Error(`No watcher for ${path}`);
    watcher.next({
      metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
      exists: () => data !== undefined,
      data: () => data,
    });
  });
}
const sessionPath = (session = baseSession) => `authSessions/${session.uid}/sessions/${session.authTime}`;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers('modern');
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  (auth as any).currentUser = null;
  observers.clear();
  (doc as jest.Mock).mockImplementation((_db, ...parts) => ({ path: parts.join('/') }));
  (GoogleAuthProvider as unknown as jest.Mock).mockImplementation(() => ({ setCustomParameters: jest.fn() }));
  (onIdTokenChanged as jest.Mock).mockImplementation((_auth, next, error) => {
    authNext = next;
    authError = error;
    return stopAuth;
  });
  (onSnapshot as jest.Mock).mockImplementation((ref, _options, next, error) => {
    const stop = jest.fn();
    observers.set(ref.path, { next, error, stop });
    return stop;
  });
  begin.mockReset();
  touch.mockReset().mockImplementation(async (session: AccessSession) => ({ ...session, lastActiveAt: Date.now() }));
  read.mockReset().mockImplementation(async (session: AccessSession) => {
    if (isSessionExpired(session.lastActiveAt)) throw new SessionExpiredError();
    return session;
  });
  logout.mockReset().mockResolvedValue(undefined);
  popup.mockReset().mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it('removes the old local unlock and waits for server permission/session before mounting data', async () => {
  window.localStorage.setItem('slot-diff-viewer:access-session:v1', 'old-unlock');
  const pending = deferred<AccessSession>();
  begin.mockReturnValueOnce(pending.promise);
  mountGate();
  expect(window.localStorage.getItem('slot-diff-viewer:access-session:v1')).toBeNull();
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  let request!: Promise<void>;
  const user = makeUser();
  (auth as any).currentUser = user;
  await act(async () => { request = authNext(user); });
  expect(begin).toHaveBeenCalledWith(user);
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  await act(async () => { pending.resolve(baseSession); await request; });
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
});

it.each([
  [new AccessDeniedError(), '利用許可がありません'],
  [new SessionExpiredError(), '7日間アクセスがなかった'],
])('keeps protected content hidden when bootstrap is rejected', async (failure, message) => {
  begin.mockRejectedValueOnce(failure);
  mountGate();
  await emitAuth(makeUser());
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(message as string);
  expect(logout).toHaveBeenCalledWith(auth);
});

it('does not count automatic token refresh or elapsed timers as activity', async () => {
  mountGate();
  const user = await authorize();
  await tick(6 * DAY);
  await emitAuth(user);
  expect(begin).toHaveBeenCalledTimes(1);
  expect(touch).not.toHaveBeenCalled();
  await tick(DAY);
  expect(read).toHaveBeenCalled();
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('7日間アクセスがなかった');
  expect(logout).toHaveBeenCalledTimes(1);
});

it('throttles user activity to five minutes and prevents concurrent touches', async () => {
  mountGate();
  await authorize();
  fireEvent.pointerDown(window);
  expect(touch).not.toHaveBeenCalled();
  await tick(SESSION_TOUCH_INTERVAL_MS);
  expect(touch).not.toHaveBeenCalled();
  const pending = deferred<AccessSession>();
  touch.mockReturnValueOnce(pending.promise);
  fireEvent.pointerDown(window);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(touch).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ ...baseSession, lastActiveAt: Date.now() }); });
  fireEvent.wheel(window);
  expect(touch).toHaveBeenCalledTimes(1);
});

it('does not touch from hidden documents and resumes on visible user activity', async () => {
  mountGate();
  await authorize();
  await tick(SESSION_TOUCH_INTERVAL_MS);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent.pointerMove(window);
  fireEvent(document, new Event('visibilitychange'));
  expect(touch).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => { fireEvent(document, new Event('visibilitychange')); });
  expect(touch).toHaveBeenCalledTimes(1);
});

it('uses server permission revocation and ignores cached permission snapshots', async () => {
  mountGate();
  const user = await authorize();
  const path = `allowedEmails/${user.email}`;
  await snapshot(path, { enabled: false }, { fromCache: true });
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
  await snapshot(path, { enabled: false });
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('取り消されました');
  expect(logout).toHaveBeenCalledTimes(1);
});

it('accepts server activity from another tab without writing activity itself', async () => {
  mountGate();
  await authorize();
  await tick(6 * DAY);
  const renewedAt = Date.now();
  await snapshot(sessionPath(), { lastActiveAt: Timestamp.fromMillis(renewedAt) });
  await tick(DAY);
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
  expect(touch).not.toHaveBeenCalled();
  await tick(6 * DAY);
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
});

it('ignores cached and pending-write session timestamps', async () => {
  mountGate();
  await authorize();
  const expired = Timestamp.fromMillis(NOW - SESSION_IDLE_MS);
  await snapshot(sessionPath(), { lastActiveAt: expired }, { fromCache: true });
  await snapshot(sessionPath(), { lastActiveAt: expired }, { hasPendingWrites: true });
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
  expect(logout).not.toHaveBeenCalled();
});

it('fails closed on a permission watch error and can retry the server check', async () => {
  mountGate();
  const user = await authorize();
  await act(async () => { observers.get(`allowedEmails/${user.email}`)!.error(); });
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await authorize();
  expect(begin).toHaveBeenCalledTimes(2);
});

it('does not let an old bootstrap reopen the grid after sign-out in another tab', async () => {
  const pending = deferred<AccessSession>();
  begin.mockReturnValueOnce(pending.promise);
  mountGate();
  let request!: Promise<void>;
  const user = makeUser();
  (auth as any).currentUser = user;
  await act(async () => { request = authNext(user); });
  await emitAuth(null);
  await act(async () => { pending.resolve(baseSession); await request; });
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument();
});

it('hides the old account immediately while a different user token is pending', async () => {
  mountGate();
  await authorize();
  const pending = deferred<any>();
  const user = makeUser('user-b');
  user.getIdTokenResult.mockReturnValueOnce(pending.promise);
  (auth as any).currentUser = user;
  let request!: Promise<void>;
  await act(async () => { request = authNext(user); });
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  begin.mockResolvedValueOnce({ ...baseSession, uid: 'user-b' });
  await act(async () => {
    pending.resolve({ claims: { auth_time: baseSession.authTime } });
    await request;
  });
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
});

it('invalidates pending bootstrap when the authentication observer reports an error', async () => {
  const pending = deferred<AccessSession>();
  begin.mockReturnValueOnce(pending.promise);
  mountGate();
  const user = makeUser();
  (auth as any).currentUser = user;
  let request!: Promise<void>;
  await act(async () => { request = authNext(user); });
  act(() => authError());
  await act(async () => { pending.resolve(baseSession); await request; });
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
});

it('ignores a failed old touch after another account has been authorized', async () => {
  mountGate();
  await authorize();
  await tick(SESSION_TOUCH_INTERVAL_MS);
  const pending = deferred<AccessSession>();
  touch.mockReturnValueOnce(pending.promise);
  fireEvent.pointerDown(window);
  await emitAuth(null);
  await authorize({ ...baseSession, uid: 'user-b', lastActiveAt: Date.now() });
  await act(async () => { pending.reject(new Error('old network error')); });
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
  expect(logout).not.toHaveBeenCalled();
});

it('opens the Google account chooser and shows a popup-blocked error', async () => {
  mountGate();
  await emitAuth(null);
  popup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' })); });
  expect(GoogleAuthProvider).toHaveBeenCalledTimes(1);
  const provider = popup.mock.calls[0][1];
  expect(provider.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
  expect(screen.getByRole('alert')).toHaveTextContent('ポップアップを許可');
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
});

it('rechecks missed activity from another tab at expiry without extending the server session', async () => {
  mountGate();
  await authorize();
  read.mockResolvedValueOnce({ ...baseSession, lastActiveAt: NOW + 6 * DAY });
  await tick(SESSION_IDLE_MS);
  expect(read).toHaveBeenCalledWith(baseSession);
  expect(touch).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
  await tick(6 * DAY);
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(logout).toHaveBeenCalledTimes(1);
});

it('ignores an old expiry read failure after a new account has been authorized', async () => {
  mountGate();
  await authorize();
  const pending = deferred<AccessSession>();
  read.mockReturnValueOnce(pending.promise);
  await tick(SESSION_IDLE_MS);
  expect(read).toHaveBeenCalledTimes(1);
  await emitAuth(null);
  await authorize({ uid: 'user-b', authTime: Date.now() / 1000, lastActiveAt: Date.now() });
  await act(async () => { pending.reject(new SessionExpiredError()); });
  expect(screen.getByTestId('private-grid')).toBeInTheDocument();
  expect(logout).not.toHaveBeenCalled();
});

it('verifies a resumed tab immediately even within the five-minute activity throttle', async () => {
  mountGate();
  await authorize();
  await tick(60_000);
  await act(async () => { fireEvent.focus(window); });
  expect(touch).toHaveBeenCalledTimes(1);
  await tick(60_000);
  await act(async () => { fireEvent(document, new Event('visibilitychange')); });
  expect(touch).toHaveBeenCalledTimes(2);
  fireEvent.pointerDown(window);
  expect(touch).toHaveBeenCalledTimes(2);
});

it('provides the trimmed Google display name to child account controls and hides data immediately on logout', async () => {
  const user = { ...makeUser(), displayName: '  山田 太郎  ' };
  begin.mockResolvedValueOnce(baseSession);
  mountGate(true);
  await emitAuth(user);
  expect(screen.getByTitle(user.email)).toHaveTextContent('山田 太郎');

  const pending = deferred<void>();
  logout.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
  expect(logout).toHaveBeenCalledWith(auth);
  expect(screen.queryByTestId('private-grid')).not.toBeInTheDocument();
  expect(screen.queryByTitle(user.email)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument();
  await act(async () => { pending.resolve(); });
});

it('uses the email address in child account controls when the Google display name is blank', async () => {
  const user = { ...makeUser(), displayName: '   ' };
  begin.mockResolvedValueOnce(baseSession);
  mountGate(true);
  await emitAuth(user);
  expect(screen.getByTitle(user.email)).toHaveTextContent(user.email);
  expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
});
