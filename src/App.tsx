import React from 'react';
import { useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { SlotDiffGrid } from './SlotDiffGrid';
import './App.css';

const DEFAULT_STORE_ID = 'maruhan_chuou';

const STORE_NAME: Record<string, string> = {
  maruhan_chuou: 'マルハン浜松中央',
  concorde_ichino: 'SUPER CONCORDE 市野',
  rakuen_zaza: '楽園 ザザシティ',
};

function StorePage() {
  const params = useParams();
  const storeId = (params.storeId ?? DEFAULT_STORE_ID) as string;

  useEffect(() => {
    const display = STORE_NAME[storeId] ?? storeId;
    document.title = `${display} | 石破おろし`;
  }, [storeId]);

  return (
    <div style={{ padding: 0 }}>
      <SlotDiffGrid storeId={storeId} />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* ルート直下に来たらデフォルト店舗へリダイレクト */}
      <Route path="/" element={<Navigate to={`/${DEFAULT_STORE_ID}`} replace />} />
      {/* /:storeId で任意店舗を表示（例: /concorde_ichino） */}
      <Route path="/:storeId" element={<StorePage />} />
      {/* 不明ルートもデフォルトへ */}
      <Route path="*" element={<Navigate to={`/${DEFAULT_STORE_ID}`} replace />} />
    </Routes>
  );
}
