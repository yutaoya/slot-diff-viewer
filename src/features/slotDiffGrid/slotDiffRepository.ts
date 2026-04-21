import {
  FieldPath,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { TodayOatariHistoryRow, TodaySnapshotItem } from './types';

// Firestore 直接アクセスを画面コンポーネントから分離する Repository。
// UI 層は「何をしたいか」だけを記述し、接続詳細はここに集約する。

/**
 * 店舗IDに紐づくツールチップ設定を取得する。
 * @param storeId 対象店舗ID
 */
export async function fetchTooltipMapsByStoreId(storeId: string): Promise<{
  colorMap: Record<string, string>;
  textMap: Record<string, string>;
}> {
  const q = query(collection(db, 'tooltips'), where('storeId', '==', storeId));
  const snapshot = await getDocs(q);
  const colorMap: Record<string, string> = {};
  const textMap: Record<string, string> = {};

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() as {
      rows?: Array<{ machineNumber?: number | string; color?: string; text?: string }>;
    };
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    rows.forEach((row) => {
      const machineNumber = row?.machineNumber;
      const color = row?.color;
      const text = row?.text;

      if (machineNumber != null && typeof color === 'string' && color.trim() !== '') {
        colorMap[String(machineNumber)] = color;
      }
      if (machineNumber != null && typeof text === 'string' && text.trim() !== '') {
        textMap[String(machineNumber)] = text;
      }
    });
  });

  return { colorMap, textMap };
}

/**
 * 機種名統合マップ（別名 -> 正規名）を取得する。
 * @returns キー: 元の機種名、値: 正規化後の機種名
 */
export async function fetchNameCombineMap(): Promise<Record<string, string>> {
  const snap = await getDoc(doc(db, 'config', 'namecCmbine'));
  if (!snap.exists()) return {};

  const payload = snap.data() as any;
  const source = payload?.map && typeof payload.map === 'object' && !Array.isArray(payload.map) ? payload.map : {};

  const next: Record<string, string> = {};
  Object.entries(source as Record<string, unknown>).forEach(([canonicalName, aliases]) => {
    const canonical = String(canonicalName ?? '').trim();
    if (!canonical) return;
    next[canonical] = canonical;
    if (Array.isArray(aliases)) {
      aliases.forEach((alias) => {
        const key = String(alias ?? '').trim();
        if (key) next[key] = canonical;
      });
      return;
    }
    if (typeof aliases === 'string') {
      const key = aliases.trim();
      if (key) next[key] = canonical;
    }
  });

  return next;
}

/**
 * 当日スナップショット詳細を取得する。
 * @param snapshotId `storeId_YYYYMMDD` 形式のドキュメントID
 */
export async function fetchTodaySnapshotDetailMap(snapshotId: string): Promise<{
  exists: boolean;
  detailMap: Record<string, TodaySnapshotItem>;
}> {
  const snap = await getDoc(doc(db, 'site777Snapshots', snapshotId));
  if (!snap.exists()) {
    return { exists: false, detailMap: {} };
  }

  const payload = snap.data() as { data?: Record<string, any>; oatariHistoryStorage?: string };
  const entries = payload?.data ?? {};
  const rootOatariHistoryStorage = typeof payload?.oatariHistoryStorage === 'string' ? payload.oatariHistoryStorage : undefined;
  const detailMap: Record<string, TodaySnapshotItem> = {};

  Object.entries(entries).forEach(([key, item]) => {
    const machineKey = String(item?.machineNumber ?? key);
    const perMachineStorage = typeof item?.oatariHistoryStorage === 'string' ? item.oatariHistoryStorage : undefined;
    detailMap[machineKey] = {
      ...(item as TodaySnapshotItem),
      oatariHistoryStorage: perMachineStorage ?? rootOatariHistoryStorage,
    };
  });

  return { exists: true, detailMap };
}

/**
 * 大当り履歴を配列へ正規化する。
 * @param raw 配列またはJSON文字列
 */
const parseOatariHistory = (raw: unknown): TodayOatariHistoryRow[] => {
  if (Array.isArray(raw)) return raw as TodayOatariHistoryRow[];
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TodayOatariHistoryRow[]) : [];
  } catch {
    return [];
  }
};

/**
 * 大当り履歴 subcollection を取得する。
 * @param snapshotDocId site777Snapshots ドキュメントID
 * @param machineKey 台番号キー
 */
export async function fetchOatariHistorySubcollection(snapshotDocId: string, machineKey: string): Promise<{
  exists: boolean;
  rows: TodayOatariHistoryRow[];
  count: number | null;
}> {
  const ref = doc(db, 'site777Snapshots', snapshotDocId, 'oatariHistories', machineKey);
  const histSnap = await getDoc(ref);
  if (!histSnap.exists()) {
    return { exists: false, rows: [], count: null };
  }

  const data = histSnap.data() as {
    oatariHistoryJson?: unknown;
    oatariHistoryCount?: number | string;
  };
  const rows = parseOatariHistory(data?.oatariHistoryJson);
  const countRaw = data?.oatariHistoryCount;
  const countNumber = typeof countRaw === 'number' ? countRaw : Number(countRaw);
  return {
    exists: true,
    rows,
    count: Number.isFinite(countNumber) ? countNumber : rows.length,
  };
}

/**
 * 過去日付モーダル用に、oatariHistories/{machineNumber} 1件だけを取得する。
 * @param snapshotDocId site777Snapshots ドキュメントID（`{storeId}_{YYYYMMDD}`）
 * @param machineKey 台番号キー
 */
export async function fetchSnapshotDetailFromOatariSubcollection(
  snapshotDocId: string,
  machineKey: string
): Promise<{
  exists: boolean;
  snapshot: TodaySnapshotItem | null;
  rows: TodayOatariHistoryRow[];
  count: number | null;
}> {
  const ref = doc(db, 'site777Snapshots', snapshotDocId, 'oatariHistories', machineKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { exists: false, snapshot: null, rows: [], count: null };
  }

  const data = snap.data() as any;
  const rows = parseOatariHistory(data?.oatariHistoryJson);
  const countRaw = data?.oatariHistoryCount;
  const countNumber = typeof countRaw === 'number' ? countRaw : Number(countRaw);
  const count = Number.isFinite(countNumber) ? countNumber : rows.length;

  const snapshot: TodaySnapshotItem = {
    machineNumber: data?.machineNumber,
    name: data?.name,
    currentDifference: data?.currentDifference,
    currentUrl: data?.currentUrl,
    graphImageUrl: data?.graphImageUrl,
    dataUpdatedAt: data?.dataUpdatedAt,
    scrapedAt: data?.scrapedAt,
    totalGameCount: data?.totalGameCount,
    bbCount: data?.bbCount,
    rbCount: data?.rbCount,
    artCount: data?.artCount,
    highestPayout: data?.highestPayout,
    bbProbability: data?.bbProbability,
    rbProbability: data?.rbProbability,
    combinedProbability: data?.combinedProbability,
    rateLabel: data?.rateLabel,
    oatariHistoryStorage: 'subcollection',
    oatariHistory: rows,
  };

  return { exists: true, snapshot, rows, count };
}

/**
 * 指定日付の slot_diff 生データを取得する。
 * @param storeId 店舗ID
 * @param dateField `YYYYMMDD`
 */
export async function fetchSlotDiffDateData(storeId: string, dateField: string): Promise<{
  exists: boolean;
  data: Record<string, any>;
}> {
  const ref = doc(db, 'slot_diff', `${storeId}_${dateField}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { exists: false, data: {} };
  const payload = snap.data() as { data?: Record<string, any> };
  return { exists: true, data: payload?.data ?? {} };
}

/**
 * 機種別モードのフラグ/コメント更新を行う。
 * @param params 更新条件と更新内容
 * @param params.storeId 店舗ID
 * @param params.dateField 更新対象日付（YYYYMMDD）
 * @param params.targetKeys 更新対象キー配列
 * @param params.selectedFlag 設定するフラグ値
 * @param params.commentValue 設定するコメント
 * @param params.shouldUpdateFlag `true` の場合のみ flag フィールドを更新
 */
export async function updateModelModeFlagsAndComment(params: {
  storeId: string;
  dateField: string;
  targetKeys: string[];
  selectedFlag: number;
  commentValue: string;
  shouldUpdateFlag: boolean;
}) {
  const { storeId, dateField, targetKeys, selectedFlag, commentValue, shouldUpdateFlag } = params;
  if (targetKeys.length === 0) return;
  const ref = doc(db, 'slot_diff', `${storeId}_${dateField}`);

  if (targetKeys.length === 1) {
    const key = targetKeys[0];
    if (shouldUpdateFlag) {
      await updateDoc(
        ref,
        new FieldPath('data', key, 'flag'),
        selectedFlag,
        new FieldPath('data', key, 'comment'),
        commentValue
      );
    } else {
      await updateDoc(ref, new FieldPath('data', key, 'comment'), commentValue);
    }
    return;
  }

  const batch = writeBatch(db);
  targetKeys.forEach((key) => {
    if (shouldUpdateFlag) {
      batch.update(
        ref,
        new FieldPath('data', key, 'flag'),
        selectedFlag,
        new FieldPath('data', key, 'comment'),
        commentValue
      );
    } else {
      batch.update(ref, new FieldPath('data', key, 'comment'), commentValue);
    }
  });
  await batch.commit();
}

/**
 * 台番別モードのフラグ/コメント更新を行う。
 * @param params 更新条件と更新内容
 * @param params.storeId 店舗ID
 * @param params.dateField 更新対象日付（YYYYMMDD）
 * @param params.targetKeys 更新対象キー配列
 * @param params.selectedFlag 設定するフラグ値
 * @param params.commentValue 設定するコメント
 */
export async function updateNumberModeFlagsAndComment(params: {
  storeId: string;
  dateField: string;
  targetKeys: string[];
  selectedFlag: number;
  commentValue: string;
}) {
  const { storeId, dateField, targetKeys, selectedFlag, commentValue } = params;
  if (targetKeys.length === 0) return;

  const ref = doc(db, 'slot_diff', `${storeId}_${dateField}`);
  const batch = writeBatch(db);
  targetKeys.forEach((key) => {
    batch.update(
      ref,
      new FieldPath('data', key, 'flag'),
      selectedFlag,
      new FieldPath('data', key, 'comment'),
      commentValue
    );
  });
  await batch.commit();
}
