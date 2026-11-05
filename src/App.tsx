import React, { Suspense } from 'react';
import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AccessGate } from './AccessGate';
import { LEGACY_ACCESS_ROOT_PATH, DEFAULT_STORE_ID, getStorePath } from './appAccessPath';
import './App.css';

const SlotDiffGrid = React.lazy(() =>
  import('./SlotDiffGrid').then((module) => ({ default: module.SlotDiffGrid }))
);

const STORE_NAME: Record<string, string> = {
  maruhan_chuou: 'マルハン浜松中央',
  maruhan_izumi: 'マルハン泉',
  concorde_ichino: 'SUPER CONCORDE 市野',
  rakuen_zaza: '楽園 ザザシティ',
  concorde_kido: 'FLOWERR CONCORDE 木戸',
};

function StorePage() {
  const params = useParams();
  const storeId = (params.storeId ?? DEFAULT_STORE_ID) as string;

  useEffect(() => {
    const display = STORE_NAME[storeId] ?? storeId;
    document.title = `${display} | ゼッタイニツモレール`;
  }, [storeId]);

  return (
    <div style={{ padding: 0 }}>
      <Suspense fallback={null}>
        <SlotDiffGrid storeId={storeId} />
      </Suspense>
    </div>
  );
}

function StoreRedirect() {
  const legacyPath = useParams()['*']?.replace(/^\/+/, '');
  const location = useLocation();
  return (
    <Navigate
      to={{
        pathname: legacyPath ? `/${legacyPath}` : getStorePath(DEFAULT_STORE_ID),
        search: location.search,
        hash: location.hash,
      }}
      replace
    />
  );
}

function NotFoundPage() {
  useEffect(() => {
    document.title = '404 Not Found';
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        boxSizing: 'border-box',
        fontFamily: 'sans-serif',
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 32 }}>404</h1>
        <p style={{ margin: '8px 0 0' }}>Not Found</p>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={<StoreRedirect />}
      />
      <Route
        path="/:storeId"
        element={
          <AccessGate>
            <StorePage />
          </AccessGate>
        }
      />
      <Route path={`${LEGACY_ACCESS_ROOT_PATH}/*`} element={<StoreRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
