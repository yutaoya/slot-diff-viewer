import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { fetchSlotDiffs } from './dataFetcher';

jest.mock('./firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, name) => ({ path: name })),
  doc: jest.fn((_db, ...parts) => ({ path: parts.join('/') })),
  query: jest.fn((ref, ...constraints) => ({ ref, constraints })),
  where: jest.fn((...args) => args),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
}));

const readSlotDiffs = getDocs as jest.Mock;
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
  jest.useFakeTimers('modern');
  // The date just changed to November 11 in Japan, but is still November 10 in UTC.
  jest.setSystemTime(new Date('2026-11-10T15:00:00.000Z'));
  readSlotDiffs.mockReset().mockResolvedValue(querySnapshot());
  readSnapshot.mockReset().mockResolvedValue(documentSnapshot());
});

afterEach(() => jest.useRealTimers());

it('does not read Firestore for an empty request', async () => {
  await expect(fetchSlotDiffs('store-a', [])).resolves.toEqual({});
  expect(collection).not.toHaveBeenCalled();
  expect(readSlotDiffs).not.toHaveBeenCalled();
  expect(readSnapshot).not.toHaveBeenCalled();
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
});

it('does not replace an existing but empty slot_diff document', async () => {
  readSlotDiffs.mockResolvedValue(querySnapshot({ date: 20261110, data: {} }));
  readSnapshot.mockResolvedValue(documentSnapshot({ data: { 1: { currentDifference: 100 } } }));
  await expect(fetchSlotDiffs('store-a', ['20261110'])).resolves.toEqual({ '20261110': [] });
  expect(readSnapshot).not.toHaveBeenCalled();
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
    name: 'Source machine name', machineNumber: '0012', diff: -1234, games: 5678, bb: 21, rb: 9,
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
});

it('returns no rows for an empty snapshot document', async () => {
  readSnapshot.mockResolvedValue(documentSnapshot({ data: {} }));
  await expect(fetchSlotDiffs('store-a', ['20261110'])).resolves.toEqual({ '20261110': [] });
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
