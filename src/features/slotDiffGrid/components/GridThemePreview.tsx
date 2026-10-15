import React from 'react';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'ag-grid-community/styles/ag-theme-balham.css';
import 'ag-grid-community/styles/ag-theme-material.css';

export const GRID_THEME_PREVIEW_ENABLED = process.env.REACT_APP_THEME_PREVIEW === 'true';
const GRID_THEMES = ['alpine', 'quartz', 'balham', 'material'] as const;
export type GridThemeName = typeof GRID_THEMES[number];
const LABELS: Record<GridThemeName, string> = {
  alpine: 'Alpine（現在の本番）',
  quartz: 'Quartz',
  balham: 'Balham',
  material: 'Material',
};

export function getInitialGridTheme(): GridThemeName {
  if (!GRID_THEME_PREVIEW_ENABLED) return 'alpine';
  const requested = new URLSearchParams(window.location.search).get('theme');
  return GRID_THEMES.find((theme) => theme === requested) ?? 'alpine';
}

export function GridThemePreview({ theme, onChange, isMap }: {
  theme: GridThemeName;
  onChange: (theme: GridThemeName) => void;
  isMap: boolean;
}) {
  return (
    <section aria-label="テーマ比較" style={{
      flexShrink: 0, padding: '6px 8px', background: '#eef5ff',
      borderBottom: '1px solid #c9d4e2', color: '#172033', fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>テーマ比較版</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          テーマ
          <select value={theme} onChange={(event) => {
            const next = GRID_THEMES.find((item) => item === event.target.value) ?? 'alpine';
            const url = new URL(window.location.href);
            url.searchParams.set('theme', next);
            window.history.replaceState(window.history.state, '', url);
            onChange(next);
          }} style={{ minHeight: 32, padding: '0 8px', fontSize: 14, color: '#172033', background: '#fff' }}>
            {GRID_THEMES.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}
          </select>
        </label>
      </div>
      <p style={{ margin: '4px 0 0', lineHeight: 1.4 }}>
        {isMap ? 'テーマの違いは台番別・機種別・末尾別で確認できます。マップの表示は共通です。' : '行高・列幅・フラグ色は共通です。テーマを切り替えて文字や余白を比較できます。'}
      </p>
      <p style={{ margin: '2px 0 0', lineHeight: 1.4, color: '#795214' }}>フラグ・コメントの保存先は本番と共通です。</p>
    </section>
  );
}
