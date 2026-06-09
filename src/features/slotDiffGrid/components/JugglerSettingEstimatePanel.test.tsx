import { render, screen } from '@testing-library/react';
import { JugglerSettingEstimatePanel } from './JugglerSettingEstimatePanel';

describe('JugglerSettingEstimatePanel', () => {
  it('renders setting chart and inferred grape metrics for supported Juggler snapshots', () => {
    render(
      <JugglerSettingEstimatePanel
        snapshot={{
          name: 'ファンキージャグラー２ＫＴ',
          machineNumber: '883',
          totalGameCount: '1829回',
          bbCount: '6回',
          rbCount: '3回',
          currentDifference: '-300',
        }}
      />
    );

    expect(screen.getByText('期待設定チャート')).toBeInTheDocument();
    expect(screen.getByText('設定6')).toBeInTheDocument();
    expect(screen.getByText('逆算ブドウ確率')).toBeInTheDocument();
    expect(screen.getByText('逆算ブドウ回数')).toBeInTheDocument();
    expect(screen.queryByText('期待ブドウ確率')).not.toBeInTheDocument();
    expect(screen.queryByText('判別要素')).not.toBeInTheDocument();
  });
});
