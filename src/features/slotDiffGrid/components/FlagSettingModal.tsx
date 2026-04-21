import { Button, Input, Modal, Radio } from 'antd';
import type { FC } from 'react';
import { useSwipeable } from 'react-swipeable';
import type { TodayGalleryStats, TodayOatariHistoryRow, TodaySnapshotItem, ViewMode } from '../types';

type SelectedCell = { rowData: any; field: string; value: any } | null;

type Props = {
  open: boolean;
  selectedCell: SelectedCell;
  selectedCellUrl: string | null;
  selectedFlag: number | null;
  selectedComment: string;
  viewMode: ViewMode;
  onCancel: () => void;
  onOk: () => void | Promise<void>;
  okLoading?: boolean;
  onFlagChange: (flag: number) => void;
  onCommentChange: (comment: string) => void;
  onOpenMachineData: () => void;
  detailSnapshot: TodaySnapshotItem | null;
  detailGraphUrl: string;
  detailHistoryRows: TodayOatariHistoryRow[];
  detailHistoryLoading: boolean;
  detailHistoryCount: number | null;
  detailGalleryItems: Array<{ machineKey: string; snapshot: TodaySnapshotItem }>;
  detailGalleryStats: TodayGalleryStats;
  onOpenDetailMachineFromGallery: (machineKey: string) => void;
  onSwipePrevMachine?: () => void;
  onSwipeNextMachine?: () => void;
};

// フラグ編集モーダルを分離して、グリッド本体の JSX 密度を下げる。
/**
 * フラグ編集モーダル。
 * @param props コンポーネント引数
 * @param props.open モーダル表示状態
 * @param props.selectedCell 現在選択中セル
 * @param props.selectedCellUrl 「台データを見る」で開くURL
 * @param props.selectedFlag 現在選択中のフラグ値
 * @param props.selectedComment 現在入力中のコメント
 * @param props.viewMode 表示モード
 * @param props.onCancel キャンセル時コールバック
 * @param props.onOk OK時コールバック
 * @param props.okLoading OK実行中フラグ
 * @param props.onFlagChange フラグ値変更時コールバック
 * @param props.onCommentChange コメント変更時コールバック
 * @param props.onOpenMachineData 台データモーダル起動コールバック
 * @param props.detailSnapshot 追加表示する詳細スナップショット
 * @param props.detailGraphUrl 追加表示するグラフURL
 * @param props.detailHistoryRows 追加表示する大当り履歴
 * @param props.detailHistoryLoading 追加表示する大当り履歴の読み込み中フラグ
 * @param props.detailHistoryCount 追加表示する大当り履歴件数
 * @param props.detailGalleryItems 機種別時に表示するグラフ一覧
 * @param props.detailGalleryStats 機種別時に表示する合算確率等の集計テーブル
 * @param props.onOpenDetailMachineFromGallery 機種別グラフクリック時のコールバック
 * @param props.onSwipePrevMachine 右スワイプ時（前台）コールバック
 * @param props.onSwipeNextMachine 左スワイプ時（次台）コールバック
 */
export const FlagSettingModal: FC<Props> = ({
  open,
  selectedCell,
  selectedCellUrl,
  selectedFlag,
  selectedComment,
  viewMode,
  onCancel,
  onOk,
  okLoading = false,
  onFlagChange,
  onCommentChange,
  onOpenMachineData,
  detailSnapshot,
  detailGraphUrl,
  detailHistoryRows,
  detailHistoryLoading,
  detailHistoryCount,
  detailGalleryItems,
  detailGalleryStats,
  onOpenDetailMachineFromGallery,
  onSwipePrevMachine,
  onSwipeNextMachine,
}) => {
  const formatDiffLikeValue = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Object.is(value, -0) ? '0' : value.toLocaleString();
    }
    if (typeof value === 'string') {
      const grouped = value.match(/^(-?\d+)\((\d+)\/(\d+)\)$/);
      if (grouped) {
        const avg = Number(grouped[1]);
        return Number.isFinite(avg) ? avg.toLocaleString() : grouped[1];
      }
      const normalized = value.replace(/,/g, '').trim();
      if (/^-?\d+$/.test(normalized)) {
        const n = Number(normalized);
        return Number.isFinite(n) ? n.toLocaleString() : value;
      }
      return value;
    }
    return String(value);
  };

  const summaryLabel = viewMode === 'model' ? '平均差枚' : '差枚';
  const summaryValue = formatDiffLikeValue(selectedCell?.value);
  const metaRowStyle = { margin: '10px 0', lineHeight: 1.3 };
  const metaLabelStyle = { display: 'inline-block', width: '4em' };
  const renderMetaRow = (label: string, value: unknown) => {
    const displayValue = value === null || value === undefined || value === '' ? '-' : String(value);
    return (
      <p style={metaRowStyle}>
        <span style={metaLabelStyle}>{label}</span>
        <span>：</span>
        <span> {displayValue}</span>
      </p>
    );
  };

  const flagSwipeHandlers = useSwipeable({
    delta: 48,
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: false,
    onSwipedLeft: () => {
      onSwipeNextMachine?.();
    },
    onSwipedRight: () => {
      onSwipePrevMachine?.();
    },
  });

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      title="フラグ設定"
      style={{ top: 12 }}
      styles={{
        body: {
          maxHeight: 'calc(100dvh - 140px)',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        },
      }}
    >
      <div style={{ touchAction: 'pan-y' }} {...flagSwipeHandlers}>
        {viewMode !== 'model' ? renderMetaRow('台番号', selectedCell?.rowData?.machineNumber) : null}
        {renderMetaRow('機種名', selectedCell?.rowData?.name ?? selectedCell?.rowData?.modelName)}
        {renderMetaRow('日付', selectedCell?.field)}
        {renderMetaRow(summaryLabel, summaryValue)}
        {selectedCellUrl ? (
          <p style={{ ...metaRowStyle, marginTop: 10, marginBottom: 10 }}>
            <button
              type="button"
              onClick={onOpenMachineData}
              style={{
                padding: 0,
                border: 'none',
                background: 'none',
                color: '#1677ff',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              台データを見る
            </button>
          </p>
        ) : null}

        <Radio.Group onChange={(e) => onFlagChange(Number(e.target.value))} value={selectedFlag}>
          <Radio value={9} disabled={false}>
            全台系
          </Radio>
          <Radio value={6} disabled={viewMode === 'model'}>
            設定6
          </Radio>
          <Radio value={5} disabled={viewMode === 'model'}>
            設定56
          </Radio>
          <Radio value={4} disabled={viewMode === 'model'}>
            設定456
          </Radio>
          <Radio value={0} disabled={false}>
            フラグ解除
          </Radio>
        </Radio.Group>

        <div style={{ marginTop: 10 }}>
          <Input.TextArea
            value={selectedComment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="コメントを入力"
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>

        <div style={{ marginTop: 12, marginBottom: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel}>キャンセル</Button>
          <Button type="primary" loading={okLoading} onClick={() => void onOk()}>
            OK
          </Button>
        </div>

        {viewMode === 'model' ? (
          detailGalleryItems.length > 0 ? (
            <div style={{ marginTop: 4 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 8,
                }}
              >
                {detailGalleryItems.map(({ machineKey, snapshot }) => (
                  <div
                    key={`flag_detail_gallery_${machineKey}`}
                    onClick={() => onOpenDetailMachineFromGallery(machineKey)}
                    style={{
                      border: '1px solid #ddd',
                      borderRadius: 4,
                      overflow: 'hidden',
                      backgroundColor: '#f7f7f7',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.8em',
                        fontWeight: 700,
                        textAlign: 'center',
                        padding: '4px 2px',
                        borderBottom: '1px solid #e1e1e1',
                        backgroundColor: '#fff',
                      }}
                    >
                      {snapshot?.machineNumber ?? machineKey}番台
                    </div>
                    <img
                      src={snapshot?.graphImageUrl ?? ''}
                      alt={`${snapshot?.machineNumber ?? machineKey}番台のグラフ`}
                      style={{ width: '100%', display: 'block' }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ border: '1px solid #cfcfcf', overflow: 'hidden', backgroundColor: '#f0f0f0', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8em' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#e9e9e9' }}>
                      <th style={{ border: '1px solid #c8c8c8', padding: '4px 2px' }}>台番</th>
                      <th style={{ border: '1px solid #c8c8c8', padding: '4px 2px' }}>累計ゲーム</th>
                      <th style={{ border: '1px solid #c8c8c8', padding: '4px 2px' }}>BB回数</th>
                      <th style={{ border: '1px solid #c8c8c8', padding: '4px 2px' }}>RB回数</th>
                      <th style={{ border: '1px solid #c8c8c8', padding: '4px 2px' }}>合成確率</th>
                      <th style={{ border: '1px solid #c8c8c8', padding: '4px 2px' }}>ART回数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailGalleryStats.rows.map((r) => (
                      <tr key={`flag_gallery_stats_${r.machineKey}`} style={{ backgroundColor: '#f2f2f2' }}>
                        <td
                          onClick={() => onOpenDetailMachineFromGallery(r.machineKey)}
                          style={{
                            border: '1px solid #c8c8c8',
                            padding: '3px 2px',
                            textAlign: 'center',
                            color: '#2f69a8',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                          }}
                        >
                          {r.machineNumber}
                        </td>
                        <td style={{ border: '1px solid #c8c8c8', padding: '3px 2px', textAlign: 'center' }}>{r.totalGame ?? '--'}</td>
                        <td style={{ border: '1px solid #c8c8c8', padding: '3px 2px', textAlign: 'center' }}>{r.bbCount ?? '--'}</td>
                        <td style={{ border: '1px solid #c8c8c8', padding: '3px 2px', textAlign: 'center' }}>{r.rbCount ?? '--'}</td>
                        <td style={{ border: '1px solid #c8c8c8', padding: '3px 2px', textAlign: 'center' }}>{r.combined ?? '--'}</td>
                        <td style={{ border: '1px solid #c8c8c8', padding: '3px 2px', textAlign: 'center' }}>{r.artCount ?? '--'}</td>
                      </tr>
                    ))}
                    <tr style={{ backgroundColor: '#c9efc8' }}>
                      <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center', fontWeight: 700 }}>
                        {detailGalleryStats.avgRow.machineNumber}
                      </td>
                      <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{detailGalleryStats.avgRow.totalGame ?? '--'}</td>
                      <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{detailGalleryStats.avgRow.bbCount ?? '--'}</td>
                      <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{detailGalleryStats.avgRow.rbCount ?? '--'}</td>
                      <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{detailGalleryStats.avgRow.combined ?? '--'}</td>
                      <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{detailGalleryStats.avgRow.artCount ?? '--'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#888', padding: '12px 0' }}>
              表示できるグラフ画像がありません
            </div>
          )
        ) : detailSnapshot ? (
          <div style={{ marginTop: 4 }}>
          {detailSnapshot.graphImageUrl ? (
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 4,
                overflow: 'hidden',
                backgroundColor: '#f2f2f2',
              }}
            >
              <img
                src={detailGraphUrl}
                alt="過去日付グラフ"
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#888' }}>グラフ画像なし</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.85em', marginTop: 8 }}>
            <div>累計ゲーム: {detailSnapshot.totalGameCount ?? '-'}</div>
            <div>最高出玉: {detailSnapshot.highestPayout ?? '-'}</div>
            <div>BB回数: {detailSnapshot.bbCount ?? '-'}</div>
            <div>BB確率: {detailSnapshot.bbProbability ?? '-'}</div>
            <div>RB回数: {detailSnapshot.rbCount ?? '-'}</div>
            <div>RB確率: {detailSnapshot.rbProbability ?? '-'}</div>
            <div>ART回数: {detailSnapshot.artCount ?? '-'}</div>
            <div>合成確率: {detailSnapshot.combinedProbability ?? '-'}</div>
          </div>

          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              大当り履歴
              {detailHistoryCount != null ? ` (${detailHistoryCount})` : ''}
            </div>
            <div style={{ border: '1px solid #d9d9d9', overflow: 'hidden', backgroundColor: '#f6f6f6' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f0f0f0' }}>
                    <th style={{ border: '1px solid #cfcfcf', padding: '4px 2px' }}>回数</th>
                    <th style={{ border: '1px solid #cfcfcf', padding: '4px 2px' }}>種類</th>
                    <th style={{ border: '1px solid #cfcfcf', padding: '4px 2px' }}>時間</th>
                    <th style={{ border: '1px solid #cfcfcf', padding: '4px 2px' }}>ゲーム</th>
                    <th style={{ border: '1px solid #cfcfcf', padding: '4px 2px' }}>獲得数</th>
                  </tr>
                </thead>
                <tbody>
                  {detailHistoryLoading ? (
                    <tr>
                      <td colSpan={5} style={{ border: '1px solid #cfcfcf', padding: '8px 4px', textAlign: 'center', color: '#666' }}>
                        履歴を読み込み中...
                      </td>
                    </tr>
                  ) : detailHistoryRows.length > 0 ? (
                    detailHistoryRows.map((h, idx) => {
                      const isArtOrRt = !!h?.isArtOrRt;
                      const kind = String(h?.kind ?? '--').toUpperCase();
                      let kindBg: string | undefined;
                      if (kind === 'ART' || kind === 'RT') kindBg = '#8e2dc0';
                      if (kind === 'BB') kindBg = '#dd3333';
                      if (kind === 'RB') kindBg = '#1f7fd1';
                      const valueStyle: any = isArtOrRt ? { color: '#ff0000' } : {};
                      return (
                        <tr key={`${h?.time ?? 't'}_${h?.count ?? '-'}_${idx}`} style={{ backgroundColor: '#f6f6f6' }}>
                          <td style={{ border: '1px solid #cfcfcf', padding: '3px 2px', textAlign: 'center', ...valueStyle }}>{h?.count ?? '-'}</td>
                          <td style={{ border: '1px solid #cfcfcf', padding: '3px 2px', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                minWidth: 34,
                                padding: '1px 6px',
                                lineHeight: 1.1,
                                borderRadius: 2,
                                color: kindBg ? '#fff' : '#333',
                                fontWeight: 700,
                                backgroundColor: kindBg,
                              }}
                            >
                              {h?.kind ?? '--'}
                            </span>
                          </td>
                          <td style={{ border: '1px solid #cfcfcf', padding: '3px 2px', textAlign: 'center', ...valueStyle }}>{h?.time ?? '--'}</td>
                          <td style={{ border: '1px solid #cfcfcf', padding: '3px 2px', textAlign: 'center', ...valueStyle }}>{h?.game ?? '--'}</td>
                          <td style={{ border: '1px solid #cfcfcf', padding: '3px 2px', textAlign: 'center', ...valueStyle }}>{h?.payout ?? '--'}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ border: '1px solid #cfcfcf', padding: '8px 4px', textAlign: 'center', color: '#888' }}>
                        履歴データなし
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
