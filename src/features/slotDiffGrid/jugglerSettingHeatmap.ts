import type { TodaySnapshotItem } from './types';

type JugglerSettingSource = TodaySnapshotItem & {
  games?: number | string;
  bb?: number | string;
  rb?: number | string;
  diff?: number | string;
};

type JugglerSettingSpec = {
  id: string;
  names: string[];
  bigDenominators: [number, number, number, number, number, number];
  regDenominators: [number, number, number, number, number, number];
  grapeDenominators: [number, number, number, number, number, number];
  bigPayout: number;
  regPayout: number;
  grapePayout: number;
  reverseOtherPayouts: Array<{ denominator: number; payout: number }>;
};

export type JugglerSettingChartRow = {
  setting: number;
  probability: number;
  bigDenominator: number;
  regDenominator: number;
  grapeDenominator: number;
};

export type JugglerSettingEstimate = {
  specId: string;
  totalGames: number;
  bigCount: number;
  regCount: number;
  expectedSetting: number;
  expectedGrapeDenominator: number | null;
  settingProbabilities: [number, number, number, number, number, number];
  settingChartRows: JugglerSettingChartRow[];
  heatmapScore: number;
  inferredGrapeCount: number | null;
  inferredGrapeDenominator: number | null;
  usesGrape: boolean;
};

export const JUGGLER_SETTING_HEATMAP_SCORES_FIELD = '__jugglerSettingHeatmapScores';

const replay = { denominator: 7.298, payout: 3 };

const JUGGLER_SETTING_SPECS: JugglerSettingSpec[] = [
  {
    id: 'juggler-mr',
    names: ['ミスタージャグラー', 'Mr.ジャグラー', 'MRジャグラー'],
    bigDenominators: [268.59016, 267.49388, 260.06349, 249.18631, 240.94118, 237.44928],
    regDenominators: [374.49143, 354.24865, 330.9899, 291.27111, 257.00392, 237.44928],
    grapeDenominators: [6.24212, 6.18381, 6.1369, 6.09807, 6.05973, 6.01689],
    bigPayout: 240,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 37.2363, payout: 4 }],
  },
  {
    id: 'juggler-happyv3',
    names: ['ハッピージャグラーV III', 'ハッピージャグラーVⅢ', 'ハッピージャグラーVIII', 'ハッピージャグラーV3'],
    bigDenominators: [273.06667, 270.80992, 263.19679, 254.0155, 239.18248, 225.98621],
    regDenominators: [397.18788, 362.07735, 332.67005, 300.62385, 273.06667, 256],
    grapeDenominators: [6.04018, 6.01027, 5.98011, 5.8598, 5.83996, 5.82025],
    bigPayout: 240,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 56.55, payout: 4 }],
  },
  {
    id: 'juggler-neo-im-ex',
    names: ['アイムジャグラーEX', 'ネオアイムジャグラーEX', 'ニューアイムジャグラーEX'],
    bigDenominators: [273.06667, 269.69547, 269.69547, 259.03557, 259.03557, 255.00389],
    regDenominators: [439.83893, 399.60976, 330.9899, 315.07692, 255.00389, 255.00389],
    grapeDenominators: [6.02408, 6.02408, 6.02408, 6.02408, 6.02408, 5.84777],
    bigPayout: 252,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 35.617, payout: 2 }],
  },
  {
    id: 'juggler-funkey2',
    names: ['ファンキージャグラー2'],
    bigDenominators: [266.4065, 259.03557, 256, 249.18631, 240.05861, 219.91946],
    regDenominators: [439.83893, 407.0559, 366.12291, 322.83744, 299.25114, 262.144],
    grapeDenominators: [5.94, 5.92979, 5.87978, 5.83009, 5.80016, 5.77003],
    bigPayout: 240,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 35.617, payout: 2 }],
  },
  {
    id: 'juggler-my5',
    names: ['マイジャグラーV', 'マイジャグラーⅤ', 'マイジャグラー5'],
    bigDenominators: [273.06667, 270.80992, 266.4065, 254.0155, 240.05861, 229.14685],
    regDenominators: [409.6, 385.50588, 336.08205, 289.9823, 268.59016, 229.14685],
    grapeDenominators: [5.91, 5.86977, 5.83009, 5.80016, 5.75989, 5.67019],
    bigPayout: 240,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 34.657, payout: 2 }],
  },
  {
    id: 'juggler-s-girls',
    names: ['ジャグラーガールズSS', 'ジャグラーガールズ'],
    bigDenominators: [273.06667, 270.80992, 260.06349, 250.1374, 243.62825, 225.98621],
    regDenominators: [381.02326, 350.45989, 316.59903, 281.27039, 270.80992, 252.06154],
    grapeDenominators: [6.01027, 6.01027, 6.01027, 6.01027, 5.92014, 5.88982],
    bigPayout: 240,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 33.301, payout: 2 }],
  },
  {
    id: 'juggler-s-ultra-miracle',
    names: ['ウルトラミラクルジャグラー'],
    bigDenominators: [267.49388, 261.0996, 256, 242.72593, 233.2242, 216.29043],
    regDenominators: [425.55844, 402.06135, 350.45989, 322.83744, 297.89091, 277.69492],
    grapeDenominators: [5.94, 5.93785, 5.93623, 5.93408, 5.93301, 5.92925],
    bigPayout: 240,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 34.86, payout: 2 }],
  },
  {
    id: 'juggler-gogo3',
    names: ['ゴーゴージャグラー3'],
    bigDenominators: [259.03557, 258.01575, 257.00392, 254.0155, 247.30566, 234.89606],
    regDenominators: [354.24865, 332.67005, 306.24299, 268.59016, 247.30566, 234.89606],
    grapeDenominators: [6.24986, 6.20019, 6.15015, 6.06983, 5.99982, 5.92014],
    bigPayout: 240,
    regPayout: 96,
    grapePayout: 8,
    reverseOtherPayouts: [replay, { denominator: 33.2, payout: 2 }],
  },
];

function normalizeMachineName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[・\s_\-./]/g, '')
    .toLowerCase();
}

export function findJugglerSettingSpec(machineName: unknown): JugglerSettingSpec | null {
  const normalized = normalizeMachineName(machineName);
  if (!normalized) return null;
  return JUGGLER_SETTING_SPECS.find((spec) =>
    spec.names.some((name) => {
      const alias = normalizeMachineName(name);
      return alias.length > 0 && normalized.includes(alias);
    })
  ) ?? null;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/,/g, '').trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function firstPresent<T extends object>(source: T | null | undefined, keys: Array<keyof T | string>): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    const value = (source as any)[key as any];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function normalizeMachineKey(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const [beforeUnderscore] = text.split('_');
  return beforeUnderscore.trim() || text;
}

function averageNumeric(values: number[]): number | null {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function logBinomialLikelihood(total: number, hitCount: number, probability: number): number {
  const p = clamp01(probability);
  if (p <= 0) return hitCount === 0 ? 0 : Number.NEGATIVE_INFINITY;
  if (p >= 1) return hitCount === total ? 0 : Number.NEGATIVE_INFINITY;
  return hitCount * Math.log(p) + (total - hitCount) * Math.log(1 - p);
}

function inferGrapeCountFromDiff(
  spec: JugglerSettingSpec,
  totalGames: number,
  bigCount: number,
  regCount: number,
  currentDifference: number
): number | null {
  const baseIn = totalGames * 3;
  const bonusPayout = bigCount * spec.bigPayout + regCount * spec.regPayout;
  const otherPayout = spec.reverseOtherPayouts.reduce((sum, item) => (
    sum + (totalGames / item.denominator) * item.payout
  ), 0);
  const grapeCount = Math.round((currentDifference + baseIn - bonusPayout - otherPayout) / spec.grapePayout);
  if (!Number.isFinite(grapeCount)) return null;
  if (grapeCount < 0 || grapeCount > totalGames) return null;
  return grapeCount;
}

/**
 * BIG/REGと、差枚から逆算できる場合はブドウ回数も使って設定1-6の尤度を返す。
 */
export function estimateJugglerSetting(snapshot: JugglerSettingSource): JugglerSettingEstimate | null {
  const spec = findJugglerSettingSpec(snapshot?.name);
  if (!spec) return null;

  const totalGames = parseNumeric(firstPresent(snapshot, ['totalGameCount', 'games']));
  const rawBigCount = parseNumeric(firstPresent(snapshot, ['bbCount', 'bb']));
  const rawRegCount = parseNumeric(firstPresent(snapshot, ['rbCount', 'rb']));
  const currentDifference = parseNumeric(firstPresent(snapshot, ['currentDifference', 'diff']));

  if (totalGames === null || rawBigCount === null || rawRegCount === null) return null;
  const bigCount = Math.round(rawBigCount);
  const regCount = Math.round(rawRegCount);
  if (totalGames <= 0 || bigCount < 0 || regCount < 0) return null;
  if (bigCount + regCount > totalGames) return null;

  const inferredGrapeCount = currentDifference === null
    ? null
    : inferGrapeCountFromDiff(spec, totalGames, bigCount, regCount, currentDifference);
  const usesGrape = inferredGrapeCount !== null;

  const logLikelihoods = spec.bigDenominators.map((bigDenominator, index) => (
    logBinomialLikelihood(totalGames, bigCount, 1 / bigDenominator) +
    logBinomialLikelihood(totalGames, regCount, 1 / spec.regDenominators[index]) +
    (usesGrape
      ? logBinomialLikelihood(totalGames, inferredGrapeCount as number, 1 / spec.grapeDenominators[index])
      : 0)
  ));

  const maxLog = Math.max(...logLikelihoods);
  const weights = logLikelihoods.map((v) => Math.exp(v - maxLog));
  const weightTotal = weights.reduce((sum, v) => sum + v, 0);
  if (!Number.isFinite(weightTotal) || weightTotal <= 0) return null;

  const settingProbabilities = weights.map((v) => v / weightTotal) as [number, number, number, number, number, number];
  const expectedSetting = settingProbabilities.reduce((sum, probability, index) => (
    sum + probability * (index + 1)
  ), 0);
  const expectedGrapeProbability = settingProbabilities.reduce((sum, probability, index) => (
    sum + probability * (1 / spec.grapeDenominators[index])
  ), 0);
  const expectedGrapeDenominator = expectedGrapeProbability > 0 ? 1 / expectedGrapeProbability : null;
  const inferredGrapeDenominator =
    inferredGrapeCount !== null && inferredGrapeCount > 0 ? totalGames / inferredGrapeCount : null;
  const settingChartRows: JugglerSettingChartRow[] = settingProbabilities.map((probability, index) => ({
    setting: index + 1,
    probability,
    bigDenominator: spec.bigDenominators[index],
    regDenominator: spec.regDenominators[index],
    grapeDenominator: spec.grapeDenominators[index],
  }));

  const settingSixCloseness = clamp01((expectedSetting - 3) / 3);
  const sampleConfidence = clamp01(totalGames / 3000);
  const heatmapScore = clamp01(settingSixCloseness * sampleConfidence);

  return {
    specId: spec.id,
    totalGames,
    bigCount,
    regCount,
    expectedSetting,
    expectedGrapeDenominator,
    settingProbabilities,
    settingChartRows,
    heatmapScore,
    inferredGrapeCount,
    inferredGrapeDenominator,
    usesGrape,
  };
}

export function buildJugglerSettingHeatmapScoreMap(
  snapshotMap: Record<string, JugglerSettingSource>
): Record<string, number> {
  const scoreMap: Record<string, number> = {};
  Object.entries(snapshotMap ?? {}).forEach(([machineKey, snapshot]) => {
    const key = normalizeMachineKey(snapshot?.machineNumber ?? machineKey);
    if (!key) return;
    const estimate = estimateJugglerSetting(snapshot);
    if (!estimate || estimate.heatmapScore <= 0) return;
    scoreMap[key] = estimate.heatmapScore;
  });
  return scoreMap;
}

export function buildJugglerSettingHeatmapScoreMapsByDate(
  allData: Record<string, any>
): Record<string, Record<string, number>> {
  const scoreMapsByDate: Record<string, Record<string, number>> = {};

  Object.entries(allData ?? {}).forEach(([dateKey, dateData]) => {
    if (!dateData || typeof dateData !== 'object') return;
    const entries = Array.isArray(dateData)
      ? dateData.map((item, index) => [String(index), item] as const)
      : Object.entries(dateData);
    const scoreMap = buildJugglerSettingHeatmapScoreMap(
      Object.fromEntries(entries) as Record<string, JugglerSettingSource>
    );
    if (Object.keys(scoreMap).length > 0) {
      scoreMapsByDate[dateKey] = scoreMap;
    }
  });

  return scoreMapsByDate;
}

export function getJugglerSettingHeatmapScoreFromRow(row: any, field: string): number | null {
  if (!row || row.isTotalRow || !field) return null;
  const scores = row?.[JUGGLER_SETTING_HEATMAP_SCORES_FIELD];
  const score = scores?.[field];
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

export function applyJugglerSettingHeatmapScoresToNumberRows(
  rows: any[],
  scoreMapsByDate: Record<string, Record<string, number>>
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const dates = Object.keys(scoreMapsByDate ?? {});
  if (dates.length === 0) {
    return rows.map((row) => {
      if (!row || row.isTotalRow) return row;
      const { [JUGGLER_SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
      return rest;
    });
  }

  return rows.map((row) => {
    if (!row || row.isTotalRow) return row;
    const machineKey = normalizeMachineKey(row.machineNumber);
    if (!machineKey) return row;

    const nextScores: Record<string, number> = {};
    dates.forEach((dateKey) => {
      const score = scoreMapsByDate[dateKey]?.[machineKey];
      if (typeof score === 'number' && Number.isFinite(score)) {
        nextScores[dateKey] = score;
      }
    });

    if (Object.keys(nextScores).length === 0) {
      const { [JUGGLER_SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
      return rest;
    }

    return {
      ...row,
      [JUGGLER_SETTING_HEATMAP_SCORES_FIELD]: nextScores,
    };
  });
}

export function applyJugglerSettingHeatmapScoresToGroupedRows(
  rows: any[],
  allData: Record<string, any>,
  scoreMapsByDate: Record<string, Record<string, number>>
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const dates = Object.keys(scoreMapsByDate ?? {});
  if (dates.length === 0) {
    return rows.map((row) => {
      if (!row || row.isTotalRow) return row;
      const { [JUGGLER_SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
      return rest;
    });
  }

  const scoresByDateAndName: Record<string, Record<string, number[]>> = {};

  dates.forEach((dateKey) => {
    const day = allData?.[dateKey];
    if (!day || typeof day !== 'object') return;
    const entries = Array.isArray(day)
      ? day.map((item, index) => [String(index), item] as const)
      : Object.entries(day);
    const byName: Record<string, number[]> = {};

    entries.forEach(([machineKey, item]: any) => {
      if (!item || typeof item !== 'object') return;
      const name = String(item?.name ?? item?.modelName ?? '').trim();
      if (!name) return;
      const key = normalizeMachineKey(item?.machineNumber ?? machineKey);
      const score = scoreMapsByDate[dateKey]?.[key];
      if (typeof score !== 'number' || !Number.isFinite(score)) return;
      if (!byName[name]) byName[name] = [];
      byName[name].push(score);
    });

    scoresByDateAndName[dateKey] = byName;
  });

  return rows.map((row) => {
    if (!row || row.isTotalRow) return row;
    const name = String(row?.name ?? row?.modelName ?? '').trim();
    if (!name) return row;

    const nextScores: Record<string, number> = {};
    dates.forEach((dateKey) => {
      const score = averageNumeric(scoresByDateAndName[dateKey]?.[name] ?? []);
      if (score !== null) nextScores[dateKey] = score;
    });

    if (Object.keys(nextScores).length === 0) {
      const { [JUGGLER_SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
      return rest;
    }

    return {
      ...row,
      [JUGGLER_SETTING_HEATMAP_SCORES_FIELD]: nextScores,
    };
  });
}

export function averageJugglerSettingHeatmapScore(
  machineNumbers: Array<number | string>,
  scoreMap: Record<string, number>
): number | null {
  const scores = machineNumbers
    .map((machineNumber) => scoreMap[String(machineNumber).trim()])
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function getJugglerSettingHeatmapColorByScore(score: number | null | undefined): string | undefined {
  if (score == null || !Number.isFinite(score)) return undefined;
  const clamped = clamp01(score);
  if (clamped <= 0.03) return undefined;
  const alpha = 0.08 + clamped * 0.68;
  return `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
}
