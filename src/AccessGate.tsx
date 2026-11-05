import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { AccessDeniedError, AccessSession, isSessionExpired, readAccessSession, SESSION_IDLE_MS, SESSION_TOUCH_INTERVAL_MS, SessionExpiredError, startAccessSession, touchAccessSession } from './authSession';
import './AccessGate.css';

const EXPIRED_MESSAGE = '7日間アクセスがなかったため、もう一度ログインしてください。';
const codeOf = (error: unknown) => (error as { code?: string })?.code;
function loginError(error: unknown): string {
  switch (codeOf(error)) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'ログインがキャンセルされました。';
    case 'auth/popup-blocked': return 'ポップアップを許可してから、もう一度ログインしてください。';
    case 'auth/too-many-requests': return '試行回数が多いため、しばらく待ってからお試しください。';
    case 'auth/user-disabled': return 'このアカウントは無効になっています。管理者にお問い合わせください。';
    case 'auth/network-request-failed': return '通信できませんでした。接続を確認してお試しください。';
    default: return 'ログインできませんでした。時間をおいて再度お試しください。';
  }
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'checking' | 'signedOut' | 'authorized' | 'failed'>('checking');
  const [session, setSession] = useState<AccessSession | null>(null);
  const active = useRef<AccessSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  const acceptSession = (next: AccessSession | null) => {
    active.current = next;
    setSession(next);
  };

  useEffect(() => {
    try { window.localStorage.removeItem('slot-diff-viewer:access-session:v1'); } catch { /* Storage may be disabled. */ }
    let alive = true;
    let generation = 0;
    const unsubscribe = onIdTokenChanged(auth, async user => {
      const request = ++generation;
      if (!user) {
        acceptSession(null);
        setPhase('signedOut');
        return;
      }
      if (active.current?.uid !== user.uid) {
        acceptSession(null);
        setPhase('checking');
      }
      try {
        const token = await user.getIdTokenResult();
        if (!alive || request !== generation) return;
        // Automatic token refresh is not a visit and must not extend inactivity.
        if (active.current?.uid === user.uid && active.current.authTime === Number(token.claims.auth_time)) return;
        acceptSession(null);
        setPhase('checking');
        const next = await startAccessSession(user);
        if (!alive || request !== generation) return;
        acceptSession(next);
        setError('');
        setPhase('authorized');
      } catch (failure) {
        if (!alive || request !== generation) return;
        acceptSession(null);
        if (failure instanceof SessionExpiredError || failure instanceof AccessDeniedError || codeOf(failure) === 'permission-denied') {
          setError(failure instanceof SessionExpiredError ? EXPIRED_MESSAGE : 'このアカウントには利用許可がありません。管理者にお問い合わせください。');
          setPhase('signedOut');
          await signOut(auth);
        } else {
          setError('利用許可を確認できませんでした。接続を確認して再試行してください。');
          setPhase('failed');
        }
      }
    }, () => {
      if (!alive) return;
      generation++;
      acceptSession(null);
      setError('認証状態を確認できませんでした。再試行してください。');
      setPhase('failed');
    });
    return () => { alive = false; generation++; unsubscribe(); };
  }, [retry]);

  useEffect(() => {
    if (!session || phase !== 'authorized') return;
    const { uid, authTime } = session;
    const allowedEmail = auth.currentUser?.email?.toLowerCase();
    if (!allowedEmail) return;
    let alive = true;
    let pending = false;
    const fail = async (message: string, logOut: boolean) => {
      if (!alive) return;
      acceptSession(null);
      setError(message);
      setPhase(logOut ? 'signedOut' : 'failed');
      if (logOut) await signOut(auth);
    };
    const activity = async (event: Event) => {
      if (document.visibilityState === 'hidden' || pending || !active.current) return;
      const returningToApp = event.type === 'focus' || event.type === 'visibilitychange';
      if (!returningToApp && Date.now() - active.current.lastActiveAt < SESSION_TOUCH_INTERVAL_MS) return;
      pending = true;
      try {
        const next = await touchAccessSession(active.current);
        if (alive && active.current?.uid === uid && active.current.authTime === authTime) acceptSession(next);
      } catch (failure) {
        await fail(failure instanceof SessionExpiredError ? EXPIRED_MESSAGE : 'セッションを確認できませんでした。もう一度ログインしてください。', true);
      } finally { pending = false; }
    };
    const watchError = () => { void fail('利用許可を確認できませんでした。接続を確認して再試行してください。', false); };
    const stopAllowed = onSnapshot(doc(db, 'allowedEmails', allowedEmail), { includeMetadataChanges: true }, snapshot => {
      if (!alive || snapshot.metadata.fromCache) return;
      if (!snapshot.exists() || snapshot.data()?.enabled !== true) void fail('このアカウントの利用許可が取り消されました。', true);
    }, watchError);
    const stopSession = onSnapshot(doc(db, 'authSessions', uid, 'sessions', String(authTime)), { includeMetadataChanges: true }, snapshot => {
      if (!alive || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const timestamp = snapshot.data()?.lastActiveAt;
      if (!(timestamp instanceof Timestamp) || isSessionExpired(timestamp.toMillis())) {
        void fail(EXPIRED_MESSAGE, true);
      } else {
        acceptSession({ uid, authTime, lastActiveAt: timestamp.toMillis() });
      }
    }, watchError);
    // Background timers never count as activity.
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'];
    events.forEach(name => window.addEventListener(name, activity, { passive: true }));
    document.addEventListener('visibilitychange', activity);
    return () => {
      alive = false;
      stopAllowed();
      stopSession();
      events.forEach(name => window.removeEventListener(name, activity));
      document.removeEventListener('visibilitychange', activity);
    };
    // Synchronize tabs without reinstalling listeners on every touch.
  }, [session?.uid, session?.authTime, phase]);

  useEffect(() => {
    if (!session || phase !== 'authorized') return;
    let alive = true;
    const timer = window.setTimeout(() => {
      // A suspended tab may have missed activity in another tab. Re-read without extending.
      void readAccessSession(session).then(next => {
        if (alive && active.current?.uid === session.uid && active.current.authTime === session.authTime) acceptSession(next);
      }).catch(() => {
        if (!alive) return;
        acceptSession(null);
        setPhase('signedOut');
        setError(EXPIRED_MESSAGE);
        void signOut(auth);
      });
    }, Math.max(0, session.lastActiveAt + SESSION_IDLE_MS - Date.now()));
    return () => { alive = false; window.clearTimeout(timer); };
  }, [session, phase]);

  async function handleGoogleLogin() {
    setError('');
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (failure) { setError(loginError(failure)); }
    finally { setBusy(false); }
  }

  if (phase === 'authorized' && session) return <div className="access-authorized">
    <div className="access-session-bar">
      <span title={auth.currentUser?.email ?? ''}>{auth.currentUser?.email}</span>
      <button type="button" onClick={() => { acceptSession(null); setPhase('signedOut'); setError(''); void signOut(auth); }}>ログアウト</button>
    </div>
    {children}
  </div>;

  return <main className="access-gate" aria-label="ログイン">
    <section className="access-gate__panel">
      <h1 className="access-gate__title">ログイン</h1>
      {phase === 'checking' ? <p role="status">認証状態を確認しています…</p> : phase === 'failed' ? <>
        <p className="access-gate__error" role="alert">{error}</p>
        <button className="access-gate__button" type="button" onClick={() => { acceptSession(null); setPhase('checking'); setRetry(value => value + 1); }}>再試行</button>
        <button className="access-gate__secondary" type="button" onClick={() => { setError(''); void signOut(auth); }}>別のアカウントでログイン</button>
      </> : <>
        <p className="access-gate__text">利用を許可されたGoogleアカウントでログインしてください。7日間アクセスがない場合は再ログインが必要です。</p>
        <button className="access-gate__button" type="button" disabled={busy} onClick={handleGoogleLogin}>{busy ? 'ログイン中…' : 'Googleでログイン'}</button>
        <p className="access-gate__error" role="alert">{error}</p>
      </>}
    </section>
  </main>;
}
