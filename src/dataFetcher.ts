import dayjs from 'dayjs';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

function parseSnapshotNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const numericText = value.trim().replace(/,/g, '').replace(/(?:枚|回|G)$/i, '').trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(numericText)) return undefined;
  const parsed = Number(numericText);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function snapshotProbability(value: unknown): string | number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'string' ? value : undefined;
}

function snapshotRows(data: unknown): any[] {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).flatMap(([key, item]) => {
    if (!item || typeof item !== 'object') return [];
    const machineNumber = typeof item.machineNumber === 'string' ||
      (typeof item.machineNumber === 'number' && Number.isFinite(item.machineNumber))
      ? item.machineNumber
      : key;
    // Copy only display fields: snapshot flags/comments must never become editable slot_diff data.
    return [{
      name: typeof item.name === 'string' ? item.name : undefined,
      machineNumber,
      diff: parseSnapshotNumber(item.currentDifference),
      games: parseSnapshotNumber(item.totalGameCount),
      bb: parseSnapshotNumber(item.bbCount),
      rb: parseSnapshotNumber(item.rbCount),
      bbProbability: snapshotProbability(item.bbProbability),
      rbProbability: snapshotProbability(item.rbProbability),
      combinedProbability: snapshotProbability(item.combinedProbability),
      url: typeof item.currentUrl === 'string' ? item.currentUrl : undefined,
      isSnapshotFallback: true,
    }];
  });
}

function isHistoricalDate(dateKey: string, todayKey: string): boolean {
  if (!/^\d{8}$/.test(dateKey) || dateKey >= todayKey) return false;
  const date = dayjs(dateKey.slice(0, 4) + '-' + dateKey.slice(4, 6) + '-' + dateKey.slice(6, 8));
  return date.isValid() && date.format('YYYYMMDD') === dateKey;
}

export async function fetchSlotDiffs(storeId: string, dates: string[]): Promise<Record<string, any[]>> {
  const dataMap: Record<string, any[]> = {};
  if (dates.length === 0) return dataMap;

  const requestedDates = Array.from(new Set(dates));
  const numericDates = requestedDates.map(d => parseInt(d, 10));
  const minDate = Math.min(...numericDates);
  const maxDate = Math.max(...numericDates);
  const q = query(
    collection(db, 'slot_diff'),
    where('storeId', '==', storeId),
    where('date', '>=', minDate),
    where('date', '<=', maxDate)
  );

  // A failed query must propagate; only a successful absence permits fallback.
  const snapshot = await getDocs(q);
  snapshot.forEach(slotDoc => {
    const data = slotDoc.data();
    dataMap[data.date.toString()] = Object.values(data.data as any).map((v: any) => ({
      ...v,
      url: data.sourceUrl
        ? data.sourceUrl + (data.sourceUrl.includes('?') ? '&' : '?') + 'num=' + v.machineNumber
        : undefined,
    }));
  });

  // Store dates are Japanese calendar dates, independent of the viewer's timezone.
  const todayKey = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const missingDates = requestedDates.filter(dateKey =>
    !Object.prototype.hasOwnProperty.call(dataMap, dateKey) && isHistoricalDate(dateKey, todayKey)
  );
  const results = await Promise.allSettled(missingDates.map(async dateKey => {
    const fallback = await getDoc(doc(db, 'site777Snapshots', storeId + '_' + dateKey));
    return { dateKey, rows: fallback.exists() ? snapshotRows(fallback.data()?.data) : undefined };
  }));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length > 0) throw failures[0].reason;
  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value.rows !== undefined) {
      dataMap[result.value.dateKey] = result.value.rows;
    }
  });
  return dataMap;
}
