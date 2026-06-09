import type { CSSProperties, FC } from 'react';
import { estimateJugglerSetting } from '../jugglerSettingHeatmap';
import type { TodaySnapshotItem } from '../types';

type Props = {
  snapshot: TodaySnapshotItem | null | undefined;
};

const panelStyle: CSSProperties = {
  border: '1px solid #d7dde4',
  borderRadius: 4,
  background: '#ffffff',
  padding: 10,
  marginTop: 8,
};

const metricGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 6,
  marginTop: 8,
};

const metricStyle: CSSProperties = {
  border: '1px solid #e1e5ea',
  borderRadius: 4,
  padding: '6px 7px',
  background: '#f8fafc',
  minWidth: 0,
};

const metricLabelStyle: CSSProperties = {
  color: '#5f6b7a',
  fontSize: '0.74em',
  lineHeight: 1.25,
  whiteSpace: 'nowrap',
};

const metricValueStyle: CSSProperties = {
  color: '#172033',
  fontSize: '0.96em',
  lineHeight: 1.25,
  fontWeight: 700,
  overflowWrap: 'anywhere',
};

const chartRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '44px minmax(84px, 1fr) 52px 66px',
  gap: 6,
  alignItems: 'center',
  minHeight: 22,
};

function formatDenominator(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '-';
  return `1/${value.toFixed(3)}`;
}

function formatPercent(value: number): string {
  const percent = value * 100;
  if (percent > 0 && percent < 0.1) return '<0.1%';
  return `${percent.toFixed(1)}%`;
}

function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString()}回`;
}

function barColor(setting: number): string {
  const colors = ['#64748b', '#4f7ca8', '#2b8a9f', '#1f9a6f', '#c98312', '#d13232'];
  return colors[Math.max(0, Math.min(colors.length - 1, setting - 1))];
}

export const JugglerSettingEstimatePanel: FC<Props> = ({ snapshot }) => {
  const estimate = snapshot ? estimateJugglerSetting(snapshot) : null;
  if (!estimate) return null;

  const maxProbability = Math.max(...estimate.settingChartRows.map((row) => row.probability), 0.001);

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 700, color: '#172033' }}>設定判別</div>
        <div style={{ color: '#a52323', fontWeight: 700, fontSize: '0.95em' }}>
          期待設定 {estimate.expectedSetting.toFixed(2)}
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: '#172033' }}>期待設定チャート</div>
        <div
          style={{
            ...chartRowStyle,
            color: '#5f6b7a',
            fontSize: '0.74em',
            paddingBottom: 2,
            borderBottom: '1px solid #e6e9ee',
          }}
        >
          <div>設定</div>
          <div>期待度</div>
          <div style={{ textAlign: 'right' }}>割合</div>
          <div style={{ textAlign: 'right' }}>ブドウ</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 5 }}>
          {estimate.settingChartRows.map((row) => {
            const width = `${Math.max(1.5, (row.probability / maxProbability) * 100)}%`;
            return (
              <div key={`juggler_setting_chart_${estimate.specId}_${row.setting}`} style={chartRowStyle}>
                <div style={{ fontWeight: 700, color: '#2f3745' }}>設定{row.setting}</div>
                <div style={{ height: 13, background: '#edf1f5', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      width,
                      height: '100%',
                      background: barColor(row.setting),
                      borderRadius: 2,
                    }}
                  />
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2f3745' }}>
                  {formatPercent(row.probability)}
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2f3745' }}>
                  {formatDenominator(row.grapeDenominator)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={metricGridStyle}>
        <div style={metricStyle}>
          <div style={metricLabelStyle}>逆算ブドウ確率</div>
          <div style={metricValueStyle}>{formatDenominator(estimate.inferredGrapeDenominator)}</div>
        </div>
        <div style={metricStyle}>
          <div style={metricLabelStyle}>逆算ブドウ回数</div>
          <div style={metricValueStyle}>{formatCount(estimate.inferredGrapeCount)}</div>
        </div>
      </div>
    </div>
  );
};
