import React from 'react';
import { useEffect } from 'react';

import { SlotDiffGrid } from './SlotDiffGrid';
import './App.css';


function App() {
  useEffect(() => {
    document.title = '石破おろし'; // ← お好きなタイトルに
  }, []);

  return (
    <div style={{ padding: 0 }}>
      <SlotDiffGrid storeId="maruhan_chuou" />
    </div>
  );
}

export default App;
