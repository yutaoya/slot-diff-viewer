import dayjs from 'dayjs';

/** Return dates preceding the oldest valid loaded date, newest first. */
export function getOlderDateKeys(loadedDates: Iterable<string>, count = 30): string[] {
  if (!Number.isFinite(count) || count <= 0) return [];

  let oldestDateKey: string | null = null;
  for (const dateKey of loadedDates) {
    if (!/^\d{8}$/.test(dateKey)) continue;
    const date = dayjs(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`);
    if (!date.isValid() || date.format('YYYYMMDD') !== dateKey) continue;
    if (oldestDateKey === null || dateKey < oldestDateKey) oldestDateKey = dateKey;
  }

  if (oldestDateKey === null) return [];
  const oldestDate = dayjs(`${oldestDateKey.slice(0, 4)}-${oldestDateKey.slice(4, 6)}-${oldestDateKey.slice(6, 8)}`);
  return Array.from({ length: Math.floor(count) }, (_, index) =>
    oldestDate.subtract(index + 1, 'day').format('YYYYMMDD')
  );
}
