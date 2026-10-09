import machineSpecsData from './settingMachineSpecs.json';
import type { TodaySnapshotItem } from './types';

type SettingEstimateSource = TodaySnapshotItem & {
  games?: number | string;
  bb?: number | string;
  rb?: number | string;
  diff?: number | string;
  grape?: number | string;
  grapeCount?: number | string;
  bell?: number | string;
  bellCount?: number | string;
  smallRoleCount?: number | string;
};

type ProbabilityElementSpec = {
  id: string;
  label: string;
  countKey: string;
  denominators: number[];
};

type SamaiPayoutSpec = {
  denominator: number;
  payout: number;
};

type SamaiLevelSpec = {
  id: string;
  label: string;
  otherPayouts: SamaiPayoutSpec[];
};

type SamaiCalculationSpec = {
  targetCountKey: string;
  targetPayout: number;
  bigCountKey: string;
  regCountKey: string;
  startingBigCountKey?: string;
  startingRegCountKey?: string;
  bigPayout: number;
  regPayout: number;
  defaultLevel: string;
  levels: SamaiLevelSpec[];
};

export type SettingMachineSpec = {
  id: string;
  family: 'juggler' | 'hanahana';
  name: string;
  aliases: string[];
  settings: number[];
  settingLabels?: string[];
  elements: {
    big: ProbabilityElementSpec;
    reg: ProbabilityElementSpec;
    smallRole: ProbabilityElementSpec;
  };
  samaiCalculation: SamaiCalculationSpec;
};

export type SettingEstimateChartRow = {
  setting: number;
  settingLabel: string;
  probability: number;
  bigDenominator: number;
  regDenominator: number;
  smallRoleDenominator: number;
  grapeDenominator: number;
};

export type SettingEstimate = {
  specId: string;
  family: SettingMachineSpec['family'];
  machineName: string;
  settings: number[];
  settingLabels: string[];
  smallRoleId: string;
  smallRoleLabel: string;
  totalGames: number;
  bigCount: number;
  regCount: number;
  expectedSetting: number;
  expectedSmallRoleDenominator: number | null;
  expectedGrapeDenominator: number | null;
  settingProbabilities: number[];
  settingChartRows: SettingEstimateChartRow[];
  heatmapScore: number;
  inferredSmallRoleCount: number | null;
  inferredSmallRoleDenominator: number | null;
  inferredGrapeCount: number | null;
  inferredGrapeDenominator: number | null;
  usesSmallRole: boolean;
  usesGrape: boolean;
};

export type JugglerSettingSource = SettingEstimateSource;
export type JugglerSettingSpec = SettingMachineSpec;
export type JugglerSettingChartRow = SettingEstimateChartRow;
export type JugglerSettingEstimate = SettingEstimate;

export const JUGGLER_SETTING_HEATMAP_SCORES_FIELD = '__jugglerSettingHeatmapScores';
export const SETTING_HEATMAP_SCORES_FIELD = JUGGLER_SETTING_HEATMAP_SCORES_FIELD;

const SETTING_MACHINE_SPECS = machineSpecsData as SettingMachineSpec[];
const SETTING_HEATMAP_TARGET_SETTING_BY_SPEC_ID: Record<string, number> = {
  lb_new_king_hanahana_v: 5,
};

function normalizeMachineName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[・\s_\-./〜～…「」『』（）()【】]/g, '')
    .toLowerCase();
}

export function findSettingMachineSpec(machineName: unknown): SettingMachineSpec | null {
  const normalized = normalizeMachineName(machineName);
  if (!normalized) return null;

  let bestSpec: SettingMachineSpec | null = null;
  let bestScore = -1;
  SETTING_MACHINE_SPECS.forEach((spec) => {
    const names = [spec.name, ...(spec.aliases ?? [])];
    names.forEach((name) => {
      const alias = normalizeMachineName(name);
      if (!alias || !normalized.includes(alias)) return;
      const exactBonus = normalized === alias ? 1000 : 0;
      const score = exactBonus + alias.length;
      if (score > bestScore) {
        bestSpec = spec;
        bestScore = score;
      }
    });
  });

  return bestSpec;
}

export function findJugglerSettingSpec(machineName: unknown): SettingMachineSpec | null {
  return findSettingMachineSpec(machineName);
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

function probabilityFromDenominator(denominator: number): number {
  return denominator > 0 ? 1 / denominator : 0;
}

function logBinomialLikelihood(total: number, hitCount: number, probability: number): number {
  const p = clamp01(probability);
  if (p <= 0) return hitCount === 0 ? 0 : Number.NEGATIVE_INFINITY;
  if (p >= 1) return hitCount === total ? 0 : Number.NEGATIVE_INFINITY;
  return hitCount * Math.log(p) + (total - hitCount) * Math.log(1 - p);
}

function getSettingDenominator(denominators: number[], index: number): number | null {
  const value = denominators[index];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function getDirectSmallRoleCount(snapshot: SettingEstimateSource, spec: SettingMachineSpec): number | null {
  const countKey = spec.elements.smallRole.countKey;
  const smallRoleId = spec.elements.smallRole.id;
  const raw = firstPresent(snapshot, [
    countKey,
    `${countKey}Count`,
    smallRoleId,
    `${smallRoleId}Count`,
    'smallRoleCount',
  ]);
  const count = parseNumeric(raw);
  if (count === null) return null;
  return Math.round(count);
}

function inferSmallRoleCountFromDiff(
  spec: SettingMachineSpec,
  totalGames: number,
  bigCount: number,
  regCount: number,
  currentDifference: number
): number | null {
  const configuration = spec.samaiCalculation;
  const level = configuration.levels.find((item) => item.id === configuration.defaultLevel)
    ?? configuration.levels[0];
  if (!level || configuration.targetPayout <= 0) return null;

  const insertedMedals = totalGames * 3;
  const bonusPayout = bigCount * configuration.bigPayout + regCount * configuration.regPayout;
  const otherExpectedPayout = level.otherPayouts.reduce((sum, item) => {
    if (!item || item.denominator <= 0) return sum;
    return sum + (totalGames / item.denominator) * item.payout;
  }, 0);
  const targetPayout = currentDifference + insertedMedals - bonusPayout - otherExpectedPayout;
  if (!Number.isFinite(targetPayout) || targetPayout < 0) return null;

  const smallRoleCount = Math.round(targetPayout / configuration.targetPayout);
  if (!Number.isFinite(smallRoleCount)) return null;
  if (smallRoleCount < 0 || smallRoleCount > totalGames) return null;
  return smallRoleCount;
}

function normalizeLikelihoods(logLikelihoods: number[]): number[] | null {
  const finiteLogs = logLikelihoods.filter((value) => Number.isFinite(value));
  if (finiteLogs.length === 0) return null;
  const maxLog = Math.max(...finiteLogs);
  const weights = logLikelihoods.map((value) => (
    Number.isFinite(value) ? Math.exp(value - maxLog) : 0
  ));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(weightTotal) || weightTotal <= 0) return null;
  return weights.map((value) => value / weightTotal);
}

function settingLabelFor(spec: SettingMachineSpec, index: number): string {
  const label = spec.settingLabels?.[index];
  return label && label.trim() ? label : String(spec.settings[index]);
}

function expectedDenominator(probabilities: number[], denominators: number[]): number | null {
  const probability = probabilities.reduce((sum, settingProbability, index) => {
    const denominator = getSettingDenominator(denominators, index);
    return denominator ? sum + settingProbability * probabilityFromDenominator(denominator) : sum;
  }, 0);
  return probability > 0 ? 1 / probability : null;
}

function heatmapScoreFromExpectedSetting(spec: SettingMachineSpec, expectedSetting: number, totalGames: number): number {
  const targetSetting = SETTING_HEATMAP_TARGET_SETTING_BY_SPEC_ID[spec.id] ?? Math.max(...spec.settings);
  const middleSetting = Math.min(3, targetSetting - 1);
  const highSettingCloseness = clamp01((expectedSetting - middleSetting) / Math.max(1, targetSetting - middleSetting));
  const sampleConfidence = clamp01(totalGames / 3000);
  return clamp01(highSettingCloseness * sampleConfidence);
}

/**
 * BIG/REG と、直接入力または差枚から逆算できる小役回数を使って設定別の相対尤度を返す。
 */
export function estimateSetting(snapshot: SettingEstimateSource): SettingEstimate | null {
  const spec = findSettingMachineSpec(snapshot?.name);
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

  const directSmallRoleCount = getDirectSmallRoleCount(snapshot, spec);
  const inferredSmallRoleCount = directSmallRoleCount !== null
    ? directSmallRoleCount
    : currentDifference === null
      ? null
      : inferSmallRoleCountFromDiff(spec, totalGames, bigCount, regCount, currentDifference);
  const usesSmallRole = inferredSmallRoleCount !== null
    && inferredSmallRoleCount >= 0
    && inferredSmallRoleCount <= totalGames;

  const logLikelihoods = spec.settings.map((_setting, index) => {
    const bigDenominator = getSettingDenominator(spec.elements.big.denominators, index);
    const regDenominator = getSettingDenominator(spec.elements.reg.denominators, index);
    if (!bigDenominator || !regDenominator) return Number.NEGATIVE_INFINITY;

    return logBinomialLikelihood(totalGames, bigCount, probabilityFromDenominator(bigDenominator))
      + logBinomialLikelihood(totalGames, regCount, probabilityFromDenominator(regDenominator))
      + (usesSmallRole
        ? logBinomialLikelihood(
          totalGames,
          inferredSmallRoleCount as number,
          probabilityFromDenominator(spec.elements.smallRole.denominators[index])
        )
        : 0);
  });

  const settingProbabilities = normalizeLikelihoods(logLikelihoods);
  if (!settingProbabilities) return null;

  const expectedSetting = settingProbabilities.reduce((sum, probability, index) => (
    sum + probability * spec.settings[index]
  ), 0);
  const expectedSmallRoleDenominator = expectedDenominator(
    settingProbabilities,
    spec.elements.smallRole.denominators
  );
  const inferredSmallRoleDenominator =
    inferredSmallRoleCount !== null && inferredSmallRoleCount > 0 ? totalGames / inferredSmallRoleCount : null;
  const settingChartRows: SettingEstimateChartRow[] = settingProbabilities.map((probability, index) => ({
    setting: spec.settings[index],
    settingLabel: settingLabelFor(spec, index),
    probability,
    bigDenominator: spec.elements.big.denominators[index],
    regDenominator: spec.elements.reg.denominators[index],
    smallRoleDenominator: spec.elements.smallRole.denominators[index],
    grapeDenominator: spec.elements.smallRole.denominators[index],
  }));

  return {
    specId: spec.id,
    family: spec.family,
    machineName: spec.name,
    settings: [...spec.settings],
    settingLabels: spec.settings.map((_setting, index) => settingLabelFor(spec, index)),
    smallRoleId: spec.elements.smallRole.id,
    smallRoleLabel: spec.elements.smallRole.label,
    totalGames,
    bigCount,
    regCount,
    expectedSetting,
    expectedSmallRoleDenominator,
    expectedGrapeDenominator: expectedSmallRoleDenominator,
    settingProbabilities,
    settingChartRows,
    heatmapScore: heatmapScoreFromExpectedSetting(spec, expectedSetting, totalGames),
    inferredSmallRoleCount,
    inferredSmallRoleDenominator,
    inferredGrapeCount: inferredSmallRoleCount,
    inferredGrapeDenominator: inferredSmallRoleDenominator,
    usesSmallRole,
    usesGrape: usesSmallRole,
  };
}

export function estimateJugglerSetting(snapshot: SettingEstimateSource): SettingEstimate | null {
  return estimateSetting(snapshot);
}

export function buildSettingHeatmapScoreMap(
  snapshotMap: Record<string, SettingEstimateSource>
): Record<string, number> {
  const scoreMap: Record<string, number> = {};
  Object.entries(snapshotMap ?? {}).forEach(([machineKey, snapshot]) => {
    const key = normalizeMachineKey(snapshot?.machineNumber ?? machineKey);
    if (!key) return;
    const estimate = estimateSetting(snapshot);
    if (!estimate || estimate.heatmapScore <= 0) return;
    scoreMap[key] = estimate.heatmapScore;
  });
  return scoreMap;
}

export function buildJugglerSettingHeatmapScoreMap(
  snapshotMap: Record<string, SettingEstimateSource>
): Record<string, number> {
  return buildSettingHeatmapScoreMap(snapshotMap);
}

export function buildSettingHeatmapScoreMapsByDate(
  allData: Record<string, any>
): Record<string, Record<string, number>> {
  const scoreMapsByDate: Record<string, Record<string, number>> = {};

  Object.entries(allData ?? {}).forEach(([dateKey, dateData]) => {
    if (!dateData || typeof dateData !== 'object') return;
    const entries = Array.isArray(dateData)
      ? dateData.map((item, index) => [String(index), item] as const)
      : Object.entries(dateData);
    const scoreMap = buildSettingHeatmapScoreMap(
      Object.fromEntries(entries) as Record<string, SettingEstimateSource>
    );
    if (Object.keys(scoreMap).length > 0) {
      scoreMapsByDate[dateKey] = scoreMap;
    }
  });

  return scoreMapsByDate;
}

export function buildJugglerSettingHeatmapScoreMapsByDate(
  allData: Record<string, any>
): Record<string, Record<string, number>> {
  return buildSettingHeatmapScoreMapsByDate(allData);
}

export function getSettingHeatmapScoreFromRow(row: any, field: string): number | null {
  if (!row || row.isTotalRow || !field) return null;
  const scores = row?.[SETTING_HEATMAP_SCORES_FIELD];
  const score = scores?.[field];
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

export function getJugglerSettingHeatmapScoreFromRow(row: any, field: string): number | null {
  return getSettingHeatmapScoreFromRow(row, field);
}

export function applySettingHeatmapScoresToNumberRows(
  rows: any[],
  scoreMapsByDate: Record<string, Record<string, number>>
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const dates = Object.keys(scoreMapsByDate ?? {});
  if (dates.length === 0) {
    return rows.map((row) => {
      if (!row || row.isTotalRow) return row;
      const { [SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
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
      const { [SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
      return rest;
    }

    return {
      ...row,
      [SETTING_HEATMAP_SCORES_FIELD]: nextScores,
    };
  });
}

export function applyJugglerSettingHeatmapScoresToNumberRows(
  rows: any[],
  scoreMapsByDate: Record<string, Record<string, number>>
): any[] {
  return applySettingHeatmapScoresToNumberRows(rows, scoreMapsByDate);
}

export function applySettingHeatmapScoresToGroupedRows(
  rows: any[],
  allData: Record<string, any>,
  scoreMapsByDate: Record<string, Record<string, number>>
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const dates = Object.keys(scoreMapsByDate ?? {});
  if (dates.length === 0) {
    return rows.map((row) => {
      if (!row || row.isTotalRow) return row;
      const { [SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
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
      const { [SETTING_HEATMAP_SCORES_FIELD]: _unused, ...rest } = row;
      return rest;
    }

    return {
      ...row,
      [SETTING_HEATMAP_SCORES_FIELD]: nextScores,
    };
  });
}

export function applyJugglerSettingHeatmapScoresToGroupedRows(
  rows: any[],
  allData: Record<string, any>,
  scoreMapsByDate: Record<string, Record<string, number>>
): any[] {
  return applySettingHeatmapScoresToGroupedRows(rows, allData, scoreMapsByDate);
}

export function averageSettingHeatmapScore(
  machineNumbers: Array<number | string>,
  scoreMap: Record<string, number>
): number | null {
  const scores = machineNumbers
    .map((machineNumber) => scoreMap[String(machineNumber).trim()])
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function averageJugglerSettingHeatmapScore(
  machineNumbers: Array<number | string>,
  scoreMap: Record<string, number>
): number | null {
  return averageSettingHeatmapScore(machineNumbers, scoreMap);
}

export function getSettingHeatmapColorByScore(score: number | null | undefined): string | undefined {
  if (score == null || !Number.isFinite(score)) return undefined;
  const clamped = clamp01(score);
  if (clamped <= 0.03) return undefined;
  const alpha = 0.08 + clamped * 0.68;
  return `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
}

export function getJugglerSettingHeatmapColorByScore(score: number | null | undefined): string | undefined {
  return getSettingHeatmapColorByScore(score);
}


