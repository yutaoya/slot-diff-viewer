import type { User } from 'firebase/auth';
import { doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const FRESH_LOGIN_MS = 5 * 60 * 1000;

export type AccessSession = { uid: string; authTime: number; lastActiveAt: number };
export class SessionExpiredError extends Error {}
export class AccessDeniedError extends Error {}

export function isSessionExpired(lastActiveAt: number, now = Date.now()): boolean {
  return !Number.isFinite(lastActiveAt) || now >= lastActiveAt + SESSION_IDLE_MS;
}

async function writeActivity(session: AccessSession, allowCreate: boolean): Promise<AccessSession> {
  const ref = doc(db, 'authSessions', session.uid, 'sessions', String(session.authTime));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      const age = Date.now() - session.authTime * 1000;
      if (!allowCreate || age < 0 || age >= FRESH_LOGIN_MS) throw new SessionExpiredError();
      transaction.set(ref, { lastActiveAt: serverTimestamp() });
      return;
    }
    const timestamp = snapshot.data().lastActiveAt;
    if (!(timestamp instanceof Timestamp) || isSessionExpired(timestamp.toMillis())) throw new SessionExpiredError();
    transaction.update(ref, { lastActiveAt: serverTimestamp() });
  });
  return readAccessSession(session);
}

export async function readAccessSession(session: AccessSession): Promise<AccessSession> {
  // Read the resolved server timestamp; this also catches activity in another tab.
  const ref = doc(db, 'authSessions', session.uid, 'sessions', String(session.authTime));
  const saved = await getDocFromServer(ref);
  const timestamp = saved.data()?.lastActiveAt;
  if (!(timestamp instanceof Timestamp) || isSessionExpired(timestamp.toMillis())) throw new SessionExpiredError();
  return { ...session, lastActiveAt: timestamp.toMillis() };
}

export async function startAccessSession(user: User): Promise<AccessSession> {
  const token = await user.getIdTokenResult();
  const authTime = Number(token.claims.auth_time);
  if (!Number.isSafeInteger(authTime) || authTime <= 0) throw new AccessDeniedError();
  const email = user.email?.toLowerCase();
  if (!email) throw new AccessDeniedError();
  const allowed = await getDocFromServer(doc(db, 'allowedEmails', email));
  if (!allowed.exists() || allowed.data().enabled !== true) throw new AccessDeniedError();
  return writeActivity({ uid: user.uid, authTime, lastActiveAt: 0 }, true);
}

export async function touchAccessSession(session: AccessSession): Promise<AccessSession> {
  return writeActivity(session, false);
}
