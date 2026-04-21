import type { TodayGalleryItem, TodayGalleryStats } from './types';

/**
 * 本日グラフギャラリー下部の集計テーブルを構築する純粋関数。
 * useMemo から切り出すことで、計算ロジックを単体で追いやすくする。
 * @param items ギャラリー表示中の台データ配列
 */
export function buildTodayGalleryStats(items: TodayGalleryItem[]): TodayGalleryStats {
  /**
   * 数値文字列を number に変換する。
   * @param value 数値または数値を含む文字列
   */
  const parseNumeric = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const digits = value.replace(/[^0-9.-]/g, '');
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  };

  /**
   * 合成確率 `1/xxx` 形式から分母を抽出する。
   * @param value 合成確率文字列
   */
  const parseCombinedDenominator = (value: unknown): number | null => {
    if (typeof value !== 'string') return null;
    const m = value.match(/1\s*\/\s*(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  const rows = (items ?? []).map(({ machineKey, snapshot }) => ({
    machineKey: String(machineKey),
    machineNumber: String(snapshot?.machineNumber ?? machineKey),
    totalGame: parseNumeric(snapshot?.totalGameCount),
    bbCount: parseNumeric(snapshot?.bbCount),
    rbCount: parseNumeric(snapshot?.rbCount),
    combined: parseCombinedDenominator(snapshot?.combinedProbability),
    artCount: parseNumeric(snapshot?.artCount),
  }));

  /**
   * null を除いた平均値を計算する。
   * @param arr 平均計算対象配列
   */
  const avgOf = (arr: Array<number | null>) => {
    const nums = arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length === 0) return null;
    return Math.round(nums.reduce((sum, v) => sum + v, 0) / nums.length);
  };

  const avgTotalGame = avgOf(rows.map((r) => r.totalGame));
  const avgBbCount = avgOf(rows.map((r) => r.bbCount));
  const avgRbCount = avgOf(rows.map((r) => r.rbCount));
  const avgCombined =
    avgTotalGame != null && avgBbCount != null && avgRbCount != null && avgBbCount + avgRbCount > 0
      ? Math.floor(avgTotalGame / (avgBbCount + avgRbCount))
      : avgOf(rows.map((r) => r.combined));

  return {
    rows,
    avgRow: {
      machineNumber: '平均',
      totalGame: avgTotalGame,
      bbCount: avgBbCount,
      rbCount: avgRbCount,
      combined: avgCombined,
      artCount: avgOf(rows.map((r) => r.artCount)),
    },
  };
}
