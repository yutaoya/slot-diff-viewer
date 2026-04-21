import type { ColDef } from 'ag-grid-community';
import dayjs from 'dayjs';

// SlotDiffGrid.tsx から切り出した純粋関数群。
// 画面表示の責務とデータ変換/列定義ロジックを分離して保守性を高める。

export type DisplayMetric = 'diff' | 'games';

/**
 * AG Grid の数値比較関数。
 * @param valueA 比較対象A
 * @param valueB 比較対象B
 * @param _nodeA 比較対象Aのノード（未使用）
 * @param _nodeB 比較対象Bのノード（未使用）
 * @param isDescending 降順ソート時に `true`
 */
export function compareNumericCellValues(
  valueA: any,
  valueB: any,
  _nodeA: any,
  _nodeB: any,
  isDescending?: boolean
) {
  const toNumber = (v: any): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const normalized = v.replace(/,/g, '').trim();
      if (!normalized || normalized === '-') return null;
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const a = toNumber(valueA);
  const b = toNumber(valueB);
  const aMissing = a === null;
  const bMissing = b === null;

  if (aMissing && bMissing) return 0;
  if (aMissing && !bMissing) return isDescending ? -1 : 1;
  if (!aMissing && bMissing) return isDescending ? 1 : -1;
  return (a as number) - (b as number);
}

/**
 * 台番別ビュー向けの列定義を組み立てる。
 * @param dates 表示対象日付配列（YYYYMMDD）
 * @param existing 既存の列定義
 * @param showModal セル選択時モーダル起動関数
 * @param latestDate 最新判定に使う日付キー
 * @param todayColumnHeader 本日列ヘッダー文言
 * @param hasTodayDiffData 本日列を表示可能か
 * @param resolveDisplayName 機種名正規化関数
 * @param getTooltipColor 台番号ごとの背景色取得関数
 * @param getTooltipText 台番号ごとのツールチップ文言取得関数
 */
export function buildNumberColumns(
  dates: string[],
  existing: ColDef[],
  showModal: Function,
  latestDate: string,        // ★ 追加
  todayColumnHeader: string,
  hasTodayDiffData: boolean,
  resolveDisplayName: (name: string) => string,
  getTooltipColor: (machineNumber: number | string | null | undefined) => string | undefined,
  getTooltipText: (machineNumber: number | string | null | undefined) => string | undefined
): ColDef[] {
  const existingFields = new Set(existing.map(c => c.field));
  const cols: ColDef[] = [];

  /**
   * 最新日付列の値が欠損かを判定する。
   * @param row 判定対象行
   */
  const isMissingLatest = (row: any) => {
    if (!latestDate) return false; // ★ 実効日付がないならグレー化しない
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-'; // 0 はデータ扱い
  };

  
  if (!existingFields.has('machineNumber')) {
    cols.push({
      headerName: '',
      field: 'machineNumber',
      pinned: 'left',
      width: 40,
      tooltipValueGetter: (p: any) => getTooltipText(p?.data?.machineNumber),
      cellRenderer: (p: any) => {
        const text = getTooltipText(p?.data?.machineNumber);
        return (
          <div title={text || undefined}>
            {p.value}
          </div>
        );
      },
      // ★ 固定列もグレー化
      cellStyle: (p) => {
        const base: any = {
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          borderRight: '1px solid #ccc', 
        };
        if (!p?.data || p.data.isTotalRow) return base;
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        } else {
          const tooltipColor = getTooltipColor(p.data?.machineNumber);
          if (tooltipColor) {
            base.backgroundColor = tooltipColor;
          }
        }
        return base;
      },
    });
  }

  if (!existingFields.has('name')) {
    cols.push({
      headerName: '機種名',
      field: 'name',
      pinned: 'left',
      width: 90,
      valueGetter: (p) => resolveDisplayName(p.data?.name ?? ''),
      // ★ 固定列もグレー化
      cellStyle: (p) => {
        const base: any = {
          fontSize: '0.6em',
          padding: 0,
          whiteSpace: 'normal',
          textAlign: 'center',

        };
        if (!p?.data || p.data.isTotalRow) return base;
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    });
  }

  if (!existingFields.has('todayDiff')) {
    cols.push({
      headerName: todayColumnHeader,
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      cellRenderer: 'customCellRenderer',
      cellRendererParams: { showModal },
      valueFormatter: (p: any) => {
        const v = p?.value;
        if (v === undefined || v === null || v === '-') return '-';
        if (typeof v === 'number') {
          const normalized = Object.is(v, -0) ? 0 : v;
          return normalized.toLocaleString();
        }
        if (typeof v === 'string') {
          const normalized = v.replace(/,/g, '').trim();
          if (/^[+-]?0(?:\.0+)?$/.test(normalized)) return '0';
        }
        return v;
      },
      comparator: compareNumericCellValues,
      cellStyle: (p) => {
        const v = p?.value;
        const base: any = {
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          backgroundColor: '#fff7cc',
          borderRight: '1px solid #ccc',
        };
        if (!p?.data) return base;
        if (typeof v === 'number') {
          if (v > 0 || Object.is(v, 0) || Object.is(v, -0)) base.color = '#4c6cb3';
          else if (v < 0) base.color = '#d9333f';
        }
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
          return base;
        }
        return base;
      },
    });
  }

  const dynamic: ColDef[] = dates
    .filter(d => !existingFields.has(d))
    .map((d) => ({
      headerName: formatDate(d),
      field: d,
      width: 60,
      cellRenderer: 'customCellRenderer',
      cellRendererParams: { showModal },
      comparator: compareNumericCellValues,
      cellStyle: (params) => {
        const v = params.value;
        const row = params.data;
        const field = params.colDef.field as string;
        const flag = row?.flag?.[field];

        let color = '#ccc';
        let backgroundColor: string | undefined;

        if (typeof v === 'number') {
          color = v >= 0 ? '#4c6cb3' : '#d9333f';
        }

        switch (flag) {
          case 9: backgroundColor = '#FFBFC7'; break;
          case 6: backgroundColor = '#5bd799'; break;
          case 5: backgroundColor = '#D3B9DE'; break;
          case 4: backgroundColor = '#FFE899'; break;
          default: break;
        }

        // ★ 全列で“最新欠損”ならグレー
        if (row && !row.isTotalRow && isMissingLatest(row)) {
          backgroundColor = '#e0e0e0';
          color = '#666';
        }

        switch (flag) {
          case 9: backgroundColor = '#FFBFC7'; break;
          case 6: backgroundColor = '#5bd799'; break;
          case 5: backgroundColor = '#D3B9DE'; break;
          case 4: backgroundColor = '#FFE899'; break;
          default: break;
        }

        return {
          color,
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          borderRight: '1px solid #ccc',
          backgroundColor,
        } as any;
      },
    }));

  return [...cols, ...dynamic];
}


// ========= 機種別（平均）columns =========
/**
 * 機種別ビュー向けの列定義を組み立てる。
 * @param dates 表示対象日付配列（YYYYMMDD）
 * @param existing 既存の列定義
 * @param showModal セル選択時モーダル起動関数
 * @param latestDate 最新判定に使う日付キー
 * @param todayColumnHeader 本日列ヘッダー文言
 * @param hasTodayDiffData 本日列を表示可能か
 * @param resolveDisplayName 機種名正規化関数
 * @param displayMetric 表示指標（差枚/回転数）
 */
export function buildGroupedColumnsForDates(
  dates: string[],
  existing: ColDef[],
  showModal: (value: any, row: any, field: string) => void,
  latestDate: string,
  todayColumnHeader: string,
  hasTodayDiffData: boolean,
  resolveDisplayName: (name: string) => string,
  displayMetric: DisplayMetric
): ColDef[] {  const existingFields = new Set(existing.map(c => c.field));
  const cols: ColDef[] = [];

  const isMissingLatest = (row: any) => {
    if (!latestDate) return false;
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-';
  };

  /**
   * 機種別セルの `平均(勝ち台数/台数)` を平均値優先で比較する。
   * @param valueA 比較対象A
   * @param valueB 比較対象B
   * @param _nodeA 比較対象Aのノード（未使用）
   * @param _nodeB 比較対象Bのノード（未使用）
   * @param isDescending 降順ソート時に `true`
   */
  const compareGroupedByAverageDiff = (
    valueA: any,
    valueB: any,
    _nodeA: any,
    _nodeB: any,
    isDescending?: boolean
  ) => {
    const a = parseGroupedMetricCell(valueA);
    const b = parseGroupedMetricCell(valueB);
    const aMissing = !a;
    const bMissing = !b;

    if (aMissing && bMissing) return 0;
    if (aMissing && !bMissing) return isDescending ? -1 : 1;
    if (!aMissing && bMissing) return isDescending ? 1 : -1;

    const avgDiff = a!.avg - b!.avg;
    if (avgDiff !== 0) return avgDiff;

    const winRateDiff = a!.winRate - b!.winRate;
    if (winRateDiff !== 0) return winRateDiff;
    return 0;
  };

  const groupedComparator = displayMetric === 'games'
    ? compareNumericCellValues
    : compareGroupedByAverageDiff;

  /**
   * 機種別セル値から文字色を決める。
   * @param value セル値
   */
  const getGroupedCellColor = (value: any) => {
    const parsed = parseGroupedMetricCell(value);
    if (!parsed) return '#333';
    return parsed.avg >= 0 ? '#4c6cb3' : '#d9333f';
  };

  if (!existingFields.has('name')) {
    cols.push({
      headerName: '機種名',
      field: 'name',
      valueGetter: (p) => resolveDisplayName(p.data?.name ?? p.data?.modelName ?? ''),
      cellRenderer: 'groupedNameCellRenderer',
      pinned: 'left',
      width: 100,
      cellStyle: (p: any) => {
        const base: any = {
          fontSize: '0.6rem',
          padding: 0,
          whiteSpace: 'normal',
          textAlign: 'left',
        };
        if (!p?.data) return base;
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    });
  }

  if (!existingFields.has('todayDiff')) {
    cols.push({
      headerName: todayColumnHeader,
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      cellRenderer: 'groupedCellRenderer',
      cellRendererParams: { showModal },
      comparator: groupedComparator,
      cellStyle: (p: any) => {
        const v = p?.value;
        const base: any = {
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          backgroundColor: '#fff7cc',
          borderRight: '1px solid #ccc',
        };
        if (!p?.data) return base;
        base.color = getGroupedCellColor(v);
        if (!p.data?.isTotalRow && isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    });
  }

  // 日付は降順（最新→古い）
  const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));

  const dynamic: ColDef[] = sortedDates
  .filter(d => !existingFields.has(d))
  .map((d) => ({
    headerName: formatDate(d),
    field: d,
    width: 60,
    cellRenderer: 'groupedCellRenderer',
    // ★ 機種別でもダブルタップでモーダル起動
    cellRendererParams: { showModal },
    comparator: groupedComparator,
    cellStyle: (params) => {
      const v = params.value;
      const row = params.data;
      const field = params.colDef.field as string;

      const flag = row?.flag?.[field];

      let color = getGroupedCellColor(v);

      let backgroundColor: string | undefined;
      switch (flag) {
        case 9: backgroundColor = '#FFBFC7'; break;
        case 5: backgroundColor = '#D3B9DE'; break;
        case 4: backgroundColor = '#FFE899'; break;
      }

      if (row && isMissingLatest(row)) {
        color = '#666';
        if (!backgroundColor) {
          backgroundColor = '#e0e0e0';
        }
      }

      return {
        color,
        fontSize: '0.8em',
        padding: 0,
        fontWeight: 'bold',
        textAlign: 'center',
        borderRight: '1px solid #ccc',
        backgroundColor,
      } as any;
    }
  }));

  return [...cols, ...dynamic];
}

/**
 * 末尾別ビュー向けの列定義を組み立てる。
 * @param dates 表示対象日付配列（YYYYMMDD）
 * @param latestDate 最新判定に使う日付キー
 * @param todayColumnHeader 本日列ヘッダー文言
 * @param hasTodayDiffData 本日列を表示可能か
 * @param displayMetric 表示指標（差枚/回転数）
 * @param tailRowsForScale 回転数ヒートマップのスケール算出用データ
 */
export function buildTailColumnsForDates(
  dates: string[],
  latestDate: string,
  todayColumnHeader: string,
  hasTodayDiffData: boolean,
  displayMetric: DisplayMetric,
  tailRowsForScale: any[]
): ColDef[] {
  const isGamesMetric = displayMetric === 'games';
  /**
   * 末尾別セルの `平均(勝ち台数/台数)` 形式を解析する。
   * @param value 解析対象セル値
   */
  const parseTailCell = (value: any): { avg: number; ratio: string; winRate: number } | null => {
    if (typeof value !== 'string') return null;
    const m = value.match(/^(-?\d+)\((\d+)\/(\d+)\)$/);
    if (!m) return null;
    const avg = Number(m[1]);
    const winCount = Number(m[2]);
    const totalCount = Number(m[3]);
    if (!Number.isFinite(avg) || !Number.isFinite(winCount) || !Number.isFinite(totalCount) || totalCount <= 0) {
      return null;
    }
    return { avg, ratio: `(${winCount}/${totalCount})`, winRate: winCount / totalCount };
  };

  /**
   * 末尾別セル値から平均値のみを抽出する。
   * @param value 解析対象セル値
   */
  const parseTailAverage = (value: any): number | null => {
    if (typeof value === 'number') return value;
    const parsed = parseTailCell(value);
    return parsed ? parsed.avg : null;
  };

  /**
   * 末尾別セルを勝率優先で比較する。
   * @param valueA 比較対象A
   * @param valueB 比較対象B
   * @param _nodeA 比較対象Aのノード（未使用）
   * @param _nodeB 比較対象Bのノード（未使用）
   * @param isDescending 降順ソート時に `true`
   */
  const compareTailByWinRate = (
    valueA: any,
    valueB: any,
    _nodeA: any,
    _nodeB: any,
    isDescending?: boolean
  ) => {
    const a = parseTailCell(valueA);
    const b = parseTailCell(valueB);
    const aMissing = !a;
    const bMissing = !b;

    if (aMissing && bMissing) return 0;
    if (aMissing && !bMissing) return isDescending ? -1 : 1;
    if (!aMissing && bMissing) return isDescending ? 1 : -1;

    const winRateDiff = (a!.winRate - b!.winRate);
    if (winRateDiff !== 0) return winRateDiff;

    const avgDiff = (a!.avg - b!.avg);
    if (avgDiff !== 0) return avgDiff;

    return 0;
  };

  /**
   * 末尾別セルを平均値で比較する。
   * @param valueA 比較対象A
   * @param valueB 比較対象B
   * @param _nodeA 比較対象Aのノード（未使用）
   * @param _nodeB 比較対象Bのノード（未使用）
   * @param isDescending 降順ソート時に `true`
   */
  const compareTailByAverage = (
    valueA: any,
    valueB: any,
    _nodeA: any,
    _nodeB: any,
    isDescending?: boolean
  ) => {
    const a = parseTailAverage(valueA);
    const b = parseTailAverage(valueB);
    const aMissing = a === null;
    const bMissing = b === null;

    if (aMissing && bMissing) return 0;
    if (aMissing && !bMissing) return isDescending ? -1 : 1;
    if (!aMissing && bMissing) return isDescending ? 1 : -1;
    return (a as number) - (b as number);
  };

  const tailComparator = isGamesMetric ? compareTailByAverage : compareTailByWinRate;

  /**
   * 勝率をヒートマップ背景色へ変換する。
   * @param winRate 勝率（0〜1）
   */
  const getWinRateHeatmapColor = (winRate: number): string | undefined => {
    // 勝率40%以下は無色、40%超を薄い赤〜濃い赤にマップ
    if (winRate <= 0.4) return undefined;
    const clamped = Math.max(0.4, Math.min(1, winRate));
    const normalized = (clamped - 0.4) / 0.6; // 0..1
    const alpha = 0.12 + normalized * 0.73;
    return `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
  };

  const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));
  const fieldsForGamesScale = [todayColumnHeader ? 'todayDiff' : '', ...sortedDates].filter((f) => !!f);
  const gamesScaleByField: Record<string, { min: number; max: number }> = {};
  if (isGamesMetric) {
    fieldsForGamesScale.forEach((field) => {
      const values = (tailRowsForScale ?? [])
        .map((row) => parseTailAverage(row?.[field]))
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (values.length === 0) return;
      gamesScaleByField[field] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    });
  }

  /**
   * 回転数を列内相対ヒートマップ背景色へ変換する。
   * @param avgGame 平均回転数
   * @param field 対象列フィールド
   */
  const getGamesHeatmapColor = (avgGame: number, field: string): string | undefined => {
    if (!Number.isFinite(avgGame)) return undefined;
    const scale = gamesScaleByField[field];
    if (!scale) return undefined;
    const span = scale.max - scale.min;
    if (span <= 0) return undefined;
    const normalized = Math.max(0, Math.min(1, (avgGame - scale.min) / span));
    if (normalized <= 0) return undefined;
    const alpha = 0.08 + normalized * 0.52;
    return `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
  };

  /**
   * 最新日付列の値が欠損かを判定する。
   * @param row 判定対象行
   */
  const isMissingLatest = (row: any) => {
    if (!latestDate) return false;
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-';
  };

  const dynamicCols: ColDef[] = sortedDates.map((date) => ({
    headerName: formatDate(date),
    field: date,
    width: 60,
    comparator: tailComparator,
    cellRenderer: (params: any) => {
      if (isGamesMetric) {
        const avg = parseTailAverage(params.value);
        if (avg === null) return params.value;
        return avg.toLocaleString();
      }
      const parsed = parseTailCell(params.value);
      if (!parsed) return params.value;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
          <span>{parsed.avg}</span>
          <span style={{ fontSize: '0.7em' }}>{(parsed.winRate * 100).toFixed(1)}%</span>
          <span style={{ fontSize: '0.65em' }}>{parsed.ratio}</span>
        </div>
      );
    },
    cellStyle: (params) => {
      const v = params.value;
      const parsed = parseTailCell(v);
      let color = '#333';
      const avg = parseTailAverage(v);
      if (avg !== null) {
        color = avg >= 0 ? '#4c6cb3' : '#d9333f';
      }

      let backgroundColor: string | undefined;
      if (isMissingLatest(params.data)) {
        backgroundColor = '#e0e0e0';
        color = '#666';
      } else if (isGamesMetric) {
        if (avg !== null) {
          backgroundColor = getGamesHeatmapColor(avg, date);
        }
      } else if (parsed) {
        backgroundColor = getWinRateHeatmapColor(parsed.winRate);
      }

      return {
        color,
        fontSize: '0.8em',
        padding: 0,
        fontWeight: 'bold',
        textAlign: 'center',
        whiteSpace: 'normal',
        borderRight: '1px solid #ccc',
        backgroundColor,
      } as any;
    },
  }));

  return [
    {
      headerName: '末尾',
      field: 'tailLabel',
      pinned: 'left',
      width: 90,
      cellStyle: (params) => {
        const base: any = {
          fontSize: '0.75rem',
          padding: 0,
          textAlign: 'center',
          fontWeight: 'bold',
          borderRight: '1px solid #ccc',
        };
        if (isMissingLatest(params?.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    },
    {
      headerName: todayColumnHeader,
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      comparator: tailComparator,
      cellRenderer: (params: any) => {
        if (isGamesMetric) {
          const avg = parseTailAverage(params.value);
          if (avg === null) return params.value;
          return avg.toLocaleString();
        }
        const parsed = parseTailCell(params.value);
        if (!parsed) return params.value;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
            <span>{parsed.avg}</span>
            <span style={{ fontSize: '0.7em' }}>{(parsed.winRate * 100).toFixed(1)}%</span>
            <span style={{ fontSize: '0.65em' }}>{parsed.ratio}</span>
          </div>
        );
      },
      cellStyle: (params) => {
        const v = params.value;
        const parsed = parseTailCell(v);
        let color = '#333';
        const avg = parseTailAverage(v);
        if (avg !== null) {
          color = avg >= 0 ? '#4c6cb3' : '#d9333f';
        }
        const base: any = {
          color,
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          whiteSpace: 'normal',
          borderRight: '1px solid #ccc',
          backgroundColor: '#fff7cc',
        };
        if (isMissingLatest(params.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        } else if (isGamesMetric) {
          if (avg !== null) {
            base.backgroundColor = getGamesHeatmapColor(avg, 'todayDiff') ?? '#fff7cc';
          }
        } else if (parsed) {
          base.backgroundColor = getWinRateHeatmapColor(parsed.winRate) ?? '#fff7cc';
        }
        return base;
      },
    },
    ...dynamicCols,
  ];
}

/**
 * 過去日付キー（YYYYMMDD）を指定件数ぶん生成する。
 * @param days 生成件数
 * @param offset 今日からのオフセット日数
 */
export function getPastDates(days: number, offset: number): string[] {
  return Array.from({ length: days }, (_, i) =>
    dayjs().subtract(i + offset, 'day').format('YYYYMMDD')
  );
}

/**
 * `YYYYMMDD` を `MM/DD` 表示へ変換する。
 * @param yyyymmdd 日付キー
 */
function formatDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6)}`;
}

/**
 * 機種別セル表示用に `平均(勝ち台数/台数)` 形式を作る。
 * @param sum 差枚合計
 * @param count 台数
 * @param positiveCount 勝ち台数
 */
function formatGroupedMetricCell(sum: number, count: number, positiveCount: number): string {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) return '-';
  const avg = Math.round(sum / count);
  return `${avg}(${positiveCount}/${count})`;
}

/**
 * `平均(勝ち台数/台数)` 形式の文字列を解析する。
 * @param value 解析対象（文字列または数値）
 */
export function parseGroupedMetricCell(value: any): { avg: number; ratio: string; winRate: number } | null {
  if (typeof value === 'string') {
    const m = value.match(/^(-?\d+)\((\d+)\/(\d+)\)$/);
    if (!m) return null;
    const avg = Number(m[1]);
    const positive = Number(m[2]);
    const count = Number(m[3]);
    if (!Number.isFinite(avg) || !Number.isFinite(positive) || !Number.isFinite(count) || count <= 0) {
      return null;
    }
    return { avg, ratio: `(${positive}/${count})`, winRate: positive / count };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      avg: value,
      ratio: value > 0 ? '(1/1)' : '(0/1)',
      winRate: value > 0 ? 1 : 0,
    };
  }
  return null;
}

/**
 * 機種別行に対して、日付列の表示値を `平均(勝ち台数/台数)` 形式で補完する。
 * @param rows 機種別行データ
 * @param allData 日付別の生データマップ
 */
export function applyGroupedDateMetricCells(rows: any[], allData: Record<string, any>): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const dates = Object.keys(allData ?? {});
  if (dates.length === 0) return rows;

  const perDateByName: Record<string, Record<string, { sum: number; count: number; positiveCount: number }>> = {};
  const perDateTotal: Record<string, { sum: number; count: number; positiveCount: number }> = {};

  dates.forEach((date) => {
    const day = allData?.[date] ?? {};
    const byName: Record<string, { sum: number; count: number; positiveCount: number }> = {};
    let totalSum = 0;
    let totalCount = 0;
    let totalPositiveCount = 0;

    Object.values(day).forEach((item: any) => {
      const name = String(item?.name ?? '');
      const diff = item?.diff;
      if (!name || typeof diff !== 'number') return;
      if (!byName[name]) byName[name] = { sum: 0, count: 0, positiveCount: 0 };
      byName[name].sum += diff;
      byName[name].count += 1;
      if (diff > 0) byName[name].positiveCount += 1;

      totalSum += diff;
      totalCount += 1;
      if (diff > 0) totalPositiveCount += 1;
    });

    perDateByName[date] = byName;
    perDateTotal[date] = { sum: totalSum, count: totalCount, positiveCount: totalPositiveCount };
  });

  return rows.map((row) => {
    if (!row) return row;
    const next = { ...row };

    dates.forEach((date) => {
      if (row?.isTotalRow) {
        const t = perDateTotal[date];
        next[date] = t && t.count > 0
          ? formatGroupedMetricCell(t.sum, t.count, t.positiveCount)
          : '-';
        return;
      }

      const name = String(row?.name ?? row?.modelName ?? '');
      const m = perDateByName[date]?.[name];
      next[date] = m && m.count > 0
        ? formatGroupedMetricCell(m.sum, m.count, m.positiveCount)
        : '-';
    });

    return next;
  });
}

/**
 * 既存行と新規行をマージし、ユーザー編集値（flag/url/comment）を優先保持する。
 * @param prev 現在保持している行配列
 * @param next 新規取得した行配列
 */
export function mergeRowData(prev: any[], next: any[]): any[] {
  const merged: Record<string, any> = {};
  for (const row of prev) merged[row.id] = { ...row };

  for (const row of next) {
    if (!merged[row.id]) {
      merged[row.id] = { ...row };
    } else {
      const mergedRow = merged[row.id];
      for (const key of Object.keys(row)) {
        if (key !== 'flag' && key !== 'urls' && key !== 'comments') {
          mergedRow[key] = row[key];
        }
      }
      mergedRow.flag = {
        ...row.flag,
        ...mergedRow.flag, // 既存のユーザー更新を優先
      };
      mergedRow.urls = {
        ...row.urls,
        ...mergedRow.urls, // 既存のユーザー更新を優先
      };
      mergedRow.comments = {
        ...row.comments,
        ...mergedRow.comments, // 既存のユーザー更新を優先
      };
    }
  }

  return Object.values(merged);
}

/**
 * 台番別行に本日値（todayDiff）を反映する。
 * @param rows 台番別行データ
 * @param todayDiffMap 台番号 -> 本日値マップ
 * @param todaySnapshotDateKey 本日スナップショット日付キー（YYYYMMDD）
 */
export function applyTodayDiffToRows(
  rows: any[],
  todayDiffMap: Record<string, number>,
  todaySnapshotDateKey: string
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const normalizedMap = todayDiffMap ?? {};
  const snapshotBase = /^\d{8}$/.test(todaySnapshotDateKey)
    ? `${todaySnapshotDateKey.slice(0, 4)}-${todaySnapshotDateKey.slice(4, 6)}-${todaySnapshotDateKey.slice(6, 8)}`
    : dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
  const prevDayKey = dayjs(snapshotBase).subtract(1, 'day').format('YYYYMMDD');

  let total = 0;
  let hasTotal = false;

  const mapped = rows.map((row) => {
    if (!row) return row;
    if (row.isTotalRow) return { ...row, todayDiff: '-' };

    const machineKey = String(row.machineNumber ?? '');
    const prevDayValue = row?.[prevDayKey];
    const hasPrevDayValue = !(prevDayValue === undefined || prevDayValue === null || prevDayValue === '-');
    if (!hasPrevDayValue) {
      return { ...row, todayDiff: '-' };
    }
    const diff = normalizedMap[machineKey];
    const todayDiff = Number.isFinite(diff) ? diff : '-';
    if (typeof todayDiff === 'number') {
      total += todayDiff;
      hasTotal = true;
    }
    return { ...row, todayDiff };
  });

  return mapped.map((row) => {
    if (!row?.isTotalRow) return row;
    return {
      ...row,
      todayDiff: hasTotal ? total : '-',
    };
  });
}

/**
 * 機種別行に本日値（todayDiff）を集約反映する。
 * @param groupedRows 機種別行データ
 * @param numberRows 台番別行データ
 * @param latestDate 最新判定に使う日付キー
 * @param includeStats `true` の場合は勝率情報付き文字列を返す
 */
export function applyTodayDiffToGroupedRows(
  groupedRows: any[],
  numberRows: any[],
  latestDate: string,
  includeStats: boolean
): any[] {
  if (!Array.isArray(groupedRows) || groupedRows.length === 0) return groupedRows;
  if (!Array.isArray(numberRows) || numberRows.length === 0) {
    return groupedRows.map((row) => ({ ...row, todayDiff: '-', machineNumbers: [] }));
  }

  /**
   * 行が最新日付データを保持しているかを判定する。
   * @param row 判定対象行
   */
  const hasLatestData = (row: any): boolean => {
    if (!latestDate) return true;
    const v = row?.[latestDate];
    return !(v === undefined || v === null || v === '-');
  };

  const sumByName: Record<string, number> = {};
  const countByName: Record<string, number> = {};
  const positiveByName: Record<string, number> = {};
  const machineNumbersByName: Record<string, string[]> = {};
  let totalSum = 0;
  let totalCount = 0;
  let totalPositive = 0;

  numberRows.forEach((row) => {
    if (!row || row.isTotalRow) return;
    if (!hasLatestData(row)) return;
    const name = String(row.name ?? '');
    const machineKey = String(row.machineNumber ?? '').trim();
    if (name && machineKey) {
      const list = machineNumbersByName[name] ?? (machineNumbersByName[name] = []);
      if (!list.includes(machineKey)) list.push(machineKey);
    }
    const diff = row.todayDiff;
    if (!name || typeof diff !== 'number') return;
    sumByName[name] = (sumByName[name] ?? 0) + diff;
    countByName[name] = (countByName[name] ?? 0) + 1;
    if (diff > 0) positiveByName[name] = (positiveByName[name] ?? 0) + 1;
    totalSum += diff;
    totalCount += 1;
    if (diff > 0) totalPositive += 1;
  });

  return groupedRows.map((row) => {
    if (!row) return row;
    if (row.isTotalRow) {
      const totalAvg = totalCount > 0 ? Math.round(totalSum / totalCount) : '-';
      return {
        ...row,
        todayDiff: includeStats
          ? (totalCount > 0 ? formatGroupedMetricCell(totalSum, totalCount, totalPositive) : '-')
          : totalAvg,
        machineNumbers: [],
      };
    }
    const name = String(row.name ?? row.modelName ?? '');
    const count = countByName[name] ?? 0;
    const machineNumbers = [...(machineNumbersByName[name] ?? [])].sort((a, b) => {
      const ai = Number(a);
      const bi = Number(b);
      if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
      return a.localeCompare(b, 'ja');
    });
    if (count <= 0) return { ...row, todayDiff: '-', machineNumbers };
    const avg = Math.round((sumByName[name] ?? 0) / count);
    return {
      ...row,
      todayDiff: includeStats
        ? formatGroupedMetricCell(sumByName[name] ?? 0, count, positiveByName[name] ?? 0)
        : avg,
      machineNumbers,
    };
  });
}

/**
 * 末尾別行に本日値（todayDiff）を集約反映する。
 * @param tailRows 末尾別行データ
 * @param numberRows 台番別行データ
 * @param includeStats `true` の場合は勝率情報付き文字列を返す
 */
export function applyTodayDiffToTailRows(tailRows: any[], numberRows: any[], includeStats: boolean): any[] {
  if (!Array.isArray(tailRows) || tailRows.length === 0) return tailRows;
  if (!Array.isArray(numberRows) || numberRows.length === 0) {
    return tailRows.map((row) => ({ ...row, todayDiff: '-' }));
  }

  const labels = [
    '末尾0', '末尾1', '末尾2', '末尾3', '末尾4',
    '末尾5', '末尾6', '末尾7', '末尾8', '末尾9',
    'ゾロ目',
  ];
  const sums = Array.from({ length: labels.length }, () => ({ sum: 0, count: 0, positiveCount: 0 }));

  /**
   * 台番号を number として安全に取得する。
   * @param item 台データ
   */
  const getMachineNumber = (item: any): number | null => {
    const raw = item?.machineNumber;
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  /**
   * 台番号がゾロ目か判定する。
   * @param machineNumber 台番号
   */
  const isZorome = (machineNumber: number) => {
    const twoDigits = Math.abs(machineNumber % 100).toString().padStart(2, '0');
    return twoDigits[0] === twoDigits[1];
  };

  numberRows.forEach((row) => {
    if (!row || row.isTotalRow) return;
    const machineNumber = getMachineNumber(row);
    const diff = row.todayDiff;
    if (machineNumber == null || typeof diff !== 'number') return;

    const tail = Math.abs(machineNumber % 10);
    sums[tail].sum += diff;
    sums[tail].count += 1;
    if (diff > 0) sums[tail].positiveCount += 1;

    if (isZorome(machineNumber)) {
      sums[10].sum += diff;
      sums[10].count += 1;
      if (diff > 0) sums[10].positiveCount += 1;
    }
  });

  return tailRows.map((row) => {
    const idx = labels.indexOf(String(row?.tailLabel ?? ''));
    if (idx < 0) return { ...row, todayDiff: '-' };
    const g = sums[idx];
    if (!g || g.count <= 0) return { ...row, todayDiff: '-' };
    const avg = Math.round(g.sum / g.count);
    return {
      ...row,
      todayDiff: includeStats ? `${avg}(${g.positiveCount}/${g.count})` : avg,
    };
  });
}


// ★ 追加：少なくとも1件データのある最新日付を返す
/**
 * 候補日付から「実データが存在する最新日付」を選ぶ。
 * @param allData 日付別の生データマップ
 * @param candidateDates 候補日付キー配列
 */
export function pickEffectiveLatestDate(
  allData: Record<string, any>,  // rawMapRef.current を想定（YYYYMMDD => { dataKey: item })
  candidateDates: string[]
): string | null {
  // 候補日を「新しい順」に
  const sorted = [...candidateDates].sort((a, b) => b.localeCompare(a));
  for (const d of sorted) {
    const dayMap = allData[d] || {};
    // “データあり”の定義：diff が数値 or 0（0もデータとして扱う想定）
    const hasAny = Object.values(dayMap).some((it: any) => {
      const v = it?.diff;
      return v !== undefined && v !== null && v !== '-';
    });
    if (hasAny) return d;
  }
  return null;
}

// 既存：最新欠損を下へ（effectiveLatestDate が空なら何もしない）
/**
 * 最新日付データ欠損行を下に寄せ、残りを台番昇順で並べる。
 * @param rows 対象行配列
 * @param latestDate 判定対象の最新日付キー
 */
export function sortByLatestMissing(rows: any[], latestDate: string): any[] {
  if (!Array.isArray(rows) || rows.length === 0 || !latestDate) return rows;

  /**
   * 対象行の最新日付セルが欠損か判定する。
   * @param row 判定対象行
   */
  const isMissing = (row: any) => {
    const v = row?.[latestDate];
    // “欠損”の定義：undefined / null / '-'（0 はデータ扱い）
    return v === undefined || v === null || v === '-';
  };

  const total = rows.find(r => r?.isTotalRow);
  const others = rows.filter(r => !r?.isTotalRow);

  others.sort((a: any, b: any) => {
    const aMissing = isMissing(a);
    const bMissing = isMissing(b);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;

    const am = Number(a.machineNumber);
    const bm = Number(b.machineNumber);
    if (Number.isFinite(am) && Number.isFinite(bm)) return am - bm;

    return String(a.machineNumber).localeCompare(String(b.machineNumber), 'ja') ||
           String(a.name).localeCompare(String(b.name), 'ja');
  });

  return total ? [total, ...others] : others;
}

// ★ 追加：台番昇順（フォールバック用）
/**
 * 台番昇順で並べ替える（合計行は先頭維持）。
 * @param rows 対象行配列
 */
export function sortByMachineNumber(rows: any[]): any[] {
  const total = rows.find(r => r?.isTotalRow);
  const others = rows.filter(r => !r?.isTotalRow);

  others.sort((a: any, b: any) => {
    const am = Number(a.machineNumber);
    const bm = Number(b.machineNumber);
    if (Number.isFinite(am) && Number.isFinite(bm)) return am - bm;
    return String(a.machineNumber).localeCompare(String(b.machineNumber), 'ja') ||
           String(a.name).localeCompare(String(b.name), 'ja');
  });

  return total ? [total, ...others] : others;
}


