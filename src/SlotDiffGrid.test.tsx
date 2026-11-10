import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SlotDiffGrid } from './SlotDiffGrid';
import { fetchSlotDiffs } from './dataFetcher';
import * as repository from './features/slotDiffGrid/slotDiffRepository';

let mockGridProps: any;
let mockFloorProps: any;
let mockFlagProps: any;

// Keep the screen's real transformations and async state transitions, replacing
// only the grid/map widgets and remote IO with small observable boundaries.
jest.mock('ag-grid-react', () => {
  const React = require('react');
  return {
    AgGridReact: React.forwardRef((props: any, ref: any) => {
      mockGridProps = props;
      React.useImperativeHandle(ref, () => ({
        api: {
          refreshCells: jest.fn(),
          getVerticalPixelRange: () => ({ top: 0, bottom: 100 }),
          resetRowHeights: jest.fn(),
        },
      }));
      const moreColumn = props.columnDefs.find((column: any) => column.colId === '__load_more__');
      const More = moreColumn?.headerComponent ?? moreColumn?.cellRenderer;
      return (
        <div data-testid="grid">
          <output data-testid="grid-rows">{JSON.stringify(props.rowData)}</output>
          <div className="ag-body-horizontal-scroll-viewport" data-testid="horizontal-scroll" />
          <button onClick={() => props.onBodyScroll?.({ direction: 'horizontal' })}>scroll to end</button>
          {typeof More === 'function' ? <More {...moreColumn.headerComponentParams} data={props.rowData[0]} node={{ rowIndex: 0 }} /> : null}
        </div>
      );
    }),
  };
});

jest.mock('antd', () => ({
  DatePicker: ({ onChange, disabled }: any) => (
    <input type="date" aria-label="検索日付" disabled={disabled} onChange={(event) => {
      const dateKey = event.target.value.replace(/-/g, '');
      onChange({ format: () => dateKey });
    }} />
  ),
  Modal: ({ open, children }: any) => open ? <div>{children}</div> : null,
}));
jest.mock('antd/es/date-picker/locale/ja_JP', () => ({}));
jest.mock('./features/slotDiffGrid/components/JugglerSettingEstimatePanel', () => ({
  JugglerSettingEstimatePanel: () => null,
}));
jest.mock('./features/slotDiffGrid/components/MachineDataModal', () => ({
  MachineDataModal: () => null,
}));
jest.mock('./features/slotDiffGrid/gridAnalyticsExportUtils', () => ({
  exportSlotAnalyticsJson: jest.fn(),
}));
jest.mock('./features/slotDiffGrid/components/FloorMapView', () => ({
  FloorMapView: (props: any) => {
    mockFloorProps = props;
    return (
      <div data-testid="floor-map">
        <output data-testid="map-data">{JSON.stringify(props.machineDataByNumber)}</output>
        {Object.keys(props.machineDataByNumber).map((number) => (
          <button key={number} onClick={() => props.onOpenMachineData(number)}>map {number}</button>
        ))}
        {props.canLoadMore ? (
          <button disabled={props.loadingMore} onClick={props.onLoadMore}>マップの追加読み込み</button>
        ) : null}
      </div>
    );
  },
}));
jest.mock('./features/slotDiffGrid/components/FlagSettingModal', () => ({
  FlagSettingModal: (props: any) => {
    mockFlagProps = props;
    return props.open ? (
    <div role="dialog" aria-label={props.readOnly ? '台データ' : 'フラグ設定'}>
      <output data-testid="modal-machine">{props.selectedCell?.rowData?.machineNumber}</output>
      <output data-testid="modal-flag">{props.selectedFlag}</output>
      {!props.readOnly ? <>
      <input aria-label="コメント" value={props.selectedComment} onChange={(event) => props.onCommentChange(event.target.value)} />
      <button onClick={() => props.onFlagChange(9)}>全台系</button>
      <button onClick={() => props.onFlagChange(6)}>設定6</button>
      <button onClick={() => props.onFlagChange(0)}>フラグ解除</button>
      <button disabled={props.okLoading} onClick={() => void props.onOk()}>保存</button>
      </> : null}
      <button onClick={props.onCancel}>{props.readOnly ? '閉じる' : 'キャンセル'}</button>
    </div>
  ) : null;
  },
}));
jest.mock('./dataFetcher', () => ({ fetchSlotDiffs: jest.fn() }));
jest.mock('./features/slotDiffGrid/slotDiffRepository', () => ({
  fetchNameCombineMap: jest.fn(),
  fetchShortNameMap: jest.fn(),
  fetchTooltipMapsByStoreId: jest.fn(),
  fetchTodaySnapshotDetailMap: jest.fn(),
  fetchSnapshotDetailFromOatariSubcollection: jest.fn(),
  fetchOatariHistorySubcollection: jest.fn(),
  fetchSlotDiffDateData: jest.fn(),
  updateModelModeFlagsAndComment: jest.fn(),
  updateNumberModeFlagsAndComment: jest.fn(),
}));

type DayData = Record<string, { name: string; machineNumber: number; diff: number; games: number; flag: number; comment: string }>;
let database: Record<string, DayData>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const fetchMock = fetchSlotDiffs as jest.Mock;
const saveMock = repository.updateNumberModeFlagsAndComment as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function dataForDates(dates: string[]) {
  return Object.fromEntries(dates.map((date) => {
    database[date] ??= {
      a: { name: 'テスト機種', machineNumber: 101, diff: 100, games: 1000, flag: 0, comment: '' },
      b: { name: 'テスト機種', machineNumber: 102, diff: 300, games: 3000, flag: 0, comment: '' },
    };
    return [date, clone(database[date])];
  }));
}

function applySave(params: any) {
  params.targetKeys.forEach((key: string) => {
    database[params.dateField][key].flag = params.selectedFlag;
    database[params.dateField][key].comment = params.commentValue;
  });
}

function dateColumns() {
  return mockGridProps.columnDefs.filter((column: any) => /^\d{8}$/.test(column.field ?? ''));
}

async function renderLoadedGrid() {
  render(<SlotDiffGrid storeId="test-store" />);
  await waitFor(() => expect(dateColumns()).toHaveLength(30));
  await screen.findByRole('tab', { name: 'マップ' });
}

async function openMapMachine(number = '101') {
  if (!screen.queryByTestId('floor-map')) fireEvent.click(screen.getByRole('tab', { name: 'マップ' }));
  fireEvent.click(await screen.findByRole('button', { name: `map ${number}` }));
  await screen.findByRole('dialog', { name: 'フラグ設定' });
}

beforeEach(() => {
  jest.clearAllMocks();
  database = {};
  mockGridProps = undefined;
  mockFloorProps = undefined;
  mockFlagProps = undefined;
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true });
  (repository.fetchNameCombineMap as jest.Mock).mockResolvedValue({});
  (repository.fetchShortNameMap as jest.Mock).mockResolvedValue({});
  (repository.fetchTooltipMapsByStoreId as jest.Mock).mockResolvedValue({ colorMap: {}, textMap: {} });
  (repository.fetchTodaySnapshotDetailMap as jest.Mock).mockResolvedValue({ exists: false, detailMap: {} });
  (repository.fetchSnapshotDetailFromOatariSubcollection as jest.Mock).mockResolvedValue({ exists: false, snapshot: null, rows: [], count: 0 });
  (repository.fetchOatariHistorySubcollection as jest.Mock).mockResolvedValue({ exists: false, rows: [], count: 0 });
  (repository.fetchSlotDiffDateData as jest.Mock).mockImplementation(async (_storeId, date) => ({ exists: true, data: clone(database[date]) }));
  fetchMock.mockReset().mockImplementation(async (_storeId, dates) => dataForDates(dates));
  saveMock.mockReset().mockImplementation(async (params) => applySave(params));
});

it('loads 30 distinct older days only on explicit request and prevents repeated requests while loading', async () => {
  await renderLoadedGrid();
  const initialDates = fetchMock.mock.calls[0][1] as string[];
  const viewport = screen.getByTestId('horizontal-scroll');
  Object.defineProperties(viewport, { scrollWidth: { value: 1000 }, clientWidth: { value: 100 } });
  viewport.scrollLeft = 900;
  fireEvent.click(screen.getByRole('button', { name: 'scroll to end' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const pending = deferred<any>();
  fetchMock.mockImplementationOnce(() => pending.promise);
  const loadButton = screen.getByRole('button', { name: 'さらに読み込む' });
  fireEvent.click(loadButton);
  fireEvent.click(loadButton);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const addedDates = fetchMock.mock.calls[1][1] as string[];
  expect(addedDates).toHaveLength(30);
  expect(addedDates.every((date) => date < [...initialDates].sort()[0])).toBe(true);
  expect(new Set([...initialDates, ...addedDates]).size).toBe(60);
  await act(async () => pending.resolve(dataForDates(addedDates)));
  await waitFor(() => expect(dateColumns()).toHaveLength(60));
  expect(screen.getByRole('button', { name: 'さらに読み込む' })).toBeEnabled();
});

it('shows fallback dates in yellow and blocks writes even if a stale save callback is invoked', async () => {
  fetchMock.mockImplementation(async (_storeId, dates: string[]) => {
    const data = dataForDates(dates);
    data[dates[0]] = Object.values(data[dates[0]]).map(item => ({ ...item, isSnapshotFallback: true }));
    return data;
  });
  await renderLoadedGrid();
  const date = fetchMock.mock.calls[0][1][0];
  const row = mockGridProps.rowData.find((item: any) => String(item.machineNumber) === '101');
  const column = dateColumns().find((item: any) => item.field === date);
  expect(column.cellStyle({ value: row[date], data: row, colDef: column }).backgroundColor).toBe('#fff7cc');
  act(() => column.cellRendererParams.showModal(row[date], row, date));
  expect(await screen.findByRole('dialog', { name: '台データ' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'コメント' })).not.toBeInTheDocument();
  act(() => { mockFlagProps.onFlagChange(6); });
  await act(async () => { await mockFlagProps.onOk(); });
  expect(repository.fetchSlotDiffDateData).not.toHaveBeenCalled();
  expect(repository.updateNumberModeFlagsAndComment).not.toHaveBeenCalled();
  expect(repository.updateModelModeFlagsAndComment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

  fireEvent.click(screen.getByRole('tab', { name: '機種別' }));
  const modelColumn = dateColumns().find((item: any) => item.field === date);
  const model = mockGridProps.rowData.find((item: any) => !item.isTotalRow);
  expect(modelColumn.cellStyle({ value: model[date], data: model, colDef: modelColumn }).backgroundColor).toBe('#fff7cc');
  act(() => modelColumn.cellRendererParams.showModal(model[date], model, date));
  expect(await screen.findByRole('dialog', { name: '台データ' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

  fireEvent.click(screen.getByRole('tab', { name: 'マップ' }));
  expect(mockFloorProps.activeDateField).toBe(date);
  expect(mockFloorProps.machineDataByNumber['101'].readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'map 101' }));
  expect(await screen.findByRole('dialog', { name: '台データ' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
});

it('restores editing after a fallback date is fetched again as slot_diff data', async () => {
  fetchMock.mockImplementationOnce(async (_storeId, dates: string[]) => {
    const data = dataForDates(dates);
    data[dates[0]] = Object.values(data[dates[0]]).map(item => ({ ...item, isSnapshotFallback: true }));
    return data;
  });
  await renderLoadedGrid();
  const date = fetchMock.mock.calls[0][1][0] as string;
  fireEvent.click(screen.getByRole('tab', { name: 'マップ' }));
  expect(mockFloorProps.machineDataByNumber['101'].readOnly).toBe(true);
  fireEvent.click(screen.getByRole('tab', { name: '台番別' }));
  fireEvent.click(screen.getByRole('button', { name: '日付検索' }));
  fireEvent.change(screen.getByLabelText('検索日付'), { target: { value: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` } });
  await waitFor(() => expect(dateColumns()).toHaveLength(1));
  fireEvent.click(screen.getByRole('tab', { name: 'マップ' }));
  await waitFor(() => expect(mockFloorProps.machineDataByNumber['101'].readOnly).toBe(false));
  await openMapMachine();
  fireEvent.click(screen.getByRole('button', { name: '設定6' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
  expect(mockFloorProps.machineDataByNumber['101'].flagColor).toBe('#5bd799');
});

it('allows retrying the same date range after a failed additional load', async () => {
  await renderLoadedGrid();
  const pending = deferred<any>();
  fetchMock.mockImplementationOnce(() => pending.promise);
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
    const failedDates = fetchMock.mock.calls[1][1];
    await act(async () => pending.reject(new Error('temporary read failure')));
    const retry = await screen.findByRole('button', { name: /^(さらに読み込む|再試行)$/ });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(dateColumns()).toHaveLength(60));
    expect(fetchMock.mock.calls[2][1]).toEqual(failedDates);
  } finally {
    errorLog.mockRestore();
  }
});

it('updates map colors and reopened modal values immediately, including clearing all machines flagged together', async () => {
  await renderLoadedGrid();
  await openMapMachine();
  fireEvent.click(screen.getByRole('button', { name: '全台系' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'コメント' }), { target: { value: '保存したコメント' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mockFloorProps.machineDataByNumber['101'].flagColor).toBe('#FFBFC7');
  expect(mockFloorProps.machineDataByNumber['102'].flagColor).toBe('#FFBFC7');

  await openMapMachine();
  expect(screen.getByTestId('modal-flag')).toHaveTextContent('9');
  expect(screen.getByRole('textbox', { name: 'コメント' })).toHaveValue('保存したコメント');
  fireEvent.click(screen.getByRole('button', { name: 'フラグ解除' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(saveMock.mock.calls[1][0].targetKeys).toEqual(expect.arrayContaining(['a', 'b']));
  expect(mockFloorProps.machineDataByNumber['101'].flagColor).toBeUndefined();
  expect(mockFloorProps.machineDataByNumber['102'].flagColor).toBeUndefined();
  expect(Object.values(database[mockFloorProps.activeDateField]).map((item) => item.flag)).toEqual([0, 0]);
});

it('finishes an additional load using the tab and metric selected while the request was pending', async () => {
  await renderLoadedGrid();
  const pending = deferred<any>();
  fetchMock.mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
  const requestedDates = fetchMock.mock.calls[1][1] as string[];
  fireEvent.click(screen.getByRole('button', { name: '差枚' }));
  fireEvent.click(screen.getByRole('tab', { name: '機種別' }));
  await act(async () => pending.resolve(dataForDates(requestedDates)));
  await waitFor(() => expect(dateColumns()).toHaveLength(60));
  expect(screen.getByRole('tab', { name: '機種別' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: '回転数' })).toBeInTheDocument();
  const machineRows = mockGridProps.rowData.filter((row: any) => !row.isTotalRow);
  expect(machineRows).toHaveLength(1);
  expect(machineRows[0][requestedDates[0]]).toBe(2000);
  expect(mockGridProps.rowData.find((row: any) => row.isTotalRow).name).toBe('平均回転数');
});

it('does not close or reset another machine modal when an earlier save finishes', async () => {
  await renderLoadedGrid();
  await openMapMachine('101');
  const pending = deferred<void>();
  saveMock.mockImplementationOnce(async (params) => { await pending.promise; applySave(params); });
  fireEvent.click(screen.getByRole('button', { name: '設定6' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  await openMapMachine('102');
  fireEvent.change(screen.getByRole('textbox', { name: 'コメント' }), { target: { value: '別の台の編集中コメント' } });
  await act(async () => pending.resolve());
  expect(screen.getByRole('dialog', { name: 'フラグ設定' })).toBeInTheDocument();
  expect(screen.getByTestId('modal-machine')).toHaveTextContent('102');
  expect(screen.getByRole('textbox', { name: 'コメント' })).toHaveValue('別の台の編集中コメント');
  expect(mockFloorProps.machineDataByNumber['101'].flagColor).toBe('#5bd799');
});

it('restores all 60 normal days when a calendar search finishes after an additional load and is cleared', async () => {
  await renderLoadedGrid();
  const initialDates = fetchMock.mock.calls[0][1] as string[];
  const additionalLoad = deferred<any>();
  const calendarSearch = deferred<any>();
  fetchMock.mockImplementationOnce(() => additionalLoad.promise).mockImplementationOnce(() => calendarSearch.promise);
  fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
  const addedDates = fetchMock.mock.calls[1][1] as string[];
  fireEvent.click(screen.getByRole('button', { name: '日付検索' }));
  fireEvent.change(screen.getByLabelText('検索日付'), { target: { value: '2020-01-01' } });
  expect(fetchMock.mock.calls[2][1]).toEqual(['20200101']);

  await act(async () => additionalLoad.resolve(dataForDates(addedDates)));
  await waitFor(() => expect(dateColumns()).toHaveLength(60));
  await act(async () => calendarSearch.resolve(dataForDates(['20200101'])));
  await waitFor(() => expect(dateColumns().map((column: any) => column.field)).toEqual(['20200101']));
  expect(mockGridProps.columnDefs.some((column: any) => column.colId === '__load_more__')).toBe(false);
  expect(screen.queryByRole('button', { name: 'さらに読み込む' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'マップ' }));
  expect(mockFloorProps.canLoadMore).toBe(false);
  expect(mockFloorProps.dateOptions.map((option: any) => option.field)).toEqual(['20200101']);
  expect(screen.queryByRole('button', { name: 'マップの追加読み込み' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: '台番別' }));
  fireEvent.click(screen.getByRole('button', { name: '日付検索' }));
  fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
  await waitFor(() => expect(dateColumns()).toHaveLength(60));
  expect(dateColumns().map((column: any) => column.field).sort()).toEqual([...initialDates, ...addedDates].sort());
  expect(screen.getByRole('button', { name: 'さらに読み込む' })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: 'マップ' }));
  expect(mockFloorProps.canLoadMore).toBe(true);
  expect(mockFloorProps.dateOptions).toHaveLength(60);
  expect(screen.getByRole('button', { name: 'マップの追加読み込み' })).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('ignores an old calendar result after a store remount while the new StrictMode instance stays active', async () => {
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  try {
    const { rerender } = render(<React.StrictMode>
      <SlotDiffGrid key="old-store" storeId="old-store" />
    </React.StrictMode>);
    await waitFor(() => expect(dateColumns()).toHaveLength(30));

    const oldSearch = deferred<any>();
    fetchMock.mockImplementationOnce(() => oldSearch.promise);
    fireEvent.click(screen.getByRole('button', { name: '日付検索' }));
    fireEvent.change(screen.getByLabelText('検索日付'), { target: { value: '2020-01-01' } });

    rerender(<React.StrictMode>
      <SlotDiffGrid key="new-store" storeId="new-store" />
    </React.StrictMode>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('new-store', expect.any(Array)));
    await waitFor(() => expect(dateColumns()).toHaveLength(30));
    await act(async () => oldSearch.resolve({}));
    expect(alert).not.toHaveBeenCalled();

    // StrictMode's setup/cleanup/setup must not leave the new instance marked unmounted.
    fetchMock.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: '日付検索' }));
    fireEvent.change(screen.getByLabelText('検索日付'), { target: { value: '2020-01-02' } });
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  } finally {
    alert.mockRestore();
  }
});
