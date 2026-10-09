import React, { FormEvent, ReactNode, useState } from 'react';
import './AccessGate.css';

const ACCESS_PASSWORD_SHA256 =
  '0f255ec16482c343fd099ba9668863778be40dc166a6856b1d470e0bc97cc6fd';
const ACCESS_SESSION_KEY = 'slot-diff-viewer:access-session:v1';
const ACCESS_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 180;

type StoredAccessSession = {
  version: 1;
  passwordHash: string;
  authenticatedAt: number;
  expiresAt: number;
};

function isStoredSessionValid(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const raw = window.localStorage.getItem(ACCESS_SESSION_KEY);
    if (!raw) {
      return false;
    }

    const session = JSON.parse(raw) as Partial<StoredAccessSession>;
    const valid =
      session.version === 1 &&
      session.passwordHash === ACCESS_PASSWORD_SHA256 &&
      typeof session.expiresAt === 'number' &&
      session.expiresAt > Date.now();

    if (!valid) {
      window.localStorage.removeItem(ACCESS_SESSION_KEY);
    }

    return valid;
  } catch {
    window.localStorage.removeItem(ACCESS_SESSION_KEY);
    return false;
  }
}

function storeAccessSession(): void {
  const authenticatedAt = Date.now();
  const session: StoredAccessSession = {
    version: 1,
    passwordHash: ACCESS_PASSWORD_SHA256,
    authenticatedAt,
    expiresAt: authenticatedAt + ACCESS_SESSION_TTL_MS,
  };

  window.localStorage.setItem(ACCESS_SESSION_KEY, JSON.stringify(session));
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [authorized, setAuthorized] = useState(isStoredSessionValid);
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setChecking(true);

    try {
      if (!window.crypto?.subtle) {
        throw new Error('crypto_unavailable');
      }

      const inputHash = await sha256Hex(password);
      if (inputHash !== ACCESS_PASSWORD_SHA256) {
        setError('パスワードが違います。');
        return;
      }

      storeAccessSession();
      setPassword('');
      setAuthorized(true);
    } catch {
      setError('認証処理に失敗しました。ブラウザを更新して再度お試しください。');
    } finally {
      setChecking(false);
    }
  }

  if (authorized) {
    return <>{children}</>;
  }

  return (
    <main className="access-gate" aria-label="アクセス認証">
      <section className="access-gate__panel">
        <h1 className="access-gate__title">アクセス認証</h1>
        <p className="access-gate__text">パスワードを入力してください。</p>
        <form className="access-gate__form" onSubmit={handleSubmit}>
          <label className="access-gate__label">
            パスワード
            <input
              className="access-gate__input"
              type="password"
              value={password}
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="access-gate__button" type="submit" disabled={checking || password.length === 0}>
            {checking ? '確認中' : '認証'}
          </button>
          <p className="access-gate__error" role="alert">
            {error}
          </p>
        </form>
      </section>
    </main>
  );
}