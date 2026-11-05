import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getStorePath } from './appAccessPath';
import { getStoreLabel, STORES } from './stores';

export function StoreSelector({ storeId }: { storeId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isKnownStore = STORES.some((store) => store.id === storeId);

  return (
    <select
      aria-label="店舗"
      title={getStoreLabel(storeId)}
      value={storeId}
      onChange={(event) => {
        const nextStoreId = event.target.value;
        if (nextStoreId === storeId) return;
        navigate({
          pathname: getStorePath(nextStoreId),
          search: location.search,
          hash: location.hash,
        });
      }}
      style={{
        boxSizing: 'border-box',
        flex: '0 0 auto',
        height: 34,
        width: 'clamp(132px, 32vw, 210px)',
        padding: '0 8px',
        border: '1px solid #d7dde4',
        borderRadius: 0,
        background: '#fff',
        color: '#172033',
        fontSize: 12,
        fontWeight: 700,
        textOverflow: 'ellipsis',
      }}
    >
      {!isKnownStore && <option value={storeId}>{storeId}</option>}
      {STORES.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}
    </select>
  );
}
