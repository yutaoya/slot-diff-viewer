import {
  applyJugglerSettingHeatmapScoresToGroupedRows,
  applyJugglerSettingHeatmapScoresToNumberRows,
  buildJugglerSettingHeatmapScoreMap,
  buildJugglerSettingHeatmapScoreMapsByDate,
  estimateJugglerSetting,
  findJugglerSettingSpec,
  getJugglerSettingHeatmapScoreFromRow,
  getJugglerSettingHeatmapColorByScore,
} from './jugglerSettingHeatmap';

describe('jugglerSettingHeatmap', () => {
  it('matches supported Juggler model names with common notation variants', () => {
    expect(findJugglerSettingSpec('マイジャグラーV')?.id).toBe('juggler-my5');
    expect(findJugglerSettingSpec('ハッピージャグラーVⅢ')?.id).toBe('juggler-happyv3');
    expect(findJugglerSettingSpec('ハッピージャグラーＶＩＩ…')?.id).toBe('juggler-happyv3');
    expect(findJugglerSettingSpec('ウルトラミラクルジャグラ…')?.id).toBe('juggler-s-ultra-miracle');
    expect(findJugglerSettingSpec('ゴーゴージャグラー３')?.id).toBe('juggler-gogo3');
    expect(findJugglerSettingSpec('ファンキージャグラー２ＫＴ')?.id).toBe('juggler-funkey2');
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
    expect(estimate?.inferredGrapeCount).toBe(1058);
    expect(estimate?.inferredGrapeDenominator).toBeCloseTo(5.671, 3);
    expect(estimate?.expectedGrapeDenominator).toBeLessThan(5.8);
    expect(estimate?.settingChartRows).toHaveLength(6);
    expect(estimate?.expectedSetting).toBeGreaterThan(4);
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
