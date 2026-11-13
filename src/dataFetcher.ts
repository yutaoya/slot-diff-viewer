import dayjs from 'dayjs';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { getSnapshotDifference, parseSnapshotNumber } from './features/slotDiffGrid/snapshotValues';

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
      machineNumber,
      diff: getSnapshotDifference(item),
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
  const latestNamesByMachine = new Map<string, string>();
  if (results.some(result => result.status === 'fulfilled' && (result.value.rows?.length ?? 0) > 0)) {
    // Resolve names from the store's latest official document, even outside the requested range.
    const latestSnapshot = await getDocs(query(
      collection(db, 'slot_diff'),
      where('storeId', '==', storeId),
      orderBy('date', 'desc'),
      limit(1)
    ));
    latestSnapshot.forEach(slotDoc => {
      const entries = slotDoc.data()?.data;
      if (!entries || typeof entries !== 'object') return;
      Object.values(entries).forEach((item: any) => {
        const machineNumber = item?.machineNumber;
        if (typeof machineNumber !== 'string' && !(typeof machineNumber === 'number' && Number.isFinite(machineNumber))) return;
        const machineKey = String(machineNumber).trim();
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        if (machineKey && name) latestNamesByMachine.set(machineKey, name);
      });
    });
  }
  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value.rows !== undefined) {
      dataMap[result.value.dateKey] = result.value.rows.flatMap(row => {
        const name = latestNamesByMachine.get(String(row.machineNumber).trim());
        return name ? [{ ...row, name }] : [];
      });
    }
  });
  return dataMap;
}
