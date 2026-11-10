import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FlagSettingModal } from './FlagSettingModal';

const snapshot = {
  name: 'ファンキージャグラー２ＫＴ',
  machineNumber: '883',
  totalGameCount: '1829回',
  bbCount: '6回',
  rbCount: '3回',
  currentDifference: '-300',
  graphImageUrl: '/graph-883.png',
};

const createProps = (): ComponentProps<typeof FlagSettingModal> => ({
  open: true,
  selectedCell: { rowData: { machineNumber: 883, name: snapshot.name }, field: '20261110', value: -300 },
  selectedCellUrl: 'https://example.com/machine/883',
  selectedFlag: 0,
  selectedComment: '',
  viewMode: 'number',
  onCancel: jest.fn(),
  onOk: jest.fn(),
  onFlagChange: jest.fn(),
  onCommentChange: jest.fn(),
  onOpenMachineData: jest.fn(),
  detailSnapshot: snapshot,
  detailGraphUrl: snapshot.graphImageUrl,
  detailHistoryRows: [{ count: '1', kind: 'BB', time: '10:23', game: '125', payout: '240' }],
  detailHistoryLoading: false,
  detailHistoryCount: 1,
  detailGalleryItems: [],
  detailGalleryStats: {
    rows: [],
    avgRow: { machineNumber: '平均', totalGame: null, bbCount: null, rbCount: null, combined: null, artCount: null },
  },
  onOpenDetailMachineFromGallery: jest.fn(),
});

it('shows snapshot details and close controls without editing controls in read-only mode', () => {
  const props = createProps();
  render(<FlagSettingModal {...props} readOnly saveError="以前の保存エラー" />);

  expect(screen.getByRole('dialog', { name: '台データ' })).toBeInTheDocument();
  expect(screen.getByText('スナップショットデータのためフラグは変更できません。')).toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: '過去日付グラフ' })).toHaveAttribute('src', snapshot.graphImageUrl);
  expect(screen.getByText('大当り履歴 (1)')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '10:23' })).toBeInTheDocument();
  expect(screen.getByText('期待設定チャート')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '台データを見る' }));
  expect(props.onOpenMachineData).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(props.onOk).not.toHaveBeenCalled();
});

it('keeps the model gallery available in read-only mode', () => {
  const props = createProps();
  const machineKey = '883_' + snapshot.name;
  render(<FlagSettingModal
    {...props}
    readOnly
    viewMode="model"
    detailGalleryItems={[{ machineKey, snapshot }]}
  />);

  const graph = screen.getByRole('img', { name: '883番台のグラフ' });
  expect(graph).toHaveAttribute('src', snapshot.graphImageUrl);
  fireEvent.click(graph);
  expect(props.onOpenDetailMachineFromGallery).toHaveBeenCalledWith(machineKey);
  expect(screen.getByRole('columnheader', { name: '累計ゲーム' })).toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
});

it('keeps flag and comment editing and saving enabled by default', () => {
  const props = createProps();
  render(<FlagSettingModal {...props} />);

  expect(screen.getByRole('dialog', { name: 'フラグ設定' })).toBeInTheDocument();
  expect(screen.queryByText('スナップショットデータのためフラグは変更できません。')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: '設定6' }));
  expect(props.onFlagChange).toHaveBeenCalledWith(6);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '通常データのコメント' } });
  expect(props.onCommentChange).toHaveBeenCalledWith('通常データのコメント');
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(props.onOk).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
});
