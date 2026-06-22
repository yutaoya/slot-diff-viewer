import { saveAs } from 'file-saver';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { DisplayMetric } from './gridUtils';
import { estimateJugglerSetting, type JugglerSettingEstimate } from './jugglerSettingHeatmap';
import type { TodaySnapshotItem, ViewMode } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);

export const SLOT_ANALYTICS_FLAG_DEFINITIONS = {
  '0': {
    label: 'フラグなし',
    description: 'ユーザー指定のフラグがない状態。',
  },
  '4': {
    label: '設定456',
    description: '設定4以上を想定したユーザーフラグ。',
  },
  '5': {
    label: '設定56',
    description: '設定5以上を想定したユーザーフラグ。',
  },
  '6': {
    label: '設定6',
    description: '設定6を想定したユーザーフラグ。',
  },
  '9': {
    label: '全台系',
    description: '同一機種または対象範囲が全台系と想定されるユーザーフラグ。',
  },
} as const;

const SLOT_ANALYTICS_SCHEMA_DESCRIPTION = {
  purpose: 'AI解析向けのスロット台データ。台入れ替えを考慮し、台番と機種名の組み合わせごとに時系列データをまとめる。',
  structure: {
    machines: '台番+機種名ごとの配列。同じ台番でも機種名が変わると別グループになる。',
    days: '各台グループの日別データ。本日列を先頭に、その後は過去日を新しい順に並べる。',
    flags: 'ユーザーが手動で付けたフラグの意味。days[].flag はこの定義のキーに対応する。',
    dateFields: '出力対象の日付列一覧。days[] の dateKey と対応する。',
  },
  dayFields: {
    displayValue: '画面で選択中の表示指標の値。view.displayMetric が diff なら差枚、games なら回転数。',
    diff: '差枚。プラスは客側の差枚プラス、マイナスは客側の差枚マイナス。',
    games: '総回転数。',
    bb: 'BIG回数。',
    rb: 'REG回数。',
    bbProbabilityDenominator: 'BB確率の分母。237 は 1/237 を意味する。',
    rbProbabilityDenominator: 'RB確率の分母。416 は 1/416 を意味する。',
    combinedProbabilityDenominator: 'BB+RB合成確率の分母。151 は 1/151 を意味する。',
    flag: 'ユーザーフラグ。0=なし、4=設定456、5=設定56、6=設定6、9=全台系。',
    comment: 'ユーザー入力コメント。未入力は null。',
    settingEstimate: 'ジャグラー設定判別結果。対象外機種、または games/bb/rb が不足する場合は null。',
  },
  settingEstimateFields: {
    target: 'true の場合、この日別データはジャグラー設定判別の対象。',
    specId: '判別に使用した機種スペックID。',
    expectedSetting: '設定1-6の確率分布を使った加重平均値。6に近いほど設定6寄り、1に近いほど設定1寄り。',
    heatmapScore: 'ヒートマップ表示用の0-1スコア。expectedSetting の高さと回転数による信頼度を反映し、1に近いほど赤が濃い。',
    topSetting: 'probabilities の中で最も確率が高い設定番号。断定設定ではなく最頻推定。',
    usesGrape: '差枚から逆算したブドウ回数を判別に使えた場合 true。',
    expectedGrapeDenominator: '推定された設定分布から計算した期待ブドウ確率の分母。5.8 は 1/5.8 を意味し、小さいほどブドウが良い。',
    inferredGrapeCount: '差枚、総回転数、BB/RB回数、払い出し、その他小役期待値から逆算したブドウ回数。逆算不能なら null。',
    inferredGrapeDenominator: '逆算ブドウ確率の分母。6.03 は 1/6.03 を意味し、小さいほどブドウが良い。',
    probabilities: '設定1-6それぞれの推定確率。キーは設定番号、値は0-1の確率。合計は概ね1になる。',
  },
} as const;

type DateField = {
  dateKey: string;
  date: string | null;
  label: string;
  isToday: boolean;
};

type BuildSlotAnalyticsJsonParams = {
  storeId: string;
  viewMode: ViewMode;
  displayMetric: DisplayMetric;
  numberRows: any[];
  loadedDates: string[];
  rawDataByDate: Record<string, any>;
  todaySnapshotMap: Record<string, TodaySnapshotItem>;
  todaySnapshotDateKey: string;
  todayColumnHeader: string;
  hasTodayDiffData: boolean;
};

function roundNumber(value: number | null | undefined, digits = 4): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function isMissingValue(value: unknown): boolean {
  return value === undefined || value === null || value === '' || value === '-';
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/,/g, '').trim();
  if (!normalized || normalized === '-') return null;
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function parseCount(value: unknown): number | null {
  const n = parseNumericValue(value);
  return n === null ? null : Math.round(n);
}

function parseProbabilityDenominator(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/,/g, '').trim();
  if (!normalized || normalized === '-') return null;
  const fraction = normalized.match(/1\s*\/\s*(\d+(?:\.\d+)?)/);
  if (fraction) {
    const n = Number(fraction[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = parseNumericValue(normalized);
  return n !== null && n > 0 ? n : null;
}

function resolveProbabilityDenominator(raw: unknown, games: number | null, count: number | null): number | null {
  const parsed = parseProbabilityDenominator(raw);
  if (parsed !== null) return roundNumber(parsed, 4);
  if (games !== null && count !== null && games > 0 && count > 0) {
    return roundNumber(games / count, 4);
  }
  return null;
}

function normalizeMachineKey(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const [beforeUnderscore] = text.split('_');
  return (beforeUnderscore.trim() || text).trim();
}

function normalizeMachineName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function formatDateKey(dateKey: string): string | null {
  const match = String(dateKey ?? '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function buildDateFields(params: BuildSlotAnalyticsJsonParams): DateField[] {
  const fields: DateField[] = [];
  if (params.hasTodayDiffData) {
    fields.push({
      dateKey: 'todayDiff',
      date: formatDateKey(params.todaySnapshotDateKey),
      label: params.todayColumnHeader || '本日',
      isToday: true,
    });
  }

  const pastDates = Array.from(new Set(params.loadedDates ?? []))
    .filter((dateKey) => /^\d{8}$/.test(dateKey))
    .sort((a, b) => b.localeCompare(a));

  pastDates.forEach((dateKey) => {
    fields.push({
      dateKey,
      date: formatDateKey(dateKey),
      label: formatDateKey(dateKey) ?? dateKey,
      isToday: false,
    });
  });

  return fields;
}

function entriesFromDateData(dateData: any): Array<[string, any]> {
  if (Array.isArray(dateData)) {
    return dateData.map((item, index) => [String(index), item]);
  }
  if (dateData && typeof dateData === 'object') {
    return Object.entries(dateData);
  }
  return [];
}

function findRawDateItem(dateData: any, row: any): any | null {
  const rowMachineKey = normalizeMachineKey(row?.machineNumber);
  const rowName = normalizeMachineName(row?.name ?? row?.modelName);
  const entries = entriesFromDateData(dateData);

  const byMachineAndName = entries.find(([key, item]) => {
    if (!item || typeof item !== 'object') return false;
    return (
      normalizeMachineKey(item?.machineNumber ?? key) === rowMachineKey &&
      rowName &&
      normalizeMachineName(item?.name ?? item?.modelName) === rowName
    );
  });
  if (byMachineAndName) return byMachineAndName[1];

  const byMachine = entries.find(([key, item]) => {
    if (!item || typeof item !== 'object') return false;
    return normalizeMachineKey(item?.machineNumber ?? key) === rowMachineKey;
  });
  if (byMachine) return byMachine[1];

  const byName = entries.find(([, item]) => {
    if (!item || typeof item !== 'object') return false;
    return rowName && normalizeMachineName(item?.name ?? item?.modelName) === rowName;
  });
  return byName?.[1] ?? null;
}

function findTodaySnapshot(snapshotMap: Record<string, TodaySnapshotItem>, row: any): TodaySnapshotItem | null {
  const rowMachineKey = normalizeMachineKey(row?.machineNumber);
  const direct = snapshotMap?.[rowMachineKey];
  if (direct) return direct;

  const entries = Object.entries(snapshotMap ?? {});
  const found = entries.find(([key, snapshot]) => (
    normalizeMachineKey(snapshot?.machineNumber ?? key) === rowMachineKey
  ));
  return found?.[1] ?? null;
}

function resolveMetricSnapshot(source: any, row: any, dateKey: string, displayMetric: DisplayMetric) {
  const displayValue = row?.[dateKey];
  const displayNumber = parseNumericValue(displayValue);

  const games = parseCount(
    source?.totalGameCount ??
    source?.games ??
    (displayMetric === 'games' ? displayValue : undefined)
  );
  const bb = parseCount(source?.bbCount ?? source?.bb);
  const rb = parseCount(source?.rbCount ?? source?.rb);
  const diff = parseNumericValue(
    source?.currentDifference ??
    source?.diff ??
    (displayMetric === 'diff' ? displayValue : undefined)
  );

  return {
    displayValue: displayNumber ?? (isMissingValue(displayValue) ? null : String(displayValue)),
    diff,
    games,
    bb,
    rb,
    bbProbabilityDenominator: resolveProbabilityDenominator(source?.bbProbability, games, bb),
    rbProbabilityDenominator: resolveProbabilityDenominator(source?.rbProbability, games, rb),
    combinedProbabilityDenominator: resolveProbabilityDenominator(
      source?.combinedProbability,
      games,
      bb !== null && rb !== null ? bb + rb : null
    ),
  };
}

function normalizeFlag(value: unknown): number {
  const n = parseCount(value);
  return n === 4 || n === 5 || n === 6 || n === 9 ? n : 0;
}

function getTopSetting(estimate: JugglerSettingEstimate): number {
  let topSetting = 1;
  let topProbability = -1;
  estimate.settingProbabilities.forEach((probability, index) => {
    if (probability > topProbability) {
      topProbability = probability;
      topSetting = index + 1;
    }
  });
  return topSetting;
}

function buildSettingEstimate(recordSource: {
  machineNumber: string;
  machineName: string;
  diff: number | null;
  games: number | null;
  bb: number | null;
  rb: number | null;
}) {
  const estimateInput: any = {
    machineNumber: recordSource.machineNumber,
    name: recordSource.machineName,
    currentDifference: recordSource.diff ?? undefined,
    totalGameCount: recordSource.games ?? undefined,
    bbCount: recordSource.bb ?? undefined,
    rbCount: recordSource.rb ?? undefined,
    diff: recordSource.diff ?? undefined,
    games: recordSource.games ?? undefined,
    bb: recordSource.bb ?? undefined,
    rb: recordSource.rb ?? undefined,
  };
  const estimate = estimateJugglerSetting(estimateInput);

  if (!estimate) return null;

  return {
    target: true,
    specId: estimate.specId,
    expectedSetting: roundNumber(estimate.expectedSetting, 4),
    heatmapScore: roundNumber(estimate.heatmapScore, 4),
    topSetting: getTopSetting(estimate),
    usesGrape: estimate.usesGrape,
    expectedGrapeDenominator: roundNumber(estimate.expectedGrapeDenominator, 4),
    inferredGrapeCount: estimate.inferredGrapeCount,
    inferredGrapeDenominator: roundNumber(estimate.inferredGrapeDenominator, 4),
    probabilities: Object.fromEntries(
      estimate.settingProbabilities.map((probability, index) => [
        String(index + 1),
        roundNumber(probability, 6),
      ])
    ),
  };
}

export function buildSlotAnalyticsJson(params: BuildSlotAnalyticsJsonParams) {
  const dateFields = buildDateFields(params);
  const machines: any[] = [];
  let dayCount = 0;

  (params.numberRows ?? []).forEach((row) => {
    if (!row || row.isTotalRow) return;
    const machineNumber = normalizeMachineKey(row?.machineNumber);
    const machineName = String(row?.name ?? row?.modelName ?? '').trim();
    if (!machineNumber || !machineName) return;

    const days: any[] = [];

    dateFields.forEach((dateField) => {
      const tableValue = row?.[dateField.dateKey];
      if (isMissingValue(tableValue)) return;

      const source = dateField.isToday
        ? findTodaySnapshot(params.todaySnapshotMap, row)
        : findRawDateItem(params.rawDataByDate?.[dateField.dateKey], row);

      const metrics = resolveMetricSnapshot(source ?? {}, row, dateField.dateKey, params.displayMetric);
      const flag = normalizeFlag(row?.flag?.[dateField.dateKey] ?? source?.flag);
      const commentRaw = row?.comments?.[dateField.dateKey] ?? source?.comment;
      const comment = typeof commentRaw === 'string' && commentRaw.trim() ? commentRaw.trim() : null;
      const settingEstimate = buildSettingEstimate({
        machineNumber,
        machineName,
        diff: metrics.diff,
        games: metrics.games,
        bb: metrics.bb,
        rb: metrics.rb,
      });

      days.push({
        date: dateField.date,
        dateKey: dateField.dateKey,
        isToday: dateField.isToday,
        displayValue: metrics.displayValue,
        diff: metrics.diff,
        games: metrics.games,
        bb: metrics.bb,
        rb: metrics.rb,
        bbProbabilityDenominator: metrics.bbProbabilityDenominator,
        rbProbabilityDenominator: metrics.rbProbabilityDenominator,
        combinedProbabilityDenominator: metrics.combinedProbabilityDenominator,
        flag,
        comment,
        settingEstimate,
      });
    });

    if (days.length === 0) return;
    dayCount += days.length;
    machines.push({
      machineKey: `${machineNumber}_${machineName}`,
      machineNumber,
      machineName,
      days,
    });
  });

  return {
    schemaVersion: 'slot-analytics.machine-days.v1',
    exportedAt: new Date().toISOString(),
    storeId: params.storeId,
    schemaDescription: SLOT_ANALYTICS_SCHEMA_DESCRIPTION,
    grouping: {
      unit: 'machineNumber+machineName',
      keyFields: ['machineNumber', 'machineName'],
      description: '台入れ替えを考慮し、同じ台番でも機種名が異なる場合は別グループとして出力する。',
    },
    view: {
      mode: params.viewMode,
      displayMetric: params.displayMetric,
    },
    counts: {
      machines: machines.length,
      days: dayCount,
    },
    dateFields,
    flags: SLOT_ANALYTICS_FLAG_DEFINITIONS,
    machines,
  };
}

export function exportSlotAnalyticsJson(params: BuildSlotAnalyticsJsonParams) {
  const exportData = buildSlotAnalyticsJson(params);
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const fileName = `${params.storeId}_analytics_${dayjs().tz('Asia/Tokyo').format('YYYYMMDDHHmmss')}.json`;
  saveAs(blob, fileName);
  return exportData;
}
