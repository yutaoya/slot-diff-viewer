export function parseSnapshotNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const numericText = value.trim().replace(/,/g, '').replace(/(?:枚|回|G)$/i, '').trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(numericText)) return undefined;
  const parsed = Number(numericText);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type SnapshotValues = { currentDifference?: unknown; totalGameCount?: unknown };

export function getSnapshotDifference(snapshot: SnapshotValues | null | undefined): number | undefined {
  const diff = parseSnapshotNumber(snapshot?.currentDifference);
  if (diff !== undefined) return diff;
  // Unplayed machines have no graph line, so the scraper stores a null difference.
  // Only an explicit zero game count distinguishes them from genuinely missing data.
  return parseSnapshotNumber(snapshot?.totalGameCount) === 0 ? 0 : undefined;
}
