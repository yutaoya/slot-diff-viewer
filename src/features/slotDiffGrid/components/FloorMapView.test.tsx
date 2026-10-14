import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FloorMapView } from './FloorMapView';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => '<table class="floor-map-table"><tbody><tr><td data-machine-number="101">101</td></tr></tbody></table>',
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

const createProps = (): ComponentProps<typeof FloorMapView> => ({
  htmlUrl: '/floor-map.html',
  machineDataByNumber: {},
  dateOptions: [{ field: '20261008', label: '10/8' }],
  activeDateField: '20261008',
  onDateFieldChange: jest.fn(),
  onLoadMore: jest.fn(),
  loadingMore: false,
  canLoadMore: true,
  loadMoreError: null,
  scale: 1,
  onScaleChange: jest.fn(),
  onOpenMachineData: jest.fn(),
});

it('keeps the selected date while loading more dates and allows retry after failure', async () => {
  const props = createProps();
  const { rerender } = render(<FloorMapView {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'さらに読み込む' }));
  expect(props.onLoadMore).toHaveBeenCalledTimes(1);

  rerender(<FloorMapView {...props} loadingMore />);
  const loadingButton = screen.getByRole('button', { name: '読み込み中...' });
  expect(loadingButton).toBeDisabled();
  fireEvent.click(loadingButton);
  expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '10/8' })).toHaveAttribute('aria-pressed', 'true');

  rerender(<FloorMapView {...props} loadMoreError="日付データを読み込めませんでした。" />);
  expect(screen.getByRole('alert')).toHaveTextContent('日付データを読み込めませんでした。');
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(props.onLoadMore).toHaveBeenCalledTimes(2);

  rerender(<FloorMapView {...props} dateOptions={[
    ...props.dateOptions,
    { field: '20261007', label: '10/7' },
  ]} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '10/8' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '10/7' }));
  expect(props.onDateFieldChange).toHaveBeenCalledWith('20261007');
});

it('hides loading controls when additional dates are unavailable', async () => {
  render(<FloorMapView {...createProps()} canLoadMore={false} loadMoreError="前回の読み込みエラー" />);

  expect(await screen.findByRole('button', { name: '10/8' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'さらに読み込む' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '再試行' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
