import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { fetchSlotDiffs } from './dataFetcher';

jest.mock('./firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, name) => ({ path: name })),
  doc: jest.fn((_db, ...parts) => ({ path: parts.join('/') })),
  query: jest.fn((ref, ...constraints) => ({ ref, constraints })),
  where: jest.fn((...args) => args),
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
}));

const readQuery = getDocs as jest.Mock;
const readSlotDiffs = jest.fn();
const readLatestSlotDiffs = jest.fn();
const readSnapshot = getDoc as jest.Mock;
const querySnapshot = (...records: Array<Record<string, unknown>>) => ({
  forEach: (visit: (doc: { data: () => Record<string, unknown> }) => void) =>
    records.forEach(record => visit({ data: () => record })),
});
const documentSnapshot = (data?: Record<string, unknown>) => ({
  exists: () => data !== undefined,
  data: () => data,
});

beforeEach(() => {
  jest.clearAllMocks();
  (collection as jest.Mock).mockImplementation((_db, name) => ({ path: name }));
  (doc as jest.Mock).mockImplementation((_db, ...parts) => ({ path: parts.join('/') }));
  (query as jest.Mock).mockImplementation((ref, ...constraints) => ({ ref, constraints }));
  (where as jest.Mock).mockImplementation((...args) => args);
  (orderBy as jest.Mock).mockImplementation((field, direction) => ({ kind: 'orderBy', field, direction }));
  (limit as jest.Mock).mockImplementation((count) => ({ kind: 'limit', count }));
  readQuery.mockReset().mockImplementation((q) =>
    q.constraints.some((constraint: any) => constraint.kind === 'orderBy')
      ? readLatestSlotDiffs(q)
      : readSlotDiffs(q));
  jest.useFakeTimers('modern');
  // The date just changed to November 11 in Japan, but is still November 10 in UTC.
  jest.setSystemTime(new Date('2026-11-10T15:00:00.000Z'));
  readSlotDiffs.mockReset().mockResolvedValue(querySnapshot());
  readLatestSlotDiffs.mockReset().mockResolvedValue(querySnapshot({ date: 20261111, data: {
    1: { machineNumber: 1, name: 'Official one' },
    '0012': { machineNumber: '0012', name: 'Official twelve' },
    501: { machineNumber: 501, name: 'Official zero' },
  } }));
  readSnapshot.mockReset().mockResolvedValue(documentSnapshot());
});

afterEach(() => jest.useRealTimers());

it('does not read Firestore for an empty request', async () => {
  await expect(fetchSlotDiffs('store-a', [])).resolves.toEqual({});
  expect(collection).not.toHaveBeenCalled();
  expect(readSlotDiffs).not.toHaveBeenCalled();
  expect(readSnapshot).not.toHaveBeenCalled();
  expect(readLatestSlotDiffs).not.toHaveBeenCalled();
});

it('keeps existing slot_diff values, flags, comments and URL construction without snapshot reads', async () => {
  readSlotDiffs.mockResolvedValue(querySnapshot(
    { date: 20261109, sourceUrl: 'https://example.test/result?date=9', data: { a: { name: 'Official', machineNumber: 10, diff: 500, flag: 6, comment: 'keep' } } },
    { date: 20261110, sourceUrl: 'https://example.test/result', data: { b: { name: 'Other', machineNumber: 20, diff: 0 } } }
  ));
  await expect(fetchSlotDiffs('store-a', ['20261110', '20261109'])).resolves.toEqual({
    '20261109': [{ name: 'Official', machineNumber: 10, diff: 500, flag: 6, comment: 'keep', url: 'https://example.test/result?date=9&num=10' }],
    '20261110': [{ name: 'Other', machineNumber: 20, diff: 0, url: 'https://example.test/result?num=20' }],
  });
  expect(where).toHaveBeenCalledWith('storeId', '==', 'store-a');
  expect(where).toHaveBeenCalledWith('date', '>=', 20261109);
  expect(where).toHaveBeenCalledWith('date', '<=', 20261110);
  expect(readSnapshot).not.toHaveBeenCalled();
  expect(readLatestSlotDiffs).not.toHaveBeenCalled();
});

it('does not replace an existing but empty slot_diff document', async () => {
  readSlotDiffs.mockResolvedValue(querySnapshot({ date: 20261110, data: {} }));
  readSnapshot.mockResolvedValue(documentSnapshot({ data: { 1: { currentDifference: 100 } } }));
  await expect(fetchSlotDiffs('store-a', ['20261110'])).resolves.toEqual({ '20261110': [] });
  expect(readSnapshot).not.toHaveBeenCalled();
  expect(readLatestSlotDiffs).not.toHaveBeenCalled();
});

it('only reads missing requested dates once, without filling gaps in a range request', async () => {
  readSlotDiffs.mockResolvedValue(querySnapshot({ date: 20261109, data: { 1: { machineNumber: 1, diff: 1 } } }));
  readSnapshot.mockResolvedValue(documentSnapshot({ data: { 1: { machineNumber: 1, currentDifference: 5 } } }));
  const result = await fetchSlotDiffs('store-a', ['20261107', '20261110', '20261110', '20261109']);
  expect(readSnapshot.mock.calls.map(([ref]) => ref.path)).toEqual([
    'site777Snapshots/store-a_20261107',
    'site777Snapshots/store-a_20261110',
  ]);
  expect(result['20261107'][0]).toMatchObject({ diff: 5, isSnapshotFallback: true });
  expect(result['20261109'][0]).toMatchObject({ diff: 1 });
  expect(result['20261110'][0]).toMatchObject({ diff: 5, isSnapshotFallback: true });
  expect(result).not.toHaveProperty('20261108');
});

it('converts snapshot display fields without mutating the source or carrying flags and comments', async () => {
  const source = Object.freeze({
    name: 'Source machine name', machineNumber: '0012', currentDifference: '-1,234枚', totalGameCount: '5,678回',
    bbCount: '21回', rbCount: ' 9 ', bbProbability: '1/270.4', rbProbability: '1/630.9', combinedProbability: '1/189.3',
    currentUrl: 'https://example.test/machine/12', graphImageUrl: 'https://example.test/graph',
    flag: 6, comment: 'do not copy', isSnapshotFallback: false,
  });
  const payload = Object.freeze({ data: Object.freeze({ '0012': source }) });
  readSnapshot.mockResolvedValue(documentSnapshot(payload));
  const result = await fetchSlotDiffs('store-a', ['20261110']);
  expect(result['20261110']).toEqual([{
    name: 'Official twelve', machineNumber: '0012', diff: -1234, games: 5678, bb: 21, rb: 9,
    bbProbability: '1/270.4', rbProbability: '1/630.9', combinedProbability: '1/189.3',
    url: 'https://example.test/machine/12', isSnapshotFallback: true,
  }]);
  expect(source).toMatchObject({ currentDifference: '-1,234枚', flag: 6, comment: 'do not copy', isSnapshotFallback: false });
  expect(result['20261110'][0]).not.toHaveProperty('flag');
  expect(result['20261110'][0]).not.toHaveProperty('comment');
});

it('uses the snapshot map key when the machine number is absent and preserves real zeroes', async () => {
  readSnapshot.mockResolvedValue(documentSnapshot({ data: {
    501: { name: 'Zero', currentDifference: 0, totalGameCount: '0回', bbCount: 0, rbCount: '0', bbProbability: 0 },
  } }));
  const result = await fetchSlotDiffs('store-a', ['20261110']);
  expect(result['20261110'][0]).toMatchObject({
    machineNumber: '501', diff: 0, games: 0, bb: 0, rb: 0, bbProbability: 0, isSnapshotFallback: true,
  });
});

it.each([null, undefined, '', '-', 'unknown', NaN, Infinity, -Infinity, 'Infinity', '1e999'])
('does not invent zero for missing or nonfinite numeric values (%s)', async value => {
  readSnapshot.mockResolvedValue(documentSnapshot({ data: {
    1: { currentDifference: value, totalGameCount: value, bbCount: value, rbCount: value },
  } }));
  const result = await fetchSlotDiffs('store-a', ['20261110']);
  expect(result['20261110'][0]).toMatchObject({ diff: undefined, games: undefined, bb: undefined, rb: undefined });
  expect(result['20261110'][0].isSnapshotFallback).toBe(true);
});

it('excludes nonfinite numeric probabilities', async () => {
  readSnapshot.mockResolvedValue(documentSnapshot({ data: {
    1: { currentDifference: 1, bbProbability: Infinity, rbProbability: NaN, combinedProbability: -Infinity },
  } }));
  const result = await fetchSlotDiffs('store-a', ['20261110']);
  expect(result['20261110'][0]).toMatchObject({
    bbProbability: undefined, rbProbability: undefined, combinedProbability: undefined,
  });
});

it('leaves a date absent when neither collection has its document', async () => {
  await expect(fetchSlotDiffs('store-a', ['20261110'])).resolves.toEqual({});
  expect(readSnapshot).toHaveBeenCalledTimes(1);
  expect(readLatestSlotDiffs).not.toHaveBeenCalled();
});

it('returns no rows for an empty snapshot document', async () => {
  readSnapshot.mockResolvedValue(documentSnapshot({ data: {} }));
  await expect(fetchSlotDiffs('store-a', ['20261110'])).resolves.toEqual({ '20261110': [] });
  expect(readLatestSlotDiffs).not.toHaveBeenCalled();
});

it('limits fallback to valid past Japanese dates, excluding today and future calendar selections', async () => {
  await fetchSlotDiffs('store-a', ['20261110', '20261111', '20261112', '20260230', '2026110']);
  expect(readSnapshot.mock.calls.map(([ref]) => ref.path)).toEqual(['site777Snapshots/store-a_20261110']);
});

it('propagates slot_diff query failures without treating them as absence', async () => {
  const error = new Error('slot_diff unavailable');
  readSlotDiffs.mockRejectedValue(error);
  await expect(fetchSlotDiffs('store-a', ['20261110'])).rejects.toBe(error);
  expect(readSnapshot).not.toHaveBeenCalled();
  expect(readLatestSlotDiffs).not.toHaveBeenCalled();
});

it('waits for every snapshot read, propagates failures and permits a clean retry', async () => {
  const error = new Error('snapshot permission denied');
  let resolveSlow!: (value: ReturnType<typeof documentSnapshot>) => void;
  const slowRead = new Promise<ReturnType<typeof documentSnapshot>>(resolve => { resolveSlow = resolve; });
  readSnapshot.mockImplementation((ref) => ref.path.endsWith('20261109') ? Promise.reject(error) : slowRead);
  let settled = false;
  const firstAttempt = fetchSlotDiffs('store-a', ['20261109', '20261110']).then(
    result => { settled = true; return result; },
    failure => { settled = true; return failure; }
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(readSnapshot).toHaveBeenCalledTimes(2);
  expect(settled).toBe(false);
  resolveSlow(documentSnapshot());
  expect(await firstAttempt).toBe(error);
  readSnapshot.mockResolvedValue(documentSnapshot({ data: { 1: { currentDifference: 100 } } }));
  const retry = await fetchSlotDiffs('store-a', ['20261109', '20261110']);
  expect(readSlotDiffs).toHaveBeenCalledTimes(2);
  expect(readSnapshot).toHaveBeenCalledTimes(4);
  expect(retry['20261109'][0]).toMatchObject({ diff: 100, isSnapshotFallback: true });
  expect(retry['20261110'][0]).toMatchObject({ diff: 100, isSnapshotFallback: true });
});

it('bases fallback names on the latest official document outside the requested range without importing its other data', async () => {
  readSlotDiffs.mockResolvedValue(querySnapshot({ date: 20261001, data: {
    1: { machineNumber: 1, name: 'Older official name', diff: 300, flag: 4, comment: 'existing' },
  } }));
  const latestItem = Object.freeze({ machineNumber: 1, name: 'Latest official name', diff: 9999, flag: 6, comment: 'latest comment' });
  const latestData = Object.freeze({ date: 20261111, data: Object.freeze({ 1: latestItem }) });
  readLatestSlotDiffs.mockResolvedValue(querySnapshot(latestData));
  readSnapshot.mockResolvedValue(documentSnapshot({ data: {
    1: { machineNumber: '1', name: 'L abbreviated...', currentDifference: -700, totalGameCount: 800, flag: 5, comment: 'snapshot comment' },
  } }));

  const result = await fetchSlotDiffs('store-b', ['20261001', '20261002']);
  expect(result['20261001'][0]).toMatchObject({ name: 'Older official name', diff: 300, flag: 4, comment: 'existing' });
  expect(result['20261002'][0]).toMatchObject({ name: 'Latest official name', machineNumber: '1', diff: -700, games: 800, isSnapshotFallback: true });
  expect(result['20261002'][0]).not.toHaveProperty('flag');
  expect(result['20261002'][0]).not.toHaveProperty('comment');
  expect(result).not.toHaveProperty('20261111');
  expect(readLatestSlotDiffs).toHaveBeenCalledTimes(1);
  expect(readLatestSlotDiffs).toHaveBeenCalledWith({
    ref: { path: 'slot_diff' },
    constraints: [
      ['storeId', '==', 'store-b'],
      { kind: 'orderBy', field: 'date', direction: 'desc' },
      { kind: 'limit', count: 1 },
    ],
  });
  expect(latestItem).toEqual({ machineNumber: 1, name: 'Latest official name', diff: 9999, flag: 6, comment: 'latest comment' });
});

it('reads the latest official name map only once for multiple nonempty fallback dates', async () => {
  readSnapshot.mockImplementation(ref => Promise.resolve(documentSnapshot({ data: {
    1: { name: ref.path.endsWith('20261109') ? 'Different snapshot name' : undefined, currentDifference: 100 },
  } })));
  const result = await fetchSlotDiffs('store-a', ['20261109', '20261110']);
  expect(readLatestSlotDiffs).toHaveBeenCalledTimes(1);
  expect(readQuery).toHaveBeenCalledTimes(2);
  expect(result['20261109'][0]).toMatchObject({ name: 'Official one', diff: 100, isSnapshotFallback: true });
  expect(result['20261110'][0]).toMatchObject({ name: 'Official one', diff: 100, isSnapshotFallback: true });
});

it('excludes unmatched machine numbers and entries without a usable latest official name', async () => {
  readLatestSlotDiffs.mockResolvedValue(querySnapshot({ date: 20261111, data: {
    1: { machineNumber: 1, name: 'Official one' },
    3: { machineNumber: 3, name: '   ' },
    4: { machineNumber: 4 },
    5: { name: 'No machine number' },
  } }));
  readSnapshot.mockResolvedValue(documentSnapshot({ data: {
    1: { currentDifference: 100, name: 'snapshot one' },
    2: { currentDifference: 200, name: 'snapshot two' },
    3: { currentDifference: 300, name: 'snapshot three' },
    4: { currentDifference: 400, name: 'snapshot four' },
    5: { currentDifference: 500, name: 'snapshot five' },
  } }));
  const result = await fetchSlotDiffs('store-a', ['20261110']);
  expect(result['20261110']).toHaveLength(1);
  expect(result['20261110'][0]).toMatchObject({ machineNumber: '1', name: 'Official one', diff: 100 });
});

it.each([
  ['missing', querySnapshot()],
  ['empty', querySnapshot({ date: 20261111, data: {} })],
])('keeps an empty fallback date when the latest official document is %s', async (_label, latest) => {
  readLatestSlotDiffs.mockResolvedValue(latest);
  readSnapshot.mockResolvedValue(documentSnapshot({ data: { 1: { name: 'Never use this snapshot name', currentDifference: 100 } } }));
  await expect(fetchSlotDiffs('store-a', ['20261110'])).resolves.toEqual({ '20261110': [] });
  expect(readLatestSlotDiffs).toHaveBeenCalledTimes(1);
});

it('propagates latest official query failures and retries without leaking snapshot names', async () => {
  const error = new Error('latest official query unavailable');
  readSnapshot.mockResolvedValue(documentSnapshot({ data: { 1: { name: 'L abbreviated...', currentDifference: 100 } } }));
  readLatestSlotDiffs.mockRejectedValueOnce(error);
  await expect(fetchSlotDiffs('store-a', ['20261110'])).rejects.toBe(error);
  const retry = await fetchSlotDiffs('store-a', ['20261110']);
  expect(retry['20261110'][0]).toMatchObject({ name: 'Official one', diff: 100, isSnapshotFallback: true });
  expect(readLatestSlotDiffs).toHaveBeenCalledTimes(2);
  expect(readSnapshot).toHaveBeenCalledTimes(2);
});
