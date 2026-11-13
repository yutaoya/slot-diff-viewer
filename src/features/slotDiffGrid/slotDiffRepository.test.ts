import { doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  fetchSnapshotDetailFromOatariSubcollection,
  fetchTodaySnapshotDetailMap,
} from './slotDiffRepository';

jest.mock('../../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  updateDoc: jest.fn(),
  writeBatch: jest.fn(),
}));

const snapshotId = 'store-a_20261112';
const readers = [
  {
    label: 'daily snapshot details',
    differenceContext: 'current' as const,
    path: 'site777Snapshots/' + snapshotId,
    wrap: (source: Readonly<Record<string, unknown>>) => Object.freeze({
      data: Object.freeze({ '501': source }),
      oatariHistoryStorage: 'subcollection',
    }),
    read: async () => (await fetchTodaySnapshotDetailMap(snapshotId)).detailMap['501'],
  },
  {
    label: 'oatari subcollection snapshot details',
    differenceContext: 'historical' as const,
    path: 'site777Snapshots/' + snapshotId + '/oatariHistories/501',
    wrap: (source: Readonly<Record<string, unknown>>) => Object.freeze({
      ...source,
      oatariHistoryJson: '[]',
      oatariHistoryCount: 0,
    }),
    read: async () => (await fetchSnapshotDetailFromOatariSubcollection(snapshotId, '501')).snapshot,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  (doc as jest.Mock).mockImplementation((_db, ...parts) => ({ path: parts.join('/') }));
  (getDoc as jest.Mock).mockReset();
});

describe.each(readers)('$label', ({ path, wrap, read, differenceContext }) => {
  it.each([
    { label: 'unplayed payload with null difference and zero bonuses', totalGameCount: '0回', currentDifference: null, expected: { current: null, historical: 0 } },
    { label: 'unknown game count with null difference', totalGameCount: undefined, currentDifference: null, expected: { current: null, historical: undefined } },
    { label: 'played machine with null difference', totalGameCount: '850回', currentDifference: null, expected: { current: null, historical: undefined } },
    { label: 'reported difference even when the game count is zero', totalGameCount: '0回', currentDifference: -1200, expected: { current: -1200, historical: -1200 } },
    { label: 'played machine with a measured zero difference', totalGameCount: '850回', currentDifference: 0, expected: { current: 0, historical: 0 } },
  ])('normalizes $label without changing or saving the source', async ({ totalGameCount, currentDifference, expected }) => {
    const source = Object.freeze({
      machineNumber: '501',
      name: 'テスト機種',
      totalGameCount,
      currentDifference,
      bbCount: '0回',
      rbCount: '0回',
      graphImageUrl: '/graph-501.png',
    });
    const payload = wrap(source);
    const sourceBeforeRead = JSON.stringify(payload);
    (getDoc as jest.Mock).mockResolvedValue({ exists: () => true, data: () => payload });

    const snapshot = await read();

    expect(snapshot).toMatchObject({
      machineNumber: '501',
      name: 'テスト機種',
      totalGameCount,
      currentDifference: expected[differenceContext],
      bbCount: '0回',
      rbCount: '0回',
      graphImageUrl: '/graph-501.png',
      oatariHistoryStorage: 'subcollection',
    });
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(getDoc).toHaveBeenCalledWith({ path });
    expect(JSON.stringify(payload)).toBe(sourceBeforeRead);
    expect(source.currentDifference).toBe(currentDifference);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(writeBatch).not.toHaveBeenCalled();
  });
});
