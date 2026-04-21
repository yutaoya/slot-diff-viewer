import { Modal } from 'antd';
import type { FC } from 'react';

type Props = {
  open: boolean;
  machineUrl: string | null;
  onClose: () => void;
};

// 「台データ」表示モーダル。
// 単純な表示専用 UI を分離して親コンポーネントを読みやすくする。
/**
 * 台データ表示モーダル。
 * @param props コンポーネント引数
 * @param props.open モーダル表示状態
 * @param props.machineUrl iframeで表示するURL
 * @param props.onClose クローズ時コールバック
 */
export const MachineDataModal: FC<Props> = ({ open, machineUrl, onClose }) => {
  return (
    <Modal title="台データ" open={open} onCancel={onClose} footer={null} width="90vw" style={{ top: 20 }}>
      {machineUrl ? (
        <div
          style={{
            width: '100%',
            overflowX: 'hidden',
            touchAction: 'pan-y', // 横方向のパンを抑制
          }}
        >
          <iframe
            src={machineUrl}
            title="台データ"
            style={{
              width: '100%',
              height: '70vh',
              border: 'none',
              display: 'block',
            }}
          />
        </div>
      ) : null}
    </Modal>
  );
};
