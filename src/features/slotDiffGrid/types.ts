// SlotDiffGrid 周辺で共有する型定義。
// 画面本体とユーティリティの依存を薄くし、責務を明確化する。

export type ViewMode = 'number' | 'model' | 'tail'; // 台番別 / 機種別（平均）/ 末尾別

export type TodayOatariHistoryRow = {
  count?: string;
  kind?: string;
  time?: string;
  game?: string;
  payout?: string;
  isArtOrRt?: boolean;
};

export type TodaySnapshotItem = {
  machineNumber?: number | string;
  name?: string;
  currentDifference?: number | string;
  currentUrl?: string;
  graphImageUrl?: string;
  dataUpdatedAt?: string;
  scrapedAt?: string;
  totalGameCount?: string;
  bbCount?: string;
  rbCount?: string;
  artCount?: string;
  highestPayout?: string;
  bbProbability?: string;
  rbProbability?: string;
  combinedProbability?: string;
  rateLabel?: string;
  oatariHistoryStorage?: string;
  oatariHistory?: TodayOatariHistoryRow[]; // 旧形式フォールバック
};

export type GridUiStateSnapshot = {
  columnState?: any[];
  scrollTop?: number;
  scrollLeft?: number;
};

export type TodayGalleryItem = {
  machineKey: string;
  snapshot: TodaySnapshotItem;
};

export type TodayGalleryStatRow = {
  machineKey: string;
  machineNumber: string;
  totalGame: number | null;
  bbCount: number | null;
  rbCount: number | null;
  combined: number | null;
  artCount: number | null;
};

export type TodayGalleryStats = {
  rows: TodayGalleryStatRow[];
  avgRow: {
    machineNumber: string;
    totalGame: number | null;
    bbCount: number | null;
    rbCount: number | null;
    combined: number | null;
    artCount: number | null;
  };
};
