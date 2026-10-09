import {
  applyJugglerSettingHeatmapScoresToGroupedRows,
  applyJugglerSettingHeatmapScoresToNumberRows,
  buildJugglerSettingHeatmapScoreMap,
  buildJugglerSettingHeatmapScoreMapsByDate,
  estimateJugglerSetting,
  estimateSetting,
  findJugglerSettingSpec,
  getJugglerSettingHeatmapScoreFromRow,
  getJugglerSettingHeatmapColorByScore,
} from './jugglerSettingHeatmap';

describe('jugglerSettingHeatmap', () => {
  it('matches supported Juggler model names with common notation variants', () => {
    expect(findJugglerSettingSpec('マイジャグラーV')?.id).toBe('my_juggler_5');
    expect(findJugglerSettingSpec('ハッピージャグラーVⅢ')?.id).toBe('juggler_happyv3');
    expect(findJugglerSettingSpec('ハッピージャグラーＶＩＩ…')?.id).toBe('juggler_happyv3');
    expect(findJugglerSettingSpec('ウルトラミラクルジャグラ…')?.id).toBe('juggler_s_ultra_miracle');
    expect(findJugglerSettingSpec('ゴーゴージャグラー３')?.id).toBe('juggler_gogo3');
    expect(findJugglerSettingSpec('ファンキージャグラー２ＫＴ')?.id).toBe('juggler_funkey2');
  });

  it('matches supported Hanahana model names with common notation variants', () => {
    expect(findJugglerSettingSpec('ハナハナホウオウ天翔30')?.id).toBe('hanahana_houou_tensyou');
    expect(findJugglerSettingSpec('ドラゴンハナハナ閃光')?.id).toBe('dragon_hanahana_senkou_30');
    expect(findJugglerSettingSpec('Sキングハナハナ-30')?.id).toBe('s_king_hanahana_30');
    expect(findJugglerSettingSpec('スターハナハナ')?.id).toBe('star_hanahana_30');
    expect(findJugglerSettingSpec('ニューキングハナハナV')?.id).toBe('lb_new_king_hanahana_v');
  });

  it('builds a heatmap score from today snapshot BIG/REG counts when diff is absent', () => {
    const estimate = estimateJugglerSetting({
      name: 'マイジャグラーV',
      machineNumber: '941',
      totalGameCount: '6000回',
      bbCount: '28回',
      rbCount: '29回',
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.expectedSetting).toBeGreaterThan(4);
    expect(estimate?.heatmapScore).toBeGreaterThan(0);
    expect(estimate?.usesGrape).toBe(false);
    expect(estimate?.usesSmallRole).toBe(false);
    expect(estimate?.smallRoleLabel).toBe('ぶどう');
    expect(getJugglerSettingHeatmapColorByScore(estimate?.heatmapScore)).toMatch(/^rgba\(255, 40, 40,/);
  });

  it('uses inferred grape count from current difference when available', () => {
    const estimate = estimateJugglerSetting({
      name: 'マイジャグラーV',
      machineNumber: '941',
      totalGameCount: '6000回',
      bbCount: '26回',
      rbCount: '26回',
      currentDifference: 2013,
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.usesGrape).toBe(true);
    expect(estimate?.usesSmallRole).toBe(true);
    expect(estimate?.inferredGrapeCount).toBe(1058);
    expect(estimate?.inferredSmallRoleCount).toBe(1058);
    expect(estimate?.inferredGrapeDenominator).toBeCloseTo(5.671, 3);
    expect(estimate?.expectedSmallRoleDenominator).toBeLessThan(5.8);
    expect(estimate?.settingChartRows).toHaveLength(6);
    expect(estimate?.expectedSetting).toBeGreaterThan(4);
  });

  it('uses inferred bell count for Hanahana machines', () => {
    const estimate = estimateSetting({
      name: 'ハナハナホウオウ天翔30',
      machineNumber: '601',
      totalGameCount: '6000回',
      bbCount: '26回',
      rbCount: '18回',
      currentDifference: 1500,
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.family).toBe('hanahana');
    expect(estimate?.smallRoleLabel).toBe('ベル');
    expect(estimate?.usesSmallRole).toBe(true);
    expect(estimate?.inferredSmallRoleCount).toBeGreaterThan(0);
    expect(estimate?.inferredSmallRoleDenominator).toBeLessThan(8);
    expect(estimate?.settingChartRows).toHaveLength(6);
  });

  it('uses 8 medals for LB New King Hanahana bell payout reverse calculation', () => {
    const estimate = estimateSetting({
      name: 'LBニューキングハナハナV',
      machineNumber: '845',
      totalGameCount: '4907回',
      bbCount: '28回',
      rbCount: '12回',
      currentDifference: 3300,
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.inferredSmallRoleDenominator).toBeCloseTo(7.655, 3);
  });
  it('supports machines without setting 6', () => {
    const estimate = estimateSetting({
      name: 'LBニューキングハナハナV',
      machineNumber: '701',
      totalGameCount: '5000回',
      bbCount: '20回',
      rbCount: '12回',
      bellCount: 700,
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.settings).toEqual([1, 2, 3, 4, 5]);
    expect(estimate?.settingChartRows).toHaveLength(5);
    expect(estimate?.settingChartRows.map((row) => row.setting)).toEqual([1, 2, 3, 4, 5]);
  });

  it('scores LB New King Hanahana heatmap against setting V as the top setting', () => {
    const lowEstimate = estimateSetting({
      name: 'LBニューキングハナハナV',
      totalGameCount: 60000,
      bbCount: 201,
      rbCount: 121,
      bellCount: 7864,
    });
    const vEstimate = estimateSetting({
      name: 'LBニューキングハナハナV',
      totalGameCount: 60000,
      bbCount: 237,
      rbCount: 161,
      bellCount: 8253,
    });

    expect(lowEstimate).not.toBeNull();
    expect(vEstimate).not.toBeNull();
    expect(vEstimate?.expectedSetting).toBeGreaterThan(4.5);
    expect(vEstimate?.heatmapScore).toBeGreaterThan(0.75);
    expect(vEstimate?.heatmapScore ?? 0).toBeGreaterThan(lowEstimate?.heatmapScore ?? 0);
  });
  it('uses past slot diff fields when BIG/REG counts are stored there', () => {
    const estimate = estimateJugglerSetting({
      name: 'マイジャグラーV',
      machineNumber: '959',
      games: 6000,
      bb: 26,
      rb: 26,
      diff: 2013,
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.totalGames).toBe(6000);
    expect(estimate?.bigCount).toBe(26);
    expect(estimate?.regCount).toBe(26);
    expect(estimate?.usesGrape).toBe(true);
    expect(estimate?.heatmapScore).toBeGreaterThan(0);
  });

  it('builds date heatmap maps only for past rows with BIG and REG counts', () => {
    const scoreMaps = buildJugglerSettingHeatmapScoreMapsByDate({
      20260607: {
        '959_マイジャグラーV': {
          name: 'マイジャグラーV',
          machineNumber: '959',
          games: 6000,
          bb: 26,
          rb: 26,
          diff: 2013,
        },
        '960_マイジャグラーV': {
          name: 'マイジャグラーV',
          machineNumber: '960',
          games: 6000,
          diff: 2013,
        },
      },
    });

    expect(scoreMaps[20260607]?.['959']).toBeGreaterThan(0);
    expect(scoreMaps[20260607]?.['960']).toBeUndefined();
  });

  it('attaches past heatmap scores to number and grouped rows', () => {
    const allData = {
      20260607: {
        '959_マイジャグラーV': {
          name: 'マイジャグラーV',
          machineNumber: '959',
          games: 6000,
          bb: 26,
          rb: 26,
          diff: 2013,
        },
      },
    };
    const scoreMaps = buildJugglerSettingHeatmapScoreMapsByDate(allData);
    const numberRows = applyJugglerSettingHeatmapScoresToNumberRows(
      [{ id: '959_マイジャグラーV', machineNumber: '959', name: 'マイジャグラーV' }],
      scoreMaps
    );
    const groupedRows = applyJugglerSettingHeatmapScoresToGroupedRows(
      [{ id: 'avg_マイジャグラーV', name: 'マイジャグラーV' }],
      allData,
      scoreMaps
    );

    expect(getJugglerSettingHeatmapScoreFromRow(numberRows[0], '20260607')).toBeGreaterThan(0);
    expect(getJugglerSettingHeatmapScoreFromRow(groupedRows[0], '20260607')).toBeGreaterThan(0);
  });

  it('skips unsupported models', () => {
    const scoreMap = buildJugglerSettingHeatmapScoreMap({
      101: {
        name: 'スマスロ北斗の拳',
        machineNumber: '101',
        totalGameCount: '6000回',
        bbCount: '30回',
        rbCount: '30回',
      },
    });

    expect(scoreMap).toEqual({});
  });
});

