import React from 'react';
import { render, screen } from '@testing-library/react';
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

jest.mock('./SlotDiffGrid', () => ({
  SlotDiffGrid: ({ storeId }: { storeId: string }) => <div data-testid="slot-grid">{storeId}</div>,
}));

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
