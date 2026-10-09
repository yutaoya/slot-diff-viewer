import { render, screen } from '@testing-library/react';
import { estimateSetting } from '../jugglerSettingHeatmap';
import { JugglerSettingEstimatePanel } from './JugglerSettingEstimatePanel';

const supportedJugglerSnapshot = {
  name: 'ファンキージャグラー２ＫＴ',
  machineNumber: '883',
  totalGameCount: '1829回',
  bbCount: '6回',
  rbCount: '3回',
  currentDifference: '-300',
};

const supportedHanahanaSnapshot = {
  name: 'ハナハナホウオウ天翔30',
  machineNumber: '601',
  totalGameCount: '6000回',
  bbCount: '26回',
  rbCount: '18回',
  currentDifference: '1500枚',
};

describe('JugglerSettingEstimatePanel', () => {
  it('renders setting chart and inferred grape metrics for supported Juggler snapshots', () => {
    render(<JugglerSettingEstimatePanel snapshot={supportedJugglerSnapshot} />);

    expect(screen.getByText('期待設定チャート')).toBeInTheDocument();
    expect(screen.getByText('設定6')).toBeInTheDocument();
    expect(screen.getByText('逆算ぶどう確率')).toBeInTheDocument();
    expect(screen.getByText('逆算ぶどう回数')).toBeInTheDocument();
    expect(screen.queryByText('期待ブドウ確率')).not.toBeInTheDocument();
    expect(screen.queryByText('判別要素')).not.toBeInTheDocument();
  });

  it('renders inferred bell metrics for supported Hanahana snapshots', () => {
    render(<JugglerSettingEstimatePanel snapshot={supportedHanahanaSnapshot} />);

    expect(screen.getByText('期待設定チャート')).toBeInTheDocument();
    expect(screen.getByText('ベル')).toBeInTheDocument();
    expect(screen.getByText('逆算ベル確率')).toBeInTheDocument();
    expect(screen.getByText('逆算ベル回数')).toBeInTheDocument();
  });

  it('renders LB New King Hanahana highest setting as V', () => {
    render(<JugglerSettingEstimatePanel snapshot={{
      name: 'LBニューキングハナハナV',
      machineNumber: '845',
      totalGameCount: '4907回',
      bbCount: '28回',
      rbCount: '12回',
      currentDifference: '3300枚',
    }} />);

    expect(screen.getByText('設定V')).toBeInTheDocument();
    expect(screen.queryByText('設定5')).not.toBeInTheDocument();
  });
  it('uses probability percentages for bar width and highlights only the top setting', () => {
    const estimate = estimateSetting(supportedJugglerSnapshot);
    expect(estimate).not.toBeNull();
    if (!estimate) return;

    render(<JugglerSettingEstimatePanel snapshot={supportedJugglerSnapshot} />);

    const topSetting = estimate.settingChartRows.reduce((best, row) => (
      row.probability > best.probability ? row : best
    ), estimate.settingChartRows[0]).setting;

    estimate.settingChartRows.forEach((row) => {
      const bar = screen.getByTestId(`setting-probability-bar-${row.setting}`);
      expect(bar).toHaveStyle({ width: `${Math.max(0, Math.min(1, row.probability)) * 100}%` });
      expect(bar).toHaveAttribute('data-active', row.setting === topSetting ? 'true' : 'false');
    });

    const activeBars = estimate.settingChartRows
      .map((row) => screen.getByTestId(`setting-probability-bar-${row.setting}`))
      .filter((bar) => bar.getAttribute('data-active') === 'true');
    expect(activeBars).toHaveLength(1);
  });
});
