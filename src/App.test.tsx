import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextEncoder } from 'util';
import { ACCESS_ROOT_PATH, DEFAULT_STORE_ID, getStorePath } from './appAccessPath';

// Jest 27 cannot resolve react-router-dom 7's exports-only entry point.
// Its declarative components are the same re-exports from react-router.
jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });

// React Router 7 expects TextEncoder, which jsdom does not expose by default.
Object.assign(global, { TextEncoder });
const { MemoryRouter, useLocation } = require('react-router-dom');
const App = require('./App').default;

jest.mock('./AccessGate', () => ({
  AccessGate: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="access-gate">{children}</div>
  ),
}));

const mockLoadStoreData = jest.fn();

jest.mock('./AccountControls', () => ({
  AccountControls: () => <><span>テストユーザー</span><button>ログアウト</button></>,
}));

jest.mock('./SlotDiffGrid', () => {
  const React = require('react');
  return {
    SlotDiffGrid: ({ storeId, toolbarContent }: { storeId: string; toolbarContent?: React.ReactNode }) => {
      const [filter, setFilter] = React.useState('');
      const [result, setResult] = React.useState('');
      return (
        <div data-testid="slot-grid">
          <output data-testid="store-id">{storeId}</output>
          <input aria-label="表示フィルター" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <button onClick={() => { void mockLoadStoreData(storeId).then(setResult); }}>データ取得</button>
          <output data-testid="store-result">{result}</output>
          <div role="toolbar" aria-label="表示ツールバー">{toolbarContent}</div>
        </div>
      );
    },
  };
});

beforeEach(() => {
  mockLoadStoreData.mockReset().mockResolvedValue('表示データ');
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>
  );
}

test('builds store and asset URLs without an access prefix', () => {
  expect(getStorePath(DEFAULT_STORE_ID)).toBe('/maruhan_chuou');
  expect(`${ACCESS_ROOT_PATH}/maruhan_chuou/floormap.html`).toBe('/maruhan_chuou/floormap.html');
});

test.each([
  ['/', '/maruhan_chuou', 'maruhan_chuou'],
  ['/?historyDebug=1#daily', '/maruhan_chuou?historyDebug=1#daily', 'maruhan_chuou'],
  ['/maruhan_izumi', '/maruhan_izumi', 'maruhan_izumi'],
  ['/agtmagtm', '/maruhan_chuou', 'maruhan_chuou'],
  ['/agtmagtm/', '/maruhan_chuou', 'maruhan_chuou'],
  ['/agtmagtm/concorde_ichino?historyDebug=1#daily', '/concorde_ichino?historyDebug=1#daily', 'concorde_ichino'],
])('routes %s to the authenticated store page at %s', async (input, expectedPath, storeId) => {
  renderAt(input);

  expect(await screen.findByTestId('slot-grid')).toHaveTextContent(storeId);
  expect(screen.getByTestId('access-gate')).toContainElement(screen.getByTestId('slot-grid'));
  expect(screen.getByTestId('location')).toHaveTextContent(expectedPath);
});

test('does not mount the data grid for an unknown nested route', () => {
  renderAt('/unknown/nested/page');

  expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
  expect(screen.queryByTestId('slot-grid')).not.toBeInTheDocument();
});

test('shows the five stores and current selection before the account controls in the footer', async () => {
  renderAt('/concorde_ichino');
  await screen.findByTestId('slot-grid');
  const toolbar = screen.getByRole('toolbar', { name: '表示ツールバー' });
  const select = within(toolbar).getByRole('combobox', { name: '店舗' });
  expect(select).toHaveValue('concorde_ichino');
  expect(select).toHaveAttribute('title', 'SUPER CONCORDE 市野');
  expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
    'マルハン浜松中央', 'マルハン泉', 'SUPER CONCORDE 市野', '楽園 ザザシティ', 'FLOWERR CONCORDE 木戸',
  ]);
  const account = within(toolbar).getByText('テストユーザー');
  const logout = within(toolbar).getByRole('button', { name: 'ログアウト' });
  expect(select.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(account.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('changes the store URL while preserving query/hash and resets previous store state', async () => {
  renderAt('/maruhan_chuou?theme=balham&historyDebug=1#daily');
  await screen.findByTestId('slot-grid');
  fireEvent.change(screen.getByRole('textbox', { name: '表示フィルター' }), { target: { value: '前店舗のフィルター' } });
  fireEvent.change(screen.getByRole('combobox', { name: '店舗' }), { target: { value: 'maruhan_izumi' } });

  await waitFor(() => expect(screen.getByTestId('store-id')).toHaveTextContent('maruhan_izumi'));
  expect(screen.getByTestId('location')).toHaveTextContent('/maruhan_izumi?theme=balham&historyDebug=1#daily');
  expect(screen.getByRole('combobox', { name: '店舗' })).toHaveValue('maruhan_izumi');
  expect(screen.getByRole('textbox', { name: '表示フィルター' })).toHaveValue('');
  expect(document.title).toBe('マルハン泉 | ゼッタイニツモレール');
});

test('does not let a late previous-store response replace the newly selected store data', async () => {
  let finishOldRequest!: (value: string) => void;
  const oldRequest = new Promise<string>((resolve) => { finishOldRequest = resolve; });
  mockLoadStoreData.mockImplementation((storeId: string) => storeId === 'maruhan_chuou'
    ? oldRequest
    : Promise.resolve('泉の最新データ'));
  renderAt('/maruhan_chuou');
  await screen.findByTestId('slot-grid');
  fireEvent.click(screen.getByRole('button', { name: 'データ取得' }));
  fireEvent.change(screen.getByRole('combobox', { name: '店舗' }), { target: { value: 'maruhan_izumi' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'データ取得' })); });
  expect(screen.getByTestId('store-result')).toHaveTextContent('泉の最新データ');

  await act(async () => { finishOldRequest('中央の古いデータ'); await oldRequest; });
  expect(screen.getByTestId('store-id')).toHaveTextContent('maruhan_izumi');
  expect(screen.getByTestId('store-result')).toHaveTextContent('泉の最新データ');
});
