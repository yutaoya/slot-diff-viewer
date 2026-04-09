// src/components/SlotDiffGrid.tsx
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ColDef,
  ModuleRegistry,
  RowStyleModule,
  CellStyleModule,
  ClientSideRowModelModule,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { useSwipeable } from 'react-swipeable';
import { AnimatePresence, motion } from 'framer-motion';

// データ関連（パスは環境に合わせて）
import { fetchSlotDiffs } from './dataFetcher';
import { transformToGridData, transformToGroupedGridData, transformToTailGridData } from './dataTransformer';

// UI
import { Input, Modal, Radio } from 'antd';
import { doc, updateDoc, getDoc, getFirestore, FieldPath, writeBatch, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { FormControl, MenuItem, Select, Switch } from '@mui/material';
import { styled } from '@mui/material/styles';
import { SelectChangeEvent } from '@mui/material/Select';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { Button } from '@mui/material';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

dayjs.extend(utc);
dayjs.extend(timezone);

// AG Grid モジュール登録
ModuleRegistry.registerModules([ClientSideRowModelModule, RowStyleModule, CellStyleModule]);

interface Props {
  storeId: string;
}

type ViewMode = 'number' | 'model' | 'tail'; // 台番別 / 機種別（平均）/ 末尾別
type DisplayMetric = 'diff' | 'games'; // 差枚 / 回転数

type TodayOatariHistoryRow = {
  count?: string;
  kind?: string;
  time?: string;
  game?: string;
  payout?: string;
  isArtOrRt?: boolean;
};

type TodaySnapshotItem = {
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

type GridUiStateSnapshot = {
  columnState?: any[];
  scrollTop?: number;
  scrollLeft?: number;
};

const formatLineSpacingThumbIcon = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 6h12M7 12h12M7 18h12M3 4v16M3 8l-2-2 2-2M3 16l-2 2 2 2'/></svg>"
);

const Android12LineSpacingSwitch = styled(Switch)(() => ({
  width: 56,
  height: 32,
  padding: 0,
  '& .MuiSwitch-switchBase': {
    margin: 4,
    padding: 0,
    transform: 'translateX(0px)',
    '&.Mui-checked': {
      transform: 'translateX(24px)',
      color: '#fff',
      '& .MuiSwitch-thumb': {
        backgroundColor: '#2e7d32',
      },
      '& + .MuiSwitch-track': {
        backgroundColor: '#81c784',
        opacity: 1,
      },
    },
    '&.Mui-disabled + .MuiSwitch-track': {
      opacity: 0.45,
    },
  },
  '& .MuiSwitch-thumb': {
    width: 24,
    height: 24,
    boxSizing: 'border-box',
    boxShadow: 'none',
    backgroundColor: '#9e9e9e',
    position: 'relative',
    '&::before': {
      content: '""',
      display: 'block',
      position: 'absolute',
      inset: 0,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      backgroundSize: '16px 16px',
      backgroundImage: `url("data:image/svg+xml;utf8,${formatLineSpacingThumbIcon}")`,
    },
  },
  '& .MuiSwitch-track': {
    borderRadius: 16,
    backgroundColor: '#c5c5c5',
    opacity: 1,
  },
}));

export const SlotDiffGrid: React.FC<Props> = ({ storeId }) => {
  const [columnDefs, setColumnDefs] = useState<ColDef[]>([]);
  const [rowData, setRowData] = useState<any[]>([]);
  const gridRef = useRef<AgGridReact<any>>(null);

  // ★ 台番別の“元データ”を保持（タブ戻し時に復元するため）
  const numberColDefsRef = useRef<ColDef[]>([]);
  const numberRowDataRef = useRef<any[]>([]);

  // 表示中データの鏡
  const rowDataMirrorRef = useRef<any[]>([]);

  const [loadedDates, setLoadedDates] = useState<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const scrollReady = useRef(false);
  const didInitRef = useRef(false);

  const [viewMode, setViewMode] = useState<ViewMode>('number');
  const viewModeRef = useRef<ViewMode>('number');
  const [displayMetric, setDisplayMetric] = useState<DisplayMetric>('diff');
  const displayMetricRef = useRef<DisplayMetric>('diff');
  const [showGroupedWinStats, setShowGroupedWinStats] = useState(false);
  const showGroupedWinStatsRef = useRef(false);
  const [gridRemountNonce, setGridRemountNonce] = useState(0);
  const [disableVirtualization, setDisableVirtualization] = useState(false);
  const virtualizationPendingRef = useRef(false);

  // モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ rowData: any; field: string; value: any } | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<number | null>(null);
  const [selectedComment, setSelectedComment] = useState('');
  const [selectedCellUrl, setselectedCellUrl] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | number | null>(null);
  const [todayDetailModalOpen, setTodayDetailModalOpen] = useState(false);
  const [todayDetailItem, setTodayDetailItem] = useState<TodaySnapshotItem | null>(null);
  const [todayDetailMachineKey, setTodayDetailMachineKey] = useState<string | null>(null);
  const [todayDetailFromGallery, setTodayDetailFromGallery] = useState(false);
  const [todayGalleryModalOpen, setTodayGalleryModalOpen] = useState(false);
  const [todayGalleryTitle, setTodayGalleryTitle] = useState('');
  const [todayGalleryItems, setTodayGalleryItems] = useState<
    Array<{ machineKey: string; snapshot: TodaySnapshotItem }>
  >([]);
  const [todayDetailAnimName, setTodayDetailAnimName] = useState<'none' | 'slideLeft' | 'slideRight'>('none');
  const [todayDetailAnimTick, setTodayDetailAnimTick] = useState(0);
  const [todaySwipeHintDx, setTodaySwipeHintDx] = useState(0);
  const [todayOatariHistoryRows, setTodayOatariHistoryRows] = useState<TodayOatariHistoryRow[]>([]);
  const [todayOatariHistoryLoading, setTodayOatariHistoryLoading] = useState(false);
  const [todayOatariHistoryCount, setTodayOatariHistoryCount] = useState<number | null>(null);
  const todayOatariHistoryReqRef = useRef(0);
  const todayMachineOrderRef = useRef<string[]>([]);


  // 機種名フィルタ
  const [selectedName, setSelectedName] = useState<string>("");

  // 読み込み済みの「生データ（date => map）」を保持（機種別集計に使用）
  const rawMapRef = useRef<Record<string, any>>({});
  const tooltipColorMapRef = useRef<Record<string, string>>({});
  const tooltipTextMapRef = useRef<Record<string, string>>({});
  const nameCombineMapRef = useRef<Record<string, string>>({});
  const todaySnapshotMapRef = useRef<Record<string, TodaySnapshotItem>>({});
  const [todayDiffMap, setTodayDiffMap] = useState<Record<string, number>>({});
  const [todaySnapshotDateKey, setTodaySnapshotDateKey] = useState('');
  const todaySnapshotDocIdRef = useRef('');
  const [todayColumnHeader, setTodayColumnHeader] = useState('本日');
  const [hasTodayDiffData, setHasTodayDiffData] = useState(false);
  const [nameMapReady, setNameMapReady] = useState(false);
  const lastHorizontalScrollLeftRef = useRef(0);
  const gridUiStateByKeyRef = useRef<Record<string, GridUiStateSnapshot>>({});
  const pendingGridUiRestoreRef = useRef<GridUiStateSnapshot | null>(null);

  const rowDataRef = useRef<any[]>([]);  // ★ 追加
  const pendingScrollRestoreRef = useRef<number | null>(null);

  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [machineUrl, setMachineUrl] = useState<string | null>(null);
  const [machineTooltip, setMachineTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const machineTooltipRef = useRef<HTMLDivElement | null>(null);

  const resolveDisplayName = useCallback((name: string) => {
    const raw = String(name ?? '').trim();
    if (!raw) return '';
    return nameCombineMapRef.current[raw] ?? raw;
  }, []);

  const normalizeMachineName = useCallback((item: any) => {
    if (!item || typeof item !== 'object') return item;
    const normalizedName = resolveDisplayName(String(item?.name ?? ''));
    if (!normalizedName || normalizedName === item?.name) return item;
    return { ...item, name: normalizedName };
  }, [resolveDisplayName]);

  const normalizeDateDataNames = useCallback((dateData: any) => {
    if (!dateData || typeof dateData !== 'object') return dateData;
    if (Array.isArray(dateData)) {
      return dateData.map((item) => normalizeMachineName(item));
    }
    const next: Record<string, any> = {};
    Object.entries(dateData).forEach(([key, item]) => {
      next[key] = normalizeMachineName(item);
    });
    return next;
  }, [normalizeMachineName]);

  const toNumericValue = useCallback((value: unknown): number | '-' => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const normalized = value.replace(/,/g, '').trim();
      if (!normalized || normalized === '-') return '-';
      const match = normalized.match(/-?\d+/);
      if (!match) return '-';
      const n = Number(match[0]);
      return Number.isFinite(n) ? n : '-';
    }
    return '-';
  }, []);

  const buildDisplayDataMap = useCallback((source: Record<string, any>, metric: DisplayMetric) => {
    if (metric === 'diff') return source ?? {};
    const out: Record<string, any> = {};
    Object.entries(source ?? {}).forEach(([dateKey, dateData]) => {
      if (Array.isArray(dateData)) {
        out[dateKey] = dateData.map((item: any) => {
          if (!item || typeof item !== 'object') return item;
          return { ...item, diff: toNumericValue(item?.games) };
        });
        return;
      }
      if (dateData && typeof dateData === 'object') {
        const mapped: Record<string, any> = {};
        Object.entries(dateData).forEach(([key, item]) => {
          if (!item || typeof item !== 'object') {
            mapped[key] = item;
            return;
          }
          mapped[key] = { ...item, diff: toNumericValue((item as any)?.games) };
        });
        out[dateKey] = mapped;
        return;
      }
      out[dateKey] = dateData;
    });
    return out;
  }, [toNumericValue]);

  const pickTodayMetricValue = useCallback((item: TodaySnapshotItem | undefined, metric: DisplayMetric): number | null => {
    if (!item) return null;
    const rawValue = metric === 'games' ? item.totalGameCount : item.currentDifference;
    const parsed = toNumericValue(rawValue);
    return typeof parsed === 'number' ? parsed : null;
  }, [toNumericValue]);

  const buildTodayMetricMapFromSnapshot = useCallback((
    snapshotMap: Record<string, TodaySnapshotItem>,
    metric: DisplayMetric
  ): Record<string, number> => {
    const nextMap: Record<string, number> = {};
    Object.entries(snapshotMap ?? {}).forEach(([machineKey, item]) => {
      const key = String(item?.machineNumber ?? machineKey);
      const value = pickTodayMetricValue(item, metric);
      if (value !== null) {
        nextMap[key] = value;
      }
    });
    return nextMap;
  }, [pickTodayMetricValue]);

  const applyNumberTotalLabelByMetric = useCallback((rows: any[]) => {
    if (displayMetric !== 'games') return rows;
    return rows.map((row) => (
      row?.isTotalRow
        ? { ...row, name: '総回転数' }
        : row
    ));
  }, [displayMetric]);

  const applyGroupedTotalLabelByMetric = useCallback((rows: any[]) => {
    if (displayMetric !== 'games') return rows;
    return rows.map((row) => (
      row?.isTotalRow
        ? { ...row, name: '平均回転数' }
        : row
    ));
  }, [displayMetric]);

  const scheduleRestoreVerticalScroll = useCallback((top: number) => {
    if (!top) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const api = gridRef.current?.api as any;
        if (api?.setVerticalScrollPosition) {
          api.setVerticalScrollPosition(top);
          return;
        }
        const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement;
        if (gridBody) gridBody.scrollTop = top;
      });
    });
  }, []);

  const getCurrentVerticalScrollTop = useCallback(() => {
    const api = gridRef.current?.api as any;
    return (
      api?.getVerticalPixelRange?.()?.top ??
      (document.querySelector('.ag-body-viewport') as HTMLElement | null)?.scrollTop ??
      0
    );
  }, []);

  const getCurrentHorizontalScrollLeft = useCallback(() => {
    return (
      (document.querySelector('.ag-body-horizontal-scroll-viewport') as HTMLElement | null)?.scrollLeft ??
      0
    );
  }, []);

  const buildGridUiStateKey = useCallback((mode: ViewMode, metric: DisplayMetric) => {
    return `${mode}:${metric}`;
  }, []);

  const captureGridUiState = useCallback((mode: ViewMode, metric: DisplayMetric): GridUiStateSnapshot => {
    const api = gridRef.current?.api as any;
    const snapshot: GridUiStateSnapshot = {
      columnState: typeof api?.getColumnState === 'function' ? api.getColumnState() : undefined,
      scrollTop: getCurrentVerticalScrollTop(),
      scrollLeft: getCurrentHorizontalScrollLeft(),
    };
    gridUiStateByKeyRef.current[buildGridUiStateKey(mode, metric)] = snapshot;
    return snapshot;
  }, [buildGridUiStateKey, getCurrentHorizontalScrollLeft, getCurrentVerticalScrollTop]);

  const queueGridUiRestore = useCallback((
    mode: ViewMode,
    metric: DisplayMetric,
    fallback?: GridUiStateSnapshot
  ) => {
    const key = buildGridUiStateKey(mode, metric);
    pendingGridUiRestoreRef.current = gridUiStateByKeyRef.current[key] ?? fallback ?? null;
  }, [buildGridUiStateKey]);

  const applyPendingGridUiRestore = useCallback(() => {
    const pending = pendingGridUiRestoreRef.current;
    if (!pending) return false;
    pendingGridUiRestoreRef.current = null;

    const api = gridRef.current?.api as any;
    if (!api) {
      pendingGridUiRestoreRef.current = pending;
      return false;
    }

    const hasColumns = (() => {
      const cols = api?.getColumns?.();
      return Array.isArray(cols) ? cols.length > 0 : true;
    })();
    if (Array.isArray(pending.columnState) && pending.columnState.length > 0 && !hasColumns) {
      pendingGridUiRestoreRef.current = pending;
      return false;
    }

    if (Array.isArray(pending.columnState) && pending.columnState.length > 0 && typeof api.applyColumnState === 'function') {
      api.applyColumnState({
        state: pending.columnState,
        applyOrder: true,
      });
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (typeof pending.scrollTop === 'number') {
          if (typeof api.setVerticalScrollPosition === 'function') {
            api.setVerticalScrollPosition(pending.scrollTop);
          } else {
            const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement | null;
            if (gridBody) gridBody.scrollTop = pending.scrollTop;
          }
        }

        if (typeof pending.scrollLeft === 'number') {
          const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport') as HTMLElement | null;
          if (horizontal) {
            horizontal.scrollLeft = pending.scrollLeft;
          }
          lastHorizontalScrollLeftRef.current = pending.scrollLeft;
        }
      });
    });
    return true;
  }, []);

  useEffect(() => {
    applyPendingGridUiRestore();
  }, [rowData, columnDefs, viewMode, displayMetric, showGroupedWinStats, applyPendingGridUiRestore]);

  useEffect(() => {
    if (!nameMapReady) return;
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadInitialData();
  }, [nameMapReady]);

  useEffect(() => {
    rowDataMirrorRef.current = rowData;
  }, [rowData]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    displayMetricRef.current = displayMetric;
  }, [displayMetric]);

  useEffect(() => {
    showGroupedWinStatsRef.current = showGroupedWinStats;
  }, [showGroupedWinStats]);

  useEffect(() => {
    if (!machineTooltip) return;
    const handleClick = (event: MouseEvent) => {
      if (machineTooltipRef.current && machineTooltipRef.current.contains(event.target as Node)) {
        return;
      }
      setMachineTooltip(null);
    };
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [machineTooltip]);

  useEffect(() => {
    let cancelled = false;
    const loadTooltips = async () => {
      try {
        const q = query(
          collection(db, 'tooltips'),
          where('storeId', '==', storeId)
        );
        const snapshot = await getDocs(q);
        const map: Record<string, string> = {};
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
              map[String(machineNumber)] = color;
            }
            if (machineNumber != null && typeof text === 'string' && text.trim() !== '') {
              textMap[String(machineNumber)] = text;
            }
          });
        });

        if (cancelled) return;
        tooltipColorMapRef.current = map;
        tooltipTextMapRef.current = textMap;
        gridRef.current?.api?.refreshCells({ force: true });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load tooltips:', error);
      }
    };

    loadTooltips();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    const loadNameCombineMap = async () => {
      try {
        const snap = await getDoc(doc(db, 'config', 'namecCmbine'));
        if (!snap.exists()) return;
        const payload = snap.data() as any;
        const source =
          payload?.map && typeof payload.map === 'object' && !Array.isArray(payload.map)
            ? payload.map
            : {};

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

        if (cancelled) return;
        nameCombineMapRef.current = next;
        gridRef.current?.api?.refreshCells({ force: true });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load config/namecCmbine.map:', error);
      } finally {
        if (!cancelled) setNameMapReady(true);
      }
    };

    void loadNameCombineMap();
    return () => {
      cancelled = true;
    };
  }, [resolveDisplayName]);

  useEffect(() => {
    let cancelled = false;
    const loadTodaySnapshot = async () => {
      try {
        const nowJst = dayjs().tz('Asia/Tokyo');
        const todayKey = nowJst.hour() < 8
          ? nowJst.subtract(1, 'day').format('YYYYMMDD')
          : nowJst.format('YYYYMMDD');
        const currentKey = nowJst.format('YYYYMMDD');
        const nextHeader = todayKey === currentKey ? '本日' : '前日';
        if (!cancelled) setTodaySnapshotDateKey(todayKey);
        if (!cancelled) setTodayColumnHeader(nextHeader);
        const snapshotId = `${storeId}_${todayKey}`;
        todaySnapshotDocIdRef.current = snapshotId;
        const snap = await getDoc(doc(db, 'site777Snapshots', snapshotId));
        if (!snap.exists()) {
          if (!cancelled) {
            setTodayDiffMap({});
            setHasTodayDiffData(false);
            todaySnapshotMapRef.current = {};
            todaySnapshotDocIdRef.current = '';
          }
          return;
        }

        const payload = snap.data() as { data?: Record<string, any>; oatariHistoryStorage?: string };
        const entries = payload?.data ?? {};
        const rootOatariHistoryStorage =
          typeof payload?.oatariHistoryStorage === 'string' ? payload.oatariHistoryStorage : undefined;
        const detailMap: Record<string, TodaySnapshotItem> = {};

        Object.entries(entries).forEach(([key, item]) => {
          const machineKey = String(item?.machineNumber ?? key);
          const perMachineStorage =
            typeof item?.oatariHistoryStorage === 'string' ? item.oatariHistoryStorage : undefined;
          detailMap[machineKey] = {
            ...(item as TodaySnapshotItem),
            oatariHistoryStorage: perMachineStorage ?? rootOatariHistoryStorage,
          };
        });

        if (!cancelled) {
          const nextMap = buildTodayMetricMapFromSnapshot(detailMap, displayMetricRef.current);
          setTodayDiffMap(nextMap);
          setHasTodayDiffData(Object.keys(nextMap).length > 0);
          todaySnapshotMapRef.current = detailMap;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load site777Snapshots:', error);
        if (!cancelled) {
          setTodayDiffMap({});
          setHasTodayDiffData(false);
          todaySnapshotMapRef.current = {};
          setTodaySnapshotDateKey('');
          todaySnapshotDocIdRef.current = '';
          setTodayColumnHeader('本日');
        }
      }
    };

    loadTodaySnapshot();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    const nextMap = buildTodayMetricMapFromSnapshot(todaySnapshotMapRef.current, displayMetric);
    setTodayDiffMap(nextMap);
    setHasTodayDiffData(Object.keys(nextMap).length > 0);
  }, [displayMetric, buildTodayMetricMapFromSnapshot]);

  useEffect(() => {
    if (numberRowDataRef.current.length === 0) return;
    numberRowDataRef.current = applyTodayDiffToRows(
      numberRowDataRef.current,
      todayDiffMap,
      todaySnapshotDateKey
    );
    if (viewMode === 'number') {
      setRowData(numberRowDataRef.current);
      return;
    }
    if (viewMode === 'model') {
      buildAndSetGrouped();
      return;
    }
    if (viewMode === 'tail') {
      buildAndSetTail();
    }
  }, [todayDiffMap, todaySnapshotDateKey, viewMode]);

  useEffect(() => {
    const updateTodayColumnMetadata = (cols: ColDef[]) =>
      (cols ?? []).map((col) => (
        col?.field === 'todayDiff'
          ? { ...col, hide: !hasTodayDiffData, headerName: todayColumnHeader }
          : col
      ));

    numberColDefsRef.current = updateTodayColumnMetadata(numberColDefsRef.current);
    setColumnDefs((prev) => updateTodayColumnMetadata(prev));
  }, [hasTodayDiffData, todayColumnHeader]);

  useEffect(() => {
    if (modalOpen && selectedCell) {
      const originalFlag = selectedCell?.rowData?.flag?.[selectedCell.field] ?? 0;
      setSelectedFlag(originalFlag);

      const originalUrl = selectedCell?.rowData?.urls?.[selectedCell.field] ?? "";
      setselectedCellUrl(originalUrl);

      let initialComment = selectedCell?.rowData?.comments?.[selectedCell.field] ?? '';
      if (viewMode === 'model') {
        const dateField = selectedCell.field;
        const targetCanonicalName = resolveDisplayName(
          String(selectedCell?.rowData?.name ?? selectedCell?.rowData?.modelName ?? '')
        );
        const merged = Array.from(
          new Set(
            (numberRowDataRef.current ?? [])
              .filter((row: any) => !row?.isTotalRow)
              .filter(
                (row: any) =>
                  resolveDisplayName(String(row?.name ?? row?.modelName ?? '')) === targetCanonicalName
              )
              .map((row: any) => {
                const v = row?.comments?.[dateField];
                return typeof v === 'string' ? v.trim() : String(v ?? '').trim();
              })
              .filter((v: string) => !!v)
          )
        );
        if (merged.length > 0) {
          initialComment = merged.join('\n');
        }
      }
      setSelectedComment(typeof initialComment === 'string' ? initialComment : String(initialComment ?? ''));

    }
  }, [modalOpen, selectedCell, viewMode, resolveDisplayName]);

  useEffect(() => {
    rowDataRef.current = rowData;        // ★ 常に最新の rowData を保持
  }, [rowData]);

  useEffect(() => {
    if (pendingScrollRestoreRef.current == null) return;
    const top = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;
    scheduleRestoreVerticalScroll(top);
  }, [rowData, columnDefs, scheduleRestoreVerticalScroll]);

  // フィルタ後データ
  const filteredRowData = useMemo(() => {
    if (viewMode === 'tail') return rowData;
    if (!selectedName) return rowData;
    return rowData.filter((r) => (r.name ?? r.modelName) === selectedName);
  }, [selectedName, rowData, viewMode]);

  useEffect(() => {
    if (viewMode !== 'number') {
      todayMachineOrderRef.current = [];
      return;
    }
    todayMachineOrderRef.current = (filteredRowData ?? [])
      .filter((r: any) => !r?.isTotalRow && r?.machineNumber != null)
      .map((r: any) => String(r.machineNumber));
  }, [filteredRowData, viewMode]);

  const loadInitialData = async () => {
    const nowJST = dayjs().tz('Asia/Tokyo');
    const hour = nowJST.hour();
    // const minute = nowJST.minute();
    const isBefore = hour < 8;
    const offset = isBefore ? 2 : 1;

    const initialDates = getPastDates(30, offset);
    await loadDates(initialDates);
    scrollReady.current = true;
  };

  const loadMoreDates = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const alreadyLoaded = loadedDates.size;
    const nextDates = getPastDates(30, alreadyLoaded);
    await loadDates(nextDates);

    loadingRef.current = false;
  };

  const showModal = useCallback((value: any, row: any, field: string) => {
    if (field === 'todayDiff') {
      if (viewModeRef.current === 'model') {
        if (!row || row?.isTotalRow) return;
        const machineNumbers = Array.isArray(row?.machineNumbers)
          ? row.machineNumbers.map((v: any) => String(v).trim()).filter((v: string) => !!v)
          : [];
        const candidates: Array<{ machineKey: string; snapshot?: TodaySnapshotItem }> = machineNumbers
          .map((machineKey: string) => ({ machineKey, snapshot: todaySnapshotMapRef.current[machineKey] }));
        const items = candidates
          .filter((entry) => !!entry.snapshot?.graphImageUrl)
          .sort((a, b) => {
            const ai = Number(a.machineKey);
            const bi = Number(b.machineKey);
            if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
            return a.machineKey.localeCompare(b.machineKey, 'ja');
          })
          .map((entry) => ({ machineKey: entry.machineKey, snapshot: entry.snapshot as TodaySnapshotItem }));
        const modelName = String(row?.name ?? row?.modelName ?? '').trim();
        setTodayGalleryTitle(modelName || '機種別');
        setTodayGalleryItems(items);
        setTodayGalleryModalOpen(true);
        return;
      }
      const machineKey = String(row?.machineNumber ?? '');
      const snapshot = todaySnapshotMapRef.current[machineKey];
      if (!snapshot) return;
      setTodayDetailFromGallery(false);
      setTodayDetailAnimName('none');
      setTodayDetailAnimTick((v) => v + 1);
      setTodayDetailMachineKey(machineKey);
      setTodayDetailItem(snapshot);
      setTodayDetailModalOpen(true);
      void loadTodayOatariHistory(machineKey, snapshot);
      return;
    }
    setSelectedCell({ value, rowData: row, field });
    setSelectedFlag(null);
    setselectedCellUrl(null);
    setModalOpen(true);
  }, []);

  const getTooltipColor = useCallback((machineNumber: number | string | null | undefined) => {
    if (machineNumber == null) return undefined;
    return tooltipColorMapRef.current[String(machineNumber)];
  }, []);

  const getTooltipText = useCallback((machineNumber: number | string | null | undefined) => {
    if (machineNumber == null) return undefined;
    return tooltipTextMapRef.current[String(machineNumber)];
  }, []);

  const buildTodayGraphUrl = useCallback((item: TodaySnapshotItem | null | undefined) => {
    const rawUrl = item?.graphImageUrl;
    if (!rawUrl) return '';
    const version = item?.scrapedAt || item?.dataUpdatedAt || todaySnapshotDateKey || '';
    if (!version) return rawUrl;
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}v=${encodeURIComponent(version)}`;
  }, [todaySnapshotDateKey]);

  const parseTodayOatariHistory = useCallback((raw: any): TodayOatariHistoryRow[] => {
    if (Array.isArray(raw)) {
      return raw as TodayOatariHistoryRow[];
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as TodayOatariHistoryRow[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  }, []);

  const loadTodayOatariHistory = useCallback(async (machineKey: string, snapshot: TodaySnapshotItem) => {
    const reqId = ++todayOatariHistoryReqRef.current;
    setTodayOatariHistoryLoading(true);
    setTodayOatariHistoryRows([]);
    setTodayOatariHistoryCount(null);

    try {
      const useSubcollection = snapshot?.oatariHistoryStorage === 'subcollection';
      const isStorageUnset =
        snapshot?.oatariHistoryStorage === undefined || snapshot?.oatariHistoryStorage === null;
      const snapshotDocId = todaySnapshotDocIdRef.current;
      const trySubcollectionFirst = !!snapshotDocId && (useSubcollection || isStorageUnset);
      if (trySubcollectionFirst) {
        const ref = doc(db, 'site777Snapshots', snapshotDocId, 'oatariHistories', machineKey);
        const histSnap = await getDoc(ref);
        if (reqId !== todayOatariHistoryReqRef.current) return;

        if (!histSnap.exists()) {
          // subcollection 未作成時は旧形式にフォールバック
        } else {
          const data = histSnap.data() as {
            oatariHistoryJson?: unknown;
            oatariHistoryCount?: number | string;
          };
          const rows = parseTodayOatariHistory(data?.oatariHistoryJson);
          const countRaw = data?.oatariHistoryCount;
          const count = typeof countRaw === 'number' ? countRaw : Number(countRaw);
          setTodayOatariHistoryRows(rows);
          setTodayOatariHistoryCount(Number.isFinite(count) ? count : rows.length);
          return;
        }
      }

      const fallbackRows = parseTodayOatariHistory(snapshot?.oatariHistory);
      if (reqId !== todayOatariHistoryReqRef.current) return;
      setTodayOatariHistoryRows(fallbackRows);
      setTodayOatariHistoryCount(fallbackRows.length);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load oatariHistories subcollection:', error);
      if (reqId !== todayOatariHistoryReqRef.current) return;
      setTodayOatariHistoryRows([]);
      setTodayOatariHistoryCount(0);
    } finally {
      if (reqId === todayOatariHistoryReqRef.current) {
        setTodayOatariHistoryLoading(false);
      }
    }
  }, [parseTodayOatariHistory]);

  const openTodayDetailByMachineKey = useCallback(async (
    machineKey: string,
    direction: -1 | 0 | 1 = 0
  ) => {
    const snapshot = todaySnapshotMapRef.current[machineKey];
    if (!snapshot) return;
    setTodayDetailAnimName(direction > 0 ? 'slideLeft' : direction < 0 ? 'slideRight' : 'none');
    setTodayDetailAnimTick((v) => v + 1);
    setTodayDetailMachineKey(machineKey);
    setTodayDetailItem(snapshot);
    setTodayDetailModalOpen(true);
    void loadTodayOatariHistory(machineKey, snapshot);
  }, [loadTodayOatariHistory]);

  const moveTodayDetailMachine = useCallback((delta: number) => {
    const machineKey = todayDetailMachineKey;
    if (!machineKey) return;
    const order = todayMachineOrderRef.current;
    if (!Array.isArray(order) || order.length === 0) return;
    const currentIndex = order.indexOf(machineKey);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    const nextKey = order[nextIndex];
    if (!nextKey) return;
    void openTodayDetailByMachineKey(nextKey, delta > 0 ? 1 : -1);
  }, [todayDetailMachineKey, openTodayDetailByMachineKey]);

  const openTodayDetailFromGallery = useCallback((machineKey: string) => {
    const galleryOrder = todayGalleryItems
      .map((item) => String(item.machineKey ?? '').trim())
      .filter((key) => !!key);
    if (galleryOrder.length > 0) {
      todayMachineOrderRef.current = galleryOrder;
    }
    setTodayDetailFromGallery(true);
    setTodayGalleryModalOpen(false);
    requestAnimationFrame(() => {
      void openTodayDetailByMachineKey(machineKey, 0);
    });
  }, [openTodayDetailByMachineKey, todayGalleryItems]);

  const todaySwipeHandlers = useSwipeable({
    delta: 48,
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: false,
    onSwipeStart: () => {
      setTodaySwipeHintDx(0);
    },
    onSwiping: (eventData) => {
      if (eventData.absX <= eventData.absY) return;
      setTodaySwipeHintDx(Math.max(-120, Math.min(120, eventData.deltaX)));
    },
    onSwipedLeft: () => {
      setTodaySwipeHintDx(0);
      moveTodayDetailMachine(1);
    },
    onSwipedRight: () => {
      setTodaySwipeHintDx(0);
      moveTodayDetailMachine(-1);
    },
    onSwiped: () => {
      setTodaySwipeHintDx(0);
    },
  });

  const showMachineTooltip = useCallback((params: any) => {
    if (params?.colDef?.field !== 'machineNumber') {
      setMachineTooltip(null);
      return;
    }
    const text = getTooltipText(params?.data?.machineNumber);
    const rowKey = params?.data?.id ?? params?.data?.machineNumber ?? null;
    setSelectedRowId(rowKey);
    if (!text) {
      setMachineTooltip(null);
      return;
    }
    let x = 20;
    let y = 20;
    const evt: any = params?.event;
    if (evt?.clientX != null && evt?.clientY != null) {
      x = evt.clientX;
      y = evt.clientY;
    } else if (evt?.target?.getBoundingClientRect) {
      const rect = evt.target.getBoundingClientRect();
      x = rect.right;
      y = rect.top;
    }
    if (evt?.target?.getBoundingClientRect) {
      const rect = evt.target.getBoundingClientRect();
      x = rect.right;
      y = rect.top;
    }
    setMachineTooltip({ text, x, y });
  }, [getTooltipText]);

// 置き換え：loadDates 全体の中の該当部分
// 置き換え：loadDates 内の該当箇所
const loadDates = async (dates: string[]) => {
  const api = gridRef.current?.api as any;
  const prevScrollTop =
    api?.getVerticalPixelRange?.()?.top ??
    (document.querySelector('.ag-body-viewport') as HTMLElement | null)?.scrollTop ??
    0;
  const fetchedRaw = await fetchSlotDiffs(storeId, dates);
  const raw: Record<string, any> = {};
  Object.entries(fetchedRaw ?? {}).forEach(([dateKey, dateData]) => {
    raw[dateKey] = normalizeDateDataNames(dateData);
  });

  // 生データを累積（機種別で使う）
  Object.entries(raw).forEach(([k, v]) => {
    rawMapRef.current[k] = v;
  });

  const displayRaw = buildDisplayDataMap(raw, displayMetric);

  // 台番別（最新日付の配列を基軸に transform）
  const latestKey = dates[dates.length - 1];
  const latest = displayRaw[latestKey] || Object.values(displayRaw)[0] || [];

  let numberRows = transformToGridData(latest, displayRaw);
  numberRows = applyNumberTotalLabelByMetric(numberRows);

  // ★ 読み込み済み + 追加日付から「実効的な最新日付」を決定
  const allLoaded = new Set<string>([...Array.from(loadedDates), ...dates]);
  const allLoadedArr = [...allLoaded];
  const allDisplayData = buildDisplayDataMap(rawMapRef.current, displayMetric);
  const effectiveLatestDate = pickEffectiveLatestDate(allDisplayData, allLoadedArr);

  // 台番別の“元データ”を更新（next の順序を尊重）
  numberRowDataRef.current = mergeRowData(numberRowDataRef.current, numberRows);
  numberRowDataRef.current = applyTodayDiffToRows(
    numberRowDataRef.current,
    todayDiffMap,
    todaySnapshotDateKey
  );

  // ★ 実効的な最新日付が見つかった場合のみ「欠損を下へ」並べ替え
  if (effectiveLatestDate) {
    numberRowDataRef.current = sortByLatestMissing(numberRowDataRef.current, effectiveLatestDate);
  } else {
    // 見つからない＝全日付でデータなし → 単純に台番昇順など
    numberRowDataRef.current = sortByMachineNumber(numberRowDataRef.current);
  }

  // 列を生成：実効的な最新日付を渡す（固定列のグレー化にも使う）
  const newCols = buildNumberColumns(
    dates,
    numberColDefsRef.current,
    showModal,
    effectiveLatestDate || '',
    todayColumnHeader,
    hasTodayDiffData,
    resolveDisplayName,
    getTooltipColor,
    getTooltipText
  );

  numberColDefsRef.current = [...numberColDefsRef.current, ...newCols];
  setLoadedDates(prev => new Set([...Array.from(prev), ...dates]));

  if (viewMode === 'number') {
    setRowData(numberRowDataRef.current);
    setColumnDefs(numberColDefsRef.current);
  } else if (viewMode === 'model') {
    buildAndSetGrouped(allLoadedArr, allDisplayData);
  } else {
    buildAndSetTail(allLoadedArr, allDisplayData);
  }

  pendingScrollRestoreRef.current = prevScrollTop;
};



  const onBodyScroll = async (event: any) => {
    if (!scrollReady.current) return;
    if (event.direction !== 'horizontal') return;
    setMachineTooltip(null);

    const container = document.querySelector('.ag-body-horizontal-scroll-viewport');
    if (!container) return;

    const scrollLeft = container.scrollLeft;
    const clientWidth = container.clientWidth;
    const scrollWidth = container.scrollWidth;
    const hasHorizontalOverflow = scrollWidth > clientWidth + 1;
    const movingRight = scrollLeft > lastHorizontalScrollLeftRef.current;
    lastHorizontalScrollLeftRef.current = scrollLeft;

    // Ignore synthetic/layout-driven horizontal events.
    if (!hasHorizontalOverflow) return;
    if (!movingRight) return;

    if (scrollLeft + clientWidth >= scrollWidth - 10) {
      await loadMoreDates();
    }
  };

  const CustomCellRenderer = (props: any) => {
    const lastTap = useRef<number | null>(null);

    const handleClick = () => {
      const now = Date.now();
      if (lastTap.current && now - lastTap.current < 300) {
        props.showModal(props.value, props.node.data, props.colDef.field!);
      }
      lastTap.current = now;
    };

    const v = props.valueFormatted ?? props.value;
    return (
      <div onClick={handleClick} style={{ width: '100%', height: '100%' }}>
        {v === null || v === undefined || v === '-' ? '-' : v.toLocaleString?.() ?? v}
      </div>
    );
  };

  const GroupedCellRenderer = (props: any) => {
    const lastTap = useRef<number | null>(null);

    const handleClick = () => {
      const now = Date.now();
      if (lastTap.current && now - lastTap.current < 300) {
        props.showModal(props.value, props.node.data, props.colDef.field!);
      }
      lastTap.current = now;
    };

    const v = props.value;
    const parsed = parseGroupedMetricCell(v);
    const field = props.colDef.field as string;
    const flag = props.node?.data?.flag?.[field];
    const showDetailLines = (
      viewModeRef.current === 'model' &&
      displayMetricRef.current === 'diff' &&
      showGroupedWinStatsRef.current
    );

    return (
      <div
        onClick={handleClick}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        {flag === 6 ? (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 0,
              height: 0,
              borderTop: '10px solid #5bd799',
              borderLeft: '10px solid transparent',
            }}
          />
        ) : null}
        {parsed && showDetailLines ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
            <span>{parsed.avg}</span>
            <span style={{ fontSize: '0.7em' }}>{(parsed.winRate * 100).toFixed(1)}%</span>
            <span style={{ fontSize: '0.65em' }}>{parsed.ratio}</span>
          </div>
        ) : (parsed ? parsed.avg.toLocaleString() : (v === null || v === undefined || v === '-' ? '-' : v.toLocaleString?.() ?? v))}
      </div>
    );
  };

  const GroupedNameCellRenderer = (props: any) => {
    const v = props.valueFormatted ?? props.value;
    const useTightLineHeight = (
      viewModeRef.current === 'model' &&
      displayMetricRef.current === 'diff' &&
      showGroupedWinStatsRef.current
    );
    return (
      <div
        style={{
          width: '100%',
          whiteSpace: 'normal',
          lineHeight: useTightLineHeight ? 1.1 : undefined,
        }}
      >
        {v}
      </div>
    );
  };

  const handleSelectChange = (e: SelectChangeEvent) => {
    const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement;
    if (gridBody) gridBody.scrollTop = 0;
    setSelectedName(e.target.value);
    virtualizationPendingRef.current = true;
    setDisableVirtualization(true);
    // Prevent mobile browser zoom/focus jump from hiding the top tabs.
    requestAnimationFrame(() => {
      const target = e.target as HTMLInputElement | null;
      target?.blur?.();
      const active = document.activeElement as HTMLElement | null;
      active?.blur?.();
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  };

  const handleToggleDisplayMetric = () => {
    const currentMode = viewModeRef.current;
    const prevMetric = displayMetricRef.current;
    const currentSnapshot = captureGridUiState(currentMode, prevMetric);
    const nextMetric: DisplayMetric = prevMetric === 'diff' ? 'games' : 'diff';

    queueGridUiRestore(currentMode, nextMetric, currentSnapshot);
    displayMetricRef.current = nextMetric;
    if (nextMetric === 'games') {
      showGroupedWinStatsRef.current = false;
      setShowGroupedWinStats(false);
    }
    setDisplayMetric(nextMetric);
  };

  // ========= 機種別（平均） =========
  const buildAndSetGrouped = (loadedDatesOverride?: string[], allDataOverride?: Record<string, any>) => {
    const allData = allDataOverride ?? buildDisplayDataMap(rawMapRef.current, displayMetric);

    // 読み込み済み日付（降順：最新→古い）
    const loaded = (loadedDatesOverride ?? Array.from(loadedDates)).sort((a, b) => b.localeCompare(a));

    // latest は読み込み済みの最新日付のデータ
    const latestKey = loaded[0];
    const latest = (latestKey && allData[latestKey]) ? allData[latestKey] : Object.values(allData)[0] ?? {};

    // あなたの transform に合わせる（機種名＋各日付の平均差枚、台番は空欄）
    const effectiveLatestDate = pickEffectiveLatestDate(allData, loaded);
    let groupedRows = transformToGroupedGridData(latest, allData);
    groupedRows = applyGroupedTotalLabelByMetric(groupedRows);
    if (displayMetric === 'diff') {
      groupedRows = applyGroupedDateMetricCells(groupedRows, allData);
    }
    const groupedWithToday = applyTodayDiffToGroupedRows(
      groupedRows,
      numberRowDataRef.current,
      effectiveLatestDate || '',
      displayMetric === 'diff'
    );
    setRowData(groupedWithToday);

    // 機種名（name優先、なければmodelName）＋日付列（降順）
    const groupedCols = buildGroupedColumnsForDates(
      loaded,
      [],
      showModal,
      effectiveLatestDate || '',
      todayColumnHeader,
      hasTodayDiffData,
      resolveDisplayName,
      displayMetric
    );
    setColumnDefs(groupedCols);
  };

  // ========= 末尾別（平均） =========
  const buildAndSetTail = (loadedDatesOverride?: string[], allDataOverride?: Record<string, any>) => {
    const allData = allDataOverride ?? buildDisplayDataMap(rawMapRef.current, displayMetric);
    const loaded = (loadedDatesOverride ?? Array.from(loadedDates)).sort((a, b) => b.localeCompare(a));
    const effectiveLatestDate = pickEffectiveLatestDate(allData, loaded);

    const tailRows = transformToTailGridData(allData);
    const tailWithToday = applyTodayDiffToTailRows(
      tailRows,
      numberRowDataRef.current,
      displayMetric === 'diff'
    );
    const tailCols = buildTailColumnsForDates(
      loaded,
      effectiveLatestDate || '',
      todayColumnHeader,
      hasTodayDiffData,
      displayMetric,
      tailWithToday
    );

    setRowData(tailWithToday);
    setColumnDefs(tailCols);
  };

  useEffect(() => {
    const loadedArr = Array.from(loadedDates);
    if (loadedArr.length === 0) return;

    pendingScrollRestoreRef.current = getCurrentVerticalScrollTop();

    const allDataForDisplay = buildDisplayDataMap(rawMapRef.current, displayMetric);
    const loadedDesc = [...loadedArr].sort((a, b) => b.localeCompare(a));
    const latestKey = loadedDesc[0];
    const latest = (latestKey && allDataForDisplay[latestKey]) ? allDataForDisplay[latestKey] : Object.values(allDataForDisplay)[0] ?? {};

    let numberRows = transformToGridData(latest, allDataForDisplay);
    numberRows = applyNumberTotalLabelByMetric(numberRows);
    numberRows = applyTodayDiffToRows(
      numberRows,
      todayDiffMap,
      todaySnapshotDateKey
    );
    const effectiveLatestDate = pickEffectiveLatestDate(allDataForDisplay, loadedArr);
    if (effectiveLatestDate) {
      numberRows = sortByLatestMissing(numberRows, effectiveLatestDate);
    } else {
      numberRows = sortByMachineNumber(numberRows);
    }
    numberRowDataRef.current = numberRows;

    numberColDefsRef.current = buildNumberColumns(
      loadedDesc,
      [],
      showModal,
      effectiveLatestDate || '',
      todayColumnHeader,
      hasTodayDiffData,
      resolveDisplayName,
      getTooltipColor,
      getTooltipText
    );

    if (viewModeRef.current === 'number') {
      setRowData(numberRowDataRef.current);
      setColumnDefs(numberColDefsRef.current);
      return;
    }
    if (viewModeRef.current === 'model') {
      buildAndSetGrouped(loadedArr, allDataForDisplay);
      return;
    }
    buildAndSetTail(loadedArr, allDataForDisplay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMetric]);

  // ========= タブ切替 =========
  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    const currentMode = viewModeRef.current;
    const currentMetric = displayMetricRef.current;
    captureGridUiState(currentMode, currentMetric);

    const newMode: ViewMode = newValue === 0 ? 'number' : newValue === 1 ? 'model' : 'tail';
    queueGridUiRestore(newMode, currentMetric);
    setViewMode(newMode);
    if (newMode === 'tail') {
      setSelectedName('');
    }

    if (newMode === 'model') {
      buildAndSetGrouped();
    } else if (newMode === 'tail') {
      buildAndSetTail();
    } else {
      // ★ 台番別に“確実に”戻す（ref に保持していた元データを復元）
      setRowData(numberRowDataRef.current);
      setColumnDefs(numberColDefsRef.current);
    }
  };

  const tabValue = viewMode === 'number' ? 0 : viewMode === 'model' ? 1 : 2;
  const groupedRowNeedsExtraHeight = viewMode === 'model' && displayMetric === 'diff' && showGroupedWinStats;
  const currentGridRowHeight = viewMode === 'tail' || groupedRowNeedsExtraHeight ? 34 : 22;
  const gridRenderKey = `win-stats-remount-${gridRemountNonce}`;
  const applyCurrentRowHeight = useCallback(() => {
    const api = gridRef.current?.api as any;
    if (!api) return;
    // Force AG Grid to re-run getRowHeight when display mode/toggles change.
    if (typeof api.resetRowHeights === 'function') {
      api.resetRowHeights();
    } else {
      api.forEachNode?.((node: any) => {
        node?.setRowHeight?.(currentGridRowHeight);
      });
      api.onRowHeightChanged?.();
    }
    api.redrawRows?.();
    api.refreshCells?.({ force: true });
  }, [currentGridRowHeight]);

  useEffect(() => {
    applyCurrentRowHeight();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyCurrentRowHeight();
      });
    });
  }, [applyCurrentRowHeight, rowData, columnDefs]);

  useEffect(() => {
    if (displayMetric === 'games' && showGroupedWinStats) {
      setShowGroupedWinStats(false);
    }
  }, [displayMetric, showGroupedWinStats]);

  useEffect(() => {
    applyCurrentRowHeight();
  }, [showGroupedWinStats, displayMetric, viewMode, applyCurrentRowHeight]);

  const todayGalleryStats = useMemo(() => {
    const parseNumeric = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'string') return null;
      const digits = value.replace(/[^0-9.-]/g, '');
      if (!digits) return null;
      const n = Number(digits);
      return Number.isFinite(n) ? n : null;
    };

    const parseCombinedDenominator = (value: unknown): number | null => {
      if (typeof value !== 'string') return null;
      const m = value.match(/1\s*\/\s*(\d+)/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };

    const rows = todayGalleryItems.map(({ machineKey, snapshot }) => ({
      machineKey: String(machineKey),
      machineNumber: String(snapshot?.machineNumber ?? machineKey),
      totalGame: parseNumeric(snapshot?.totalGameCount),
      bbCount: parseNumeric(snapshot?.bbCount),
      rbCount: parseNumeric(snapshot?.rbCount),
      combined: parseCombinedDenominator(snapshot?.combinedProbability),
      artCount: parseNumeric(snapshot?.artCount),
    }));

    const avgOf = (arr: Array<number | null>) => {
      const nums = arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (nums.length === 0) return null;
      return Math.round(nums.reduce((sum, v) => sum + v, 0) / nums.length);
    };

    const avgTotalGame = avgOf(rows.map((r) => r.totalGame));
    const avgBbCount = avgOf(rows.map((r) => r.bbCount));
    const avgRbCount = avgOf(rows.map((r) => r.rbCount));
    const avgCombined =
      avgTotalGame != null && avgBbCount != null && avgRbCount != null && (avgBbCount + avgRbCount) > 0
        ? Math.floor(avgTotalGame / (avgBbCount + avgRbCount))
        : avgOf(rows.map((r) => r.combined));

    const avgRow = {
      machineNumber: '平均',
      totalGame: avgTotalGame,
      bbCount: avgBbCount,
      rbCount: avgRbCount,
      combined: avgCombined,
      artCount: avgOf(rows.map((r) => r.artCount)),
    };

    return { rows, avgRow };
  }, [todayGalleryItems]);

  // ===== CSVユーティリティ（api不使用）ここから =====
  const escapeCsv = (val: any): string => {
    if (val == null) return '';
    const s = String(val);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // columnDefs から「表示カラム」のみを順序通りに取得
  const pickVisibleColDefs = (colDefs: any[]) => {
    const flat = (defs: any[], acc: any[] = []): any[] =>
      defs.reduce((a, d) => {
        if (Array.isArray(d.children) && d.children.length) return flat(d.children, a);
        a.push(d);
        return a;
      }, acc);

    const defs = flat(colDefs ?? []);
    // 非表示/グループ/ピボットなどは除外（必要に応じて調整）
    return defs.filter((d) => d && d.hide !== true && !d.rowGroup && !d.pivot);
  };

  // valueGetter → field → colId の順で値を取り、valueFormatter があれば適用
  const getCellValueFromDef = (def: any, row: any): any => {
    // valueGetter (function) を評価
    if (typeof def?.valueGetter === 'function') {
      try {
        const params = {
          data: row,
          colDef: def,
          // 最低限の getValue を提供（別フィールド参照用）
          getValue: (field: string) => (row ? row[field] : undefined),
        };
        return def.valueGetter(params);
      } catch { /* ignore */ }
    }
    // field
    if (def?.field) return row ? row[def.field] : undefined;
    // colId をフォールバックキーに
    if (def?.colId) return row ? row[def.colId] : undefined;
    return undefined;
  };

  const applyValueFormatterFromDef = (def: any, row: any, value: any) => {
    if (typeof def?.valueFormatter === 'function') {
      try {
        const params = { value, data: row, colDef: def };
        return def.valueFormatter(params);
      } catch { /* ignore */ }
    }
    return value;
  };

  // rows: 画面に渡している配列（フィルタ/ソート後のもの）
  // colDefs: 実際に <AgGridReact columnDefs={...} /> に渡している配列
  const buildCsvFromProps = (rows: any[], colDefs: any[]): string => {
    const visibleDefs = pickVisibleColDefs(colDefs);
    const headers = visibleDefs.map(
      (d) => d.headerName ?? d.field ?? d.colId ?? ''
    );

    const lines: string[] = [];
    lines.push(headers.map(escapeCsv).join(','));

    (rows ?? []).forEach((row) => {
      const vals = visibleDefs.map((def) => {
        const raw = getCellValueFromDef(def, row);
        const formatted = applyValueFormatterFromDef(def, row, raw);
        return escapeCsv(formatted);
      });
      lines.push(vals.join(','));
    });

    return lines.join('\r\n');
  };

  const downloadCsv = (csv: string, baseName = 'export') => {
    const bom = '\uFEFF'; // Excel 文字化け対策
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const filename = `${baseName}.csv`;
    if ((window.navigator as any).msSaveOrOpenBlob) {
      (window.navigator as any).msSaveOrOpenBlob(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };
  // ===== CSVユーティリティここまで =====

  // 例: これをクリックで呼ぶ（rowData と columnDefs はこのコンポーネント内に既にある想定）
  const handleExportCsv = () => {
    // ★ 重要：ここに「実際に <AgGridReact rowData={...}> に渡している配列」を入れてください。
    // 例）rowData が既にフィルタ/ソート後の配列ならそのまま使えます。
    const rowsForGrid = rowData;              // ← あなたの変数名に合わせて置換
    const colDefsForGrid = columnDefs;        // ← あなたの変数名に合わせて置換

    const csv = buildCsvFromProps(rowsForGrid, colDefsForGrid);
    downloadCsv(csv, `slot-diff_${new Date().toISOString().slice(0,10)}`);
  };

  const handleExportXlsx = async () => {
    if (!window.confirm('表示データのExcelファイルを出力します。よろしいですか？')) return;
  
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
  
    // ヘッダ行
    const visibleDefs = columnDefs.filter((d: any) => !d.hide && !d.rowGroup && !d.pivot);
    const headers = visibleDefs.map((d: any) => d.headerName ?? d.field ?? d.colId ?? '');
    worksheet.addRow(headers);
  
    // データ行
    rowData.forEach((row: any) => {
      const rowVals = visibleDefs.map((def: any) => {
        const val =
          typeof def.valueGetter === 'function'
            ? def.valueGetter({ data: row, colDef: def, getValue: (f: string) => row[f] })
            : def.field
            ? row[def.field]
            : def.colId
            ? row[def.colId]
            : '';
        return val;
      });
  
      const addedRow = worksheet.addRow(rowVals);
  
      // 各セルの cellStyle を確認して背景色を適用
      visibleDefs.forEach((def: any, i: number) => {
        let bgColor: string | undefined;
  
        if (typeof def.cellStyle === 'object' && def.cellStyle.backgroundColor) {
          bgColor = def.cellStyle.backgroundColor;
        } else if (typeof def.cellStyle === 'function') {
          try {
            const styleObj = def.cellStyle({ value: row[def.field], data: row, colDef: def });
            if (styleObj && styleObj.backgroundColor) {

              if (styleObj.backgroundColor == "#FFBFC7") {
                bgColor = "#FF0000";
              }
              else if (styleObj.backgroundColor == "#5bd799") {
                bgColor = "#008000";
              }
              else if (styleObj.backgroundColor == "#D3B9DE") {
                bgColor = "#5a4498";
              }
              else if (styleObj.backgroundColor == "#FFE899") {
                bgColor = "#ffff00";
              }
              else {
                bgColor = styleObj.backgroundColor;
              }
            }
          } catch {
            // ignore
          }
        }
  
        if (bgColor) {
          // ExcelJSはARGB形式 (例: 'FFFF0000' → 赤)。CSS形式(#RRGGBB)を変換
          const hex = bgColor.replace('#', '');
          const argb =
            hex.length === 6
              ? `FF${hex.toUpperCase()}` // 先頭にアルファ値FFを追加
              : hex.length === 8
              ? hex.toUpperCase()
              : undefined;
  
          if (argb) {
            const cell = addedRow.getCell(i + 1);
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb },
            };
          }
        }
      });
    });
  
    // ダウンロード
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${storeId}_${dayjs().tz("Asia/Tokyo").format("YYYYMMDDHHmmss")}.xlsx`);
  };

  return (
    <>
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 上部タブ */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 1, marginBottom: 0 }}>
      <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="view mode tabs"
          variant="fullWidth"
          sx={{ minHeight: 24 }}  // Tabs 全体の高さを下げる
        >          
        <Tab label="台番別" 
            sx={{
              minHeight: 24,     // ★ タブ本体の高さを下げる
              paddingY: 0,       // ★ 上下の余白をゼロに
              fontSize: '0.8rem' // フォントサイズ調整
            }}
          />
          <Tab label="機種別（平均）" 
            sx={{
              minHeight: 24,     // ★ タブ本体の高さを下げる
              paddingY: 0,       // ★ 上下の余白をゼロに
              fontSize: '0.8rem' // フォントサイズ調整
            }}
          />
          <Tab label="末尾別（平均）" 
            sx={{
              minHeight: 24,
              paddingY: 0,
              fontSize: '0.8rem'
            }}
          />
        </Tabs>
      </Box>

      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        <div className="ag-theme-alpine" style={{ height: '100%', width: '100%' }}>
          <AgGridReact
            key={gridRenderKey}
            ref={gridRef}
            rowData={filteredRowData}
            columnDefs={columnDefs}
            components={{
              customCellRenderer: CustomCellRenderer,
              groupedCellRenderer: GroupedCellRenderer,
              groupedNameCellRenderer: GroupedNameCellRenderer,
            }}
            suppressMovableColumns={true}
            suppressHorizontalScroll={false}
            suppressRowVirtualisation={disableVirtualization}
            suppressColumnVirtualisation={disableVirtualization}
            getRowHeight={() => currentGridRowHeight}
            headerHeight={20}
            defaultColDef={{
              resizable: false,
              sortingOrder: ['desc', 'asc', null],
              cellStyle: {
                fontSize: '0.8em',
                padding: 0,
                textAlign: 'center',
                borderRight: '1px solid #ccc',
              },
              headerClass: 'custom-header',
            }}
            onModelUpdated={() => {
              applyPendingGridUiRestore();
              applyCurrentRowHeight();
              if (!virtualizationPendingRef.current) return;
              virtualizationPendingRef.current = false;
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setDisableVirtualization(false);
                });
              });
            }}
            getRowStyle={(params) => {
              const style: Record<string, string | number> = {};
              if (params.data?.isTotalRow) {
                style.backgroundColor = '#f0f0f0';
                style.fontWeight = 'bold';
              }
              const rowKey = params.data?.id ?? params.data?.machineNumber ?? null;
              if (rowKey != null && rowKey === selectedRowId) {
                style.backgroundColor = '#dbffff';
              }
              return Object.keys(style).length ? style : undefined;
            }}
            onBodyScroll={onBodyScroll}
            onCellClicked={showMachineTooltip}
            onCellFocused={showMachineTooltip}
            domLayout="normal"
          />
        </div>
      </div>

      {/* フィルタ（機種名） */}
      <div style={{ marginTop: 6, marginBottom: 6, minHeight: 36, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
      {viewMode !== 'tail' ? (
        <FormControl variant="outlined" fullWidth style={{ width: 'min(240px, 50vw)' }}>
          <Select
            labelId="machine-select-label"
            value={selectedName}
            onChange={handleSelectChange}
            displayEmpty
            sx={{
              height: 30,
              fontSize: '0.8em',
            }}
          >
            <MenuItem value="" selected>
              <em>すべての機種を表示</em>
            </MenuItem>
            {Array.from(
              new Set(
                rowData
                  .map((r) => r.name ?? r.modelName)
                  .filter((v) => !!v)
              )
            )
              .sort((a: any, b: any) => String(a).localeCompare(String(b), 'ja'))
              .map((name: any) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
      ) : <div style={{ width: 'min(240px, 50vw)' }} />}

      <Button
        variant="outlined"
        onClick={handleToggleDisplayMetric}
        sx={{
          marginLeft: 1,
          height: 30,
          minWidth: 0,
          padding: '0 10px',
          borderRadius: 1,
          textTransform: 'none',
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#1565c0',
          borderColor: '#90caf9',
          '&:hover': {
            borderColor: '#64b5f6',
            backgroundColor: 'rgba(100,181,246,0.12)',
          },
        }}
      >
        {displayMetric === 'diff' ? '差枚' : '回転数'}
      </Button>

      {viewMode === 'model' ? (
        <Box sx={{ marginLeft: 0.5, display: 'flex', alignItems: 'center', lineHeight: 0 }}>
          <Android12LineSpacingSwitch
            checked={displayMetric === 'diff' && showGroupedWinStats}
            onChange={(e) => {
              const currentMode = viewModeRef.current;
              const currentMetric = displayMetricRef.current;
              const currentSnapshot = captureGridUiState(currentMode, currentMetric);
              queueGridUiRestore(currentMode, currentMetric, currentSnapshot);
              const nextChecked = e.target.checked;
              if (nextChecked !== showGroupedWinStatsRef.current) {
                setGridRemountNonce((prev) => prev + 1);
              }
              showGroupedWinStatsRef.current = nextChecked;
              setShowGroupedWinStats(nextChecked);
            }}
            disabled={displayMetric === 'games'}
          />
        </Box>
      ) : null}

      <Button
        variant="contained"
        onClick={handleExportXlsx}
        aria-label="Excel出力"
        sx={{
          marginLeft: 1.25,
          minWidth: 0,
          height: 30,
          width: 34,
          padding: 0,
          borderRadius: 1,
          textTransform: 'none',
          backgroundColor: '#1D6F42',
          color: '#fff',
          '&:hover': {
            backgroundColor: '#155A33',
          },
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            width: 14,
            height: 14,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 2,
            backgroundColor: '#0F4C2E',
            border: '1px solid rgba(255,255,255,0.42)',
            fontSize: 10,
            fontWeight: 800,
            lineHeight: 1,
            color: '#fff',
          }}
        >
          X
        </span>
      </Button>
      </div>
      </div>

      {machineTooltip ? (
        <div
          ref={machineTooltipRef}
          style={{
            position: 'fixed',
            left: machineTooltip.x,
            top: machineTooltip.y,
            transform: 'translate(8px, -110%)',
            backgroundColor: '#111',
            color: '#fff',
            padding: '6px 8px',
            borderRadius: 6,
            fontSize: '0.8em',
            maxWidth: 220,
            zIndex: 2000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          {machineTooltip.text}
        </div>
      ) : null}

      <Modal
        title={todayDetailItem ? `${todayDetailItem.machineNumber ?? '-'}番台 / ${todayDetailItem.name ?? '-'}` : ''}
        open={todayDetailModalOpen}
        onCancel={() => {
          const shouldReturnToGallery = todayDetailFromGallery;
          setTodayDetailModalOpen(false);
          setTodayDetailItem(null);
          setTodayDetailMachineKey(null);
          setTodayDetailFromGallery(false);
          todayOatariHistoryReqRef.current += 1;
          setTodayOatariHistoryRows([]);
          setTodayOatariHistoryCount(null);
          setTodayOatariHistoryLoading(false);
          setTodaySwipeHintDx(0);
          if (shouldReturnToGallery) {
            requestAnimationFrame(() => {
              setTodayGalleryModalOpen(true);
            });
          }
        }}
        destroyOnClose
        wrapClassName="today-detail-modal"
        afterOpenChange={(open) => {
          if (!open) return;
          requestAnimationFrame(() => {
            const body = document.querySelector('.today-detail-modal .ant-modal-body') as HTMLElement | null;
            if (body) body.scrollTop = 0;
          });
        }}
        footer={null}
        width={420}
        style={{ top: 12 }}
        styles={{
          body: {
            maxHeight: 'calc(100dvh - 140px)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          },
        }}
      >
        {todayDetailItem ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 10, touchAction: 'pan-y', position: 'relative' }}
            {...todaySwipeHandlers}
          >
            <div
              style={{
                position: 'fixed',
                left: 'calc(50vw - 196px)',
                top: '50dvh',
                width: 28,
                height: 28,
                borderRadius: 14,
                background: 'rgba(0,0,0,0.36)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
                opacity: todaySwipeHintDx > 0 ? Math.min(0.85, 0.25 + Math.abs(todaySwipeHintDx) / 110) : 0,
                transform: `translateX(${Math.max(0, todaySwipeHintDx * 0.18)}px)`,
                transition: 'opacity 140ms ease, transform 140ms ease',
                pointerEvents: 'none',
                zIndex: 10000,
                marginTop: -14,
              }}
            >
              ←
            </div>
            <div
              style={{
                position: 'fixed',
                left: 'calc(50vw + 168px)',
                top: '50dvh',
                width: 28,
                height: 28,
                borderRadius: 14,
                background: 'rgba(0,0,0,0.36)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
                opacity: todaySwipeHintDx < 0 ? Math.min(0.85, 0.25 + Math.abs(todaySwipeHintDx) / 110) : 0,
                transform: `translateX(${Math.min(0, todaySwipeHintDx * 0.18)}px)`,
                transition: 'opacity 140ms ease, transform 140ms ease',
                pointerEvents: 'none',
                zIndex: 10000,
                marginTop: -14,
              }}
            >
              →
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${todayDetailMachineKey ?? 'none'}_${todayDetailAnimTick}`}
                initial={
                  todayDetailAnimName === 'slideLeft'
                    ? { opacity: 0.72, x: 18 }
                    : todayDetailAnimName === 'slideRight'
                      ? { opacity: 0.72, x: -18 }
                      : { opacity: 1, x: 0 }
                }
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
            {todayDetailItem.graphImageUrl ? (
              <div
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  overflow: 'hidden',
                  backgroundColor: '#f2f2f2',
                }}
              >
                <img
                  src={buildTodayGraphUrl(todayDetailItem)}
                  alt="本日グラフ"
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
                />
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#888' }}>グラフ画像なし</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.85em' }}>
              <div>累計ゲーム: {todayDetailItem.totalGameCount ?? '-'}</div>
              <div>最高出玉: {todayDetailItem.highestPayout ?? '-'}</div>
              <div>BB回数: {todayDetailItem.bbCount ?? '-'}</div>
              <div>BB確率: {todayDetailItem.bbProbability ?? '-'}</div>
              <div>RB回数: {todayDetailItem.rbCount ?? '-'}</div>
              <div>RB確率: {todayDetailItem.rbProbability ?? '-'}</div>
              <div>ART回数: {todayDetailItem.artCount ?? '-'}</div>
              <div>合成確率: {todayDetailItem.combinedProbability ?? '-'}</div>
              <div>本日差枚: {todayDetailItem.currentDifference ?? '-'}</div>
              <div>更新: {todayDetailItem.dataUpdatedAt ?? '-'}</div>
            </div>

            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                大当り履歴
                {todayOatariHistoryCount != null ? ` (${todayOatariHistoryCount})` : ''}
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
                    {todayOatariHistoryLoading ? (
                      <tr>
                        <td colSpan={5} style={{ border: '1px solid #cfcfcf', padding: '8px 4px', textAlign: 'center', color: '#666' }}>
                          履歴を読み込み中...
                        </td>
                      </tr>
                    ) : todayOatariHistoryRows.length > 0 ? (
                      todayOatariHistoryRows.map((h, idx) => {
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
              </motion.div>
            </AnimatePresence>

          </div>
        ) : null}
      </Modal>

      <Modal
        title={todayGalleryTitle || ''}
        open={todayGalleryModalOpen}
        onCancel={() => {
          setTodayGalleryModalOpen(false);
          setTodayGalleryTitle('');
          setTodayGalleryItems([]);
        }}
        destroyOnClose
        footer={null}
        width={420}
        style={{ top: 12 }}
        styles={{
          body: {
            maxHeight: 'calc(100dvh - 140px)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          },
        }}
      >
        {todayGalleryItems.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              {todayGalleryItems.map(({ machineKey, snapshot }) => (
                <div
                  key={`gallery_${machineKey}`}
                  onClick={() => openTodayDetailFromGallery(machineKey)}
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
                    src={buildTodayGraphUrl(snapshot)}
                    alt={`${snapshot?.machineNumber ?? machineKey}番台の本日グラフ`}
                    style={{ width: '100%', display: 'block' }}
                  />
                </div>
              ))}
            </div>

            <div style={{ border: '1px solid #cfcfcf', overflow: 'hidden', backgroundColor: '#f0f0f0' }}>
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
                  {todayGalleryStats.rows.map((r) => (
                    <tr key={`gallery_stats_${r.machineKey}`} style={{ backgroundColor: '#f2f2f2' }}>
                      <td
                        onClick={() => openTodayDetailFromGallery(r.machineKey)}
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
                      {todayGalleryStats.avgRow.machineNumber}
                    </td>
                    <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{todayGalleryStats.avgRow.totalGame ?? '--'}</td>
                    <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{todayGalleryStats.avgRow.bbCount ?? '--'}</td>
                    <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{todayGalleryStats.avgRow.rbCount ?? '--'}</td>
                    <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{todayGalleryStats.avgRow.combined ?? '--'}</td>
                    <td style={{ border: '1px solid #b8dcb7', padding: '4px 2px', textAlign: 'center' }}>{todayGalleryStats.avgRow.artCount ?? '--'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#888', padding: '12px 0' }}>
            表示できるグラフ画像がありません
          </div>
        )}
      </Modal>

      {/* モーダル（台番別のみ） */}
      <Modal
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setSelectedComment('');
        }}
        onOk={async () => {
          if (!selectedCell || selectedFlag === null) return;
          const scrollTopBeforeUpdate = getCurrentVerticalScrollTop();

          const dateField = selectedCell.field; // YYYYMMDD
          const db = getFirestore();
          const ref = doc(db, 'slot_diff', `${storeId}_${dateField}`);
          const snap = await getDoc(ref);
          if (!snap.exists()) return;

          const data = snap.data().data;
          const targetName = String(selectedCell.rowData.name ?? selectedCell.rowData.modelName ?? '');
          const targetCanonicalName = resolveDisplayName(targetName);
          const targetNumber = String(selectedCell.rowData.machineNumber ?? '');

          const originalFlag = selectedCell?.rowData?.flag?.[dateField] ?? 0;
          const commentValue = selectedComment ?? '';

          // 台番別と機種別で分岐
          if (viewMode === 'model') {
            // ★ 機種別：コメントは常に全台へ反映。flag は 9/0 のときのみ一括更新
            const shouldUpdateFlag = [9, 0].includes(selectedFlag);

            const targetKeys: string[] = [];
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              const canonical = resolveDisplayName(String(val?.name ?? ''));
              if (canonical === targetCanonicalName) {
                targetKeys.push(key);
              }
            });

            if (targetKeys.length === 0) {
              setModalOpen(false);
              return;
            }

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
                await updateDoc(
                  ref,
                  new FieldPath('data', key, 'comment'),
                  commentValue
                );
              }
            } else {
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
                  batch.update(
                    ref,
                    new FieldPath('data', key, 'comment'),
                    commentValue
                  );
                }
              });
              await batch.commit();
            }

            // ローカル反映（台番別の元データ／現在表示データ／機種別行）
            numberRowDataRef.current.forEach((row: any) => {
              const canonical = resolveDisplayName(String(row?.name ?? row?.modelName ?? ''));
              if (canonical !== targetCanonicalName) return;
              if (!row.comments) row.comments = {};
              if (shouldUpdateFlag) {
                if (!row.flag) row.flag = {};
                row.flag[dateField] = selectedFlag;
              }
              row.comments[dateField] = commentValue;
            });
            rowDataRef.current.forEach((row: any) => {
              const canonical = resolveDisplayName(String(row?.name ?? row?.modelName ?? ''));
              if (canonical !== targetCanonicalName) return;
              if (!row.comments) row.comments = {};
              if (shouldUpdateFlag) {
                if (!row.flag) row.flag = {};
                row.flag[dateField] = selectedFlag;
              }
              row.comments[dateField] = commentValue;
            });
            pendingScrollRestoreRef.current = scrollTopBeforeUpdate;
            setRowData(prev =>
              prev.map((r: any) => {
                const nm = resolveDisplayName(String(r?.name ?? r?.modelName ?? ''));
                if (nm !== targetCanonicalName) return r;
                const next = { ...r, comments: { ...(r.comments ?? {}) } } as any;
                if (shouldUpdateFlag) {
                  next.flag = { ...(r.flag ?? {}) };
                  next.flag[dateField] = selectedFlag;
                }
                next.comments[dateField] = commentValue;
                return next;
              })
            );

            setModalOpen(false);
            setSelectedComment('');
            gridRef.current?.api?.refreshCells({ force: true });
            return;
          }

          // ★ ここから先は従来の「台番別」ロジック（既存と同等）
          const targetKeys: string[] = [];

          // 1) 全台系 → フラグ解除（同機種すべて 0）
          if (originalFlag === 9 && selectedFlag === 0) {
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              const canonical = resolveDisplayName(String(val?.name ?? ''));
              if (canonical === targetCanonicalName) {
                targetKeys.push(key);
              }
            });
          }
          // 2) 全台系 選択（同機種すべて 9）
          else if (selectedFlag === 9) {
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              const canonical = resolveDisplayName(String(val?.name ?? ''));
              if (canonical === targetCanonicalName) {
                targetKeys.push(key);
              }
            });
          }
          // 3) 個別更新（対象セルのみ）
          else {
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              const canonical = resolveDisplayName(String(val?.name ?? ''));
              if (canonical === targetCanonicalName && String(val?.machineNumber ?? '') === targetNumber) {
                targetKeys.push(key);
              }
            });
          }

          if (targetKeys.length >= 1) {
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

          setModalOpen(false);
          setSelectedComment('');

          // 画面側へ反映
          const api = gridRef.current?.api;
          if (!api) return;
          const field = dateField;
          pendingScrollRestoreRef.current = scrollTopBeforeUpdate;

          rowDataRef.current.forEach((row: any) => {
            if (!row.flag) row.flag = {};
            if (!row.comments) row.comments = {};
            const canonical = resolveDisplayName(String(row?.name ?? row?.modelName ?? ''));
            const rowNumber = String(row?.machineNumber ?? '');
            if (originalFlag === 9 && selectedFlag === 0 && canonical === targetCanonicalName) {
              row.flag[field] = 0;
              row.comments[field] = commentValue;
            } else if (selectedFlag === 9 && canonical === targetCanonicalName) {
              row.flag[field] = 9;
              row.comments[field] = commentValue;
            } else if (canonical === targetCanonicalName && rowNumber === targetNumber) {
              row.flag[field] = selectedFlag;
              row.comments[field] = commentValue;
            }
          });

          numberRowDataRef.current.forEach((row: any) => {
            if (!row.flag) row.flag = {};
            if (!row.comments) row.comments = {};
            const canonical = resolveDisplayName(String(row?.name ?? row?.modelName ?? ''));
            const rowNumber = String(row?.machineNumber ?? '');
            if (originalFlag === 9 && selectedFlag === 0 && canonical === targetCanonicalName) {
              row.flag[field] = 0;
              row.comments[field] = commentValue;
            } else if (selectedFlag === 9 && canonical === targetCanonicalName) {
              row.flag[field] = 9;
              row.comments[field] = commentValue;
            } else if (canonical === targetCanonicalName && rowNumber === targetNumber) {
              row.flag[field] = selectedFlag;
              row.comments[field] = commentValue;
            }
          });

          setRowData((prev) =>
            prev.map((row: any) => {
              const canonical = resolveDisplayName(String(row?.name ?? row?.modelName ?? ''));
              const rowNumber = String(row?.machineNumber ?? '');
              const shouldUpdate =
                (originalFlag === 9 && selectedFlag === 0 && canonical === targetCanonicalName) ||
                (selectedFlag === 9 && canonical === targetCanonicalName) ||
                (canonical === targetCanonicalName && rowNumber === targetNumber);
              if (!shouldUpdate) return row;
              const next = { ...row, flag: { ...(row.flag ?? {}) }, comments: { ...(row.comments ?? {}) } };
              next.flag[field] = selectedFlag;
              next.comments[field] = commentValue;
              return next;
            })
          );

          api.refreshCells({ force: true });
        }}


        title="フラグ設定"
      >
        <p>台番号: {selectedCell?.rowData?.machineNumber}</p>
        <p>機種名: {selectedCell?.rowData?.name ?? selectedCell?.rowData?.modelName}</p>
        <p>日付: {selectedCell?.field}</p>
        {selectedCellUrl ? (
          <p><a
            onClick={() => {
              setMachineUrl(selectedCellUrl);
              setIsMachineModalOpen(true);
            }}
          >
            台データを見る
          </a></p>
        ) : null}

        <Radio.Group
          onChange={(e) => setSelectedFlag(Number(e.target.value))}
          value={selectedFlag}
        >
          <Radio value={9} disabled={false}>全台系</Radio>
          <Radio value={6} disabled={viewMode === 'model'}>設定6</Radio>
          <Radio value={5} disabled={viewMode === 'model'}>設定56</Radio>
          <Radio value={4} disabled={viewMode === 'model'}>設定456</Radio>
          <Radio value={0} disabled={false}>フラグ解除</Radio>
        </Radio.Group>

        <div style={{ marginTop: 10 }}>
          <Input.TextArea
            value={selectedComment}
            onChange={(e) => setSelectedComment(e.target.value)}
            placeholder="コメントを入力"
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      </Modal>
      <Modal
        title="台データ"
        open={isMachineModalOpen}
        onCancel={() => {
          setIsMachineModalOpen(false);
          setMachineUrl(null);
        }}
        footer={null}
        width="90vw"
        style={{ top: 20 }}
      >
        {machineUrl ? (
          <div
            style={{
              width: "100%",
              overflowX: "hidden",
              touchAction: "pan-y",        // ←横方向のパンを抑制
            }}
          >
            <iframe
              src={machineUrl}
              title="台データ"
              style={{
                width: "100%",
                height: "70vh",
                border: "none",
                display: "block",
              }}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
};

// ================== 台番別（columns） ==================
// シグネチャ変更：latestDate を追加
function compareNumericCellValues(
  valueA: any,
  valueB: any,
  _nodeA: any,
  _nodeB: any,
  isDescending?: boolean
) {
  const toNumber = (v: any): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const normalized = v.replace(/,/g, '').trim();
      if (!normalized || normalized === '-') return null;
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const a = toNumber(valueA);
  const b = toNumber(valueB);
  const aMissing = a === null;
  const bMissing = b === null;

  if (aMissing && bMissing) return 0;
  if (aMissing && !bMissing) return isDescending ? -1 : 1;
  if (!aMissing && bMissing) return isDescending ? 1 : -1;
  return (a as number) - (b as number);
}

function buildNumberColumns(
  dates: string[],
  existing: ColDef[],
  showModal: Function,
  latestDate: string,        // ★ 追加
  todayColumnHeader: string,
  hasTodayDiffData: boolean,
  resolveDisplayName: (name: string) => string,
  getTooltipColor: (machineNumber: number | string | null | undefined) => string | undefined,
  getTooltipText: (machineNumber: number | string | null | undefined) => string | undefined
): ColDef[] {
  const existingFields = new Set(existing.map(c => c.field));
  const cols: ColDef[] = [];

  const isMissingLatest = (row: any) => {
    if (!latestDate) return false; // ★ 実効日付がないならグレー化しない
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-'; // 0 はデータ扱い
  };

  
  if (!existingFields.has('machineNumber')) {
    cols.push({
      headerName: '',
      field: 'machineNumber',
      pinned: 'left',
      width: 40,
      tooltipValueGetter: (p: any) => getTooltipText(p?.data?.machineNumber),
      cellRenderer: (p: any) => {
        const text = getTooltipText(p?.data?.machineNumber);
        return (
          <div title={text || undefined}>
            {p.value}
          </div>
        );
      },
      // ★ 固定列もグレー化
      cellStyle: (p) => {
        const base: any = {
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          borderRight: '1px solid #ccc', 
        };
        if (!p?.data || p.data.isTotalRow) return base;
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        } else {
          const tooltipColor = getTooltipColor(p.data?.machineNumber);
          if (tooltipColor) {
            base.backgroundColor = tooltipColor;
          }
        }
        return base;
      },
    });
  }

  if (!existingFields.has('name')) {
    cols.push({
      headerName: '機種名',
      field: 'name',
      pinned: 'left',
      width: 90,
      valueGetter: (p) => resolveDisplayName(p.data?.name ?? ''),
      // ★ 固定列もグレー化
      cellStyle: (p) => {
        const base: any = {
          fontSize: '0.6em',
          padding: 0,
          whiteSpace: 'normal',
          textAlign: 'center',

        };
        if (!p?.data || p.data.isTotalRow) return base;
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    });
  }

  if (!existingFields.has('todayDiff')) {
    cols.push({
      headerName: todayColumnHeader,
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      cellRenderer: 'customCellRenderer',
      cellRendererParams: { showModal },
      valueFormatter: (p: any) => {
        const v = p?.value;
        if (v === undefined || v === null || v === '-') return '-';
        if (typeof v === 'number') {
          const normalized = Object.is(v, -0) ? 0 : v;
          return normalized.toLocaleString();
        }
        if (typeof v === 'string') {
          const normalized = v.replace(/,/g, '').trim();
          if (/^[+-]?0(?:\.0+)?$/.test(normalized)) return '0';
        }
        return v;
      },
      comparator: compareNumericCellValues,
      cellStyle: (p) => {
        const v = p?.value;
        const base: any = {
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          backgroundColor: '#fff7cc',
          borderRight: '1px solid #ccc',
        };
        if (!p?.data) return base;
        if (typeof v === 'number') {
          if (v > 0 || Object.is(v, 0) || Object.is(v, -0)) base.color = '#4c6cb3';
          else if (v < 0) base.color = '#d9333f';
        }
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
          return base;
        }
        return base;
      },
    });
  }

  const dynamic: ColDef[] = dates
    .filter(d => !existingFields.has(d))
    .map((d) => ({
      headerName: formatDate(d),
      field: d,
      width: 60,
      cellRenderer: 'customCellRenderer',
      cellRendererParams: { showModal },
      comparator: compareNumericCellValues,
      cellStyle: (params) => {
        const v = params.value;
        const row = params.data;
        const field = params.colDef.field as string;
        const flag = row?.flag?.[field];

        let color = '#ccc';
        let backgroundColor: string | undefined;

        if (typeof v === 'number') {
          color = v >= 0 ? '#4c6cb3' : '#d9333f';
        }

        switch (flag) {
          case 9: backgroundColor = '#FFBFC7'; break;
          case 6: backgroundColor = '#5bd799'; break;
          case 5: backgroundColor = '#D3B9DE'; break;
          case 4: backgroundColor = '#FFE899'; break;
          default: break;
        }

        // ★ 全列で“最新欠損”ならグレー
        if (row && !row.isTotalRow && isMissingLatest(row)) {
          backgroundColor = '#e0e0e0';
          color = '#666';
        }

        switch (flag) {
          case 9: backgroundColor = '#FFBFC7'; break;
          case 6: backgroundColor = '#5bd799'; break;
          case 5: backgroundColor = '#D3B9DE'; break;
          case 4: backgroundColor = '#FFE899'; break;
          default: break;
        }

        return {
          color,
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          borderRight: '1px solid #ccc',
          backgroundColor,
        } as any;
      },
    }));

  return [...cols, ...dynamic];
}


// ========= 機種別（平均）columns =========
function buildGroupedColumnsForDates(
  dates: string[],
  existing: ColDef[],
  showModal: (value: any, row: any, field: string) => void,
  latestDate: string,
  todayColumnHeader: string,
  hasTodayDiffData: boolean,
  resolveDisplayName: (name: string) => string,
  displayMetric: DisplayMetric
): ColDef[] {  const existingFields = new Set(existing.map(c => c.field));
  const cols: ColDef[] = [];

  const isMissingLatest = (row: any) => {
    if (!latestDate) return false;
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-';
  };

  const compareGroupedByAverageDiff = (
    valueA: any,
    valueB: any,
    _nodeA: any,
    _nodeB: any,
    isDescending?: boolean
  ) => {
    const a = parseGroupedMetricCell(valueA);
    const b = parseGroupedMetricCell(valueB);
    const aMissing = !a;
    const bMissing = !b;

    if (aMissing && bMissing) return 0;
    if (aMissing && !bMissing) return isDescending ? -1 : 1;
    if (!aMissing && bMissing) return isDescending ? 1 : -1;

    const avgDiff = a!.avg - b!.avg;
    if (avgDiff !== 0) return avgDiff;

    const winRateDiff = a!.winRate - b!.winRate;
    if (winRateDiff !== 0) return winRateDiff;
    return 0;
  };

  const groupedComparator = displayMetric === 'games'
    ? compareNumericCellValues
    : compareGroupedByAverageDiff;

  const getGroupedCellColor = (value: any) => {
    const parsed = parseGroupedMetricCell(value);
    if (!parsed) return '#333';
    return parsed.avg >= 0 ? '#4c6cb3' : '#d9333f';
  };

  if (!existingFields.has('name')) {
    cols.push({
      headerName: '機種名',
      field: 'name',
      valueGetter: (p) => resolveDisplayName(p.data?.name ?? p.data?.modelName ?? ''),
      cellRenderer: 'groupedNameCellRenderer',
      pinned: 'left',
      width: 100,
      cellStyle: (p: any) => {
        const base: any = {
          fontSize: '0.6rem',
          padding: 0,
          whiteSpace: 'normal',
          textAlign: 'left',
        };
        if (!p?.data) return base;
        if (isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    });
  }

  if (!existingFields.has('todayDiff')) {
    cols.push({
      headerName: todayColumnHeader,
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      cellRenderer: 'groupedCellRenderer',
      cellRendererParams: { showModal },
      comparator: groupedComparator,
      cellStyle: (p: any) => {
        const v = p?.value;
        const base: any = {
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          backgroundColor: '#fff7cc',
          borderRight: '1px solid #ccc',
        };
        if (!p?.data) return base;
        base.color = getGroupedCellColor(v);
        if (!p.data?.isTotalRow && isMissingLatest(p.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    });
  }

  // 日付は降順（最新→古い）
  const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));

  const dynamic: ColDef[] = sortedDates
  .filter(d => !existingFields.has(d))
  .map((d) => ({
    headerName: formatDate(d),
    field: d,
    width: 60,
    cellRenderer: 'groupedCellRenderer',
    // ★ 機種別でもダブルタップでモーダル起動
    cellRendererParams: { showModal },
    comparator: groupedComparator,
    cellStyle: (params) => {
      const v = params.value;
      const row = params.data;
      const field = params.colDef.field as string;

      const flag = row?.flag?.[field];

      let color = getGroupedCellColor(v);

      let backgroundColor: string | undefined;
      switch (flag) {
        case 9: backgroundColor = '#FFBFC7'; break;
        case 5: backgroundColor = '#D3B9DE'; break;
        case 4: backgroundColor = '#FFE899'; break;
      }

      if (row && isMissingLatest(row)) {
        color = '#666';
        if (!backgroundColor) {
          backgroundColor = '#e0e0e0';
        }
      }

      return {
        color,
        fontSize: '0.8em',
        padding: 0,
        fontWeight: 'bold',
        textAlign: 'center',
        borderRight: '1px solid #ccc',
        backgroundColor,
      } as any;
    }
  }));

  return [...cols, ...dynamic];
}

function buildTailColumnsForDates(
  dates: string[],
  latestDate: string,
  todayColumnHeader: string,
  hasTodayDiffData: boolean,
  displayMetric: DisplayMetric,
  tailRowsForScale: any[]
): ColDef[] {
  const isGamesMetric = displayMetric === 'games';
  const parseTailCell = (value: any): { avg: number; ratio: string; winRate: number } | null => {
    if (typeof value !== 'string') return null;
    const m = value.match(/^(-?\d+)\((\d+)\/(\d+)\)$/);
    if (!m) return null;
    const avg = Number(m[1]);
    const winCount = Number(m[2]);
    const totalCount = Number(m[3]);
    if (!Number.isFinite(avg) || !Number.isFinite(winCount) || !Number.isFinite(totalCount) || totalCount <= 0) {
      return null;
    }
    return { avg, ratio: `(${winCount}/${totalCount})`, winRate: winCount / totalCount };
  };

  const parseTailAverage = (value: any): number | null => {
    if (typeof value === 'number') return value;
    const parsed = parseTailCell(value);
    return parsed ? parsed.avg : null;
  };

  const compareTailByWinRate = (
    valueA: any,
    valueB: any,
    _nodeA: any,
    _nodeB: any,
    isDescending?: boolean
  ) => {
    const a = parseTailCell(valueA);
    const b = parseTailCell(valueB);
    const aMissing = !a;
    const bMissing = !b;

    if (aMissing && bMissing) return 0;
    if (aMissing && !bMissing) return isDescending ? -1 : 1;
    if (!aMissing && bMissing) return isDescending ? 1 : -1;

    const winRateDiff = (a!.winRate - b!.winRate);
    if (winRateDiff !== 0) return winRateDiff;

    const avgDiff = (a!.avg - b!.avg);
    if (avgDiff !== 0) return avgDiff;

    return 0;
  };

  const compareTailByAverage = (
    valueA: any,
    valueB: any,
    _nodeA: any,
    _nodeB: any,
    isDescending?: boolean
  ) => {
    const a = parseTailAverage(valueA);
    const b = parseTailAverage(valueB);
    const aMissing = a === null;
    const bMissing = b === null;

    if (aMissing && bMissing) return 0;
    if (aMissing && !bMissing) return isDescending ? -1 : 1;
    if (!aMissing && bMissing) return isDescending ? 1 : -1;
    return (a as number) - (b as number);
  };

  const tailComparator = isGamesMetric ? compareTailByAverage : compareTailByWinRate;

  const getWinRateHeatmapColor = (winRate: number): string | undefined => {
    // 勝率40%以下は無色、40%超を薄い赤〜濃い赤にマップ
    if (winRate <= 0.4) return undefined;
    const clamped = Math.max(0.4, Math.min(1, winRate));
    const normalized = (clamped - 0.4) / 0.6; // 0..1
    const alpha = 0.12 + normalized * 0.73;
    return `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
  };

  const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));
  const fieldsForGamesScale = [todayColumnHeader ? 'todayDiff' : '', ...sortedDates].filter((f) => !!f);
  const gamesScaleByField: Record<string, { min: number; max: number }> = {};
  if (isGamesMetric) {
    fieldsForGamesScale.forEach((field) => {
      const values = (tailRowsForScale ?? [])
        .map((row) => parseTailAverage(row?.[field]))
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (values.length === 0) return;
      gamesScaleByField[field] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    });
  }

  const getGamesHeatmapColor = (avgGame: number, field: string): string | undefined => {
    if (!Number.isFinite(avgGame)) return undefined;
    const scale = gamesScaleByField[field];
    if (!scale) return undefined;
    const span = scale.max - scale.min;
    if (span <= 0) return undefined;
    const normalized = Math.max(0, Math.min(1, (avgGame - scale.min) / span));
    if (normalized <= 0) return undefined;
    const alpha = 0.08 + normalized * 0.52;
    return `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
  };

  const isMissingLatest = (row: any) => {
    if (!latestDate) return false;
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-';
  };

  const dynamicCols: ColDef[] = sortedDates.map((date) => ({
    headerName: formatDate(date),
    field: date,
    width: 60,
    comparator: tailComparator,
    cellRenderer: (params: any) => {
      if (isGamesMetric) {
        const avg = parseTailAverage(params.value);
        if (avg === null) return params.value;
        return avg.toLocaleString();
      }
      const parsed = parseTailCell(params.value);
      if (!parsed) return params.value;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
          <span>{parsed.avg}</span>
          <span style={{ fontSize: '0.7em' }}>{(parsed.winRate * 100).toFixed(1)}%</span>
          <span style={{ fontSize: '0.65em' }}>{parsed.ratio}</span>
        </div>
      );
    },
    cellStyle: (params) => {
      const v = params.value;
      const parsed = parseTailCell(v);
      let color = '#333';
      const avg = parseTailAverage(v);
      if (avg !== null) {
        color = avg >= 0 ? '#4c6cb3' : '#d9333f';
      }

      let backgroundColor: string | undefined;
      if (isMissingLatest(params.data)) {
        backgroundColor = '#e0e0e0';
        color = '#666';
      } else if (isGamesMetric) {
        if (avg !== null) {
          backgroundColor = getGamesHeatmapColor(avg, date);
        }
      } else if (parsed) {
        backgroundColor = getWinRateHeatmapColor(parsed.winRate);
      }

      return {
        color,
        fontSize: '0.8em',
        padding: 0,
        fontWeight: 'bold',
        textAlign: 'center',
        whiteSpace: 'normal',
        borderRight: '1px solid #ccc',
        backgroundColor,
      } as any;
    },
  }));

  return [
    {
      headerName: '末尾',
      field: 'tailLabel',
      pinned: 'left',
      width: 90,
      cellStyle: (params) => {
        const base: any = {
          fontSize: '0.75rem',
          padding: 0,
          textAlign: 'center',
          fontWeight: 'bold',
          borderRight: '1px solid #ccc',
        };
        if (isMissingLatest(params?.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        }
        return base;
      },
    },
    {
      headerName: todayColumnHeader,
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      comparator: tailComparator,
      cellRenderer: (params: any) => {
        if (isGamesMetric) {
          const avg = parseTailAverage(params.value);
          if (avg === null) return params.value;
          return avg.toLocaleString();
        }
        const parsed = parseTailCell(params.value);
        if (!parsed) return params.value;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
            <span>{parsed.avg}</span>
            <span style={{ fontSize: '0.7em' }}>{(parsed.winRate * 100).toFixed(1)}%</span>
            <span style={{ fontSize: '0.65em' }}>{parsed.ratio}</span>
          </div>
        );
      },
      cellStyle: (params) => {
        const v = params.value;
        const parsed = parseTailCell(v);
        let color = '#333';
        const avg = parseTailAverage(v);
        if (avg !== null) {
          color = avg >= 0 ? '#4c6cb3' : '#d9333f';
        }
        const base: any = {
          color,
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          whiteSpace: 'normal',
          borderRight: '1px solid #ccc',
          backgroundColor: '#fff7cc',
        };
        if (isMissingLatest(params.data)) {
          base.backgroundColor = '#e0e0e0';
          base.color = '#666';
        } else if (isGamesMetric) {
          if (avg !== null) {
            base.backgroundColor = getGamesHeatmapColor(avg, 'todayDiff') ?? '#fff7cc';
          }
        } else if (parsed) {
          base.backgroundColor = getWinRateHeatmapColor(parsed.winRate) ?? '#fff7cc';
        }
        return base;
      },
    },
    ...dynamicCols,
  ];
}

function getPastDates(days: number, offset: number): string[] {
  return Array.from({ length: days }, (_, i) =>
    dayjs().subtract(i + offset, 'day').format('YYYYMMDD')
  );
}

function formatDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6)}`;
}

function formatGroupedMetricCell(sum: number, count: number, positiveCount: number): string {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) return '-';
  const avg = Math.round(sum / count);
  return `${avg}(${positiveCount}/${count})`;
}

function parseGroupedMetricCell(value: any): { avg: number; ratio: string; winRate: number } | null {
  if (typeof value === 'string') {
    const m = value.match(/^(-?\d+)\((\d+)\/(\d+)\)$/);
    if (!m) return null;
    const avg = Number(m[1]);
    const positive = Number(m[2]);
    const count = Number(m[3]);
    if (!Number.isFinite(avg) || !Number.isFinite(positive) || !Number.isFinite(count) || count <= 0) {
      return null;
    }
    return { avg, ratio: `(${positive}/${count})`, winRate: positive / count };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      avg: value,
      ratio: value > 0 ? '(1/1)' : '(0/1)',
      winRate: value > 0 ? 1 : 0,
    };
  }
  return null;
}

function applyGroupedDateMetricCells(rows: any[], allData: Record<string, any>): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const dates = Object.keys(allData ?? {});
  if (dates.length === 0) return rows;

  const perDateByName: Record<string, Record<string, { sum: number; count: number; positiveCount: number }>> = {};
  const perDateTotal: Record<string, { sum: number; count: number; positiveCount: number }> = {};

  dates.forEach((date) => {
    const day = allData?.[date] ?? {};
    const byName: Record<string, { sum: number; count: number; positiveCount: number }> = {};
    let totalSum = 0;
    let totalCount = 0;
    let totalPositiveCount = 0;

    Object.values(day).forEach((item: any) => {
      const name = String(item?.name ?? '');
      const diff = item?.diff;
      if (!name || typeof diff !== 'number') return;
      if (!byName[name]) byName[name] = { sum: 0, count: 0, positiveCount: 0 };
      byName[name].sum += diff;
      byName[name].count += 1;
      if (diff > 0) byName[name].positiveCount += 1;

      totalSum += diff;
      totalCount += 1;
      if (diff > 0) totalPositiveCount += 1;
    });

    perDateByName[date] = byName;
    perDateTotal[date] = { sum: totalSum, count: totalCount, positiveCount: totalPositiveCount };
  });

  return rows.map((row) => {
    if (!row) return row;
    const next = { ...row };

    dates.forEach((date) => {
      if (row?.isTotalRow) {
        const t = perDateTotal[date];
        next[date] = t && t.count > 0
          ? formatGroupedMetricCell(t.sum, t.count, t.positiveCount)
          : '-';
        return;
      }

      const name = String(row?.name ?? row?.modelName ?? '');
      const m = perDateByName[date]?.[name];
      next[date] = m && m.count > 0
        ? formatGroupedMetricCell(m.sum, m.count, m.positiveCount)
        : '-';
    });

    return next;
  });
}

function mergeRowData(prev: any[], next: any[]): any[] {
  const merged: Record<string, any> = {};
  for (const row of prev) merged[row.id] = { ...row };

  for (const row of next) {
    if (!merged[row.id]) {
      merged[row.id] = { ...row };
    } else {
      const mergedRow = merged[row.id];
      for (const key of Object.keys(row)) {
        if (key !== 'flag' && key !== 'urls' && key !== 'comments') {
          mergedRow[key] = row[key];
        }
      }
      mergedRow.flag = {
        ...row.flag,
        ...mergedRow.flag, // 既存のユーザー更新を優先
      };
      mergedRow.urls = {
        ...row.urls,
        ...mergedRow.urls, // 既存のユーザー更新を優先
      };
      mergedRow.comments = {
        ...row.comments,
        ...mergedRow.comments, // 既存のユーザー更新を優先
      };
    }
  }

  return Object.values(merged);
}

function applyTodayDiffToRows(
  rows: any[],
  todayDiffMap: Record<string, number>,
  todaySnapshotDateKey: string
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const normalizedMap = todayDiffMap ?? {};
  const snapshotBase = /^\d{8}$/.test(todaySnapshotDateKey)
    ? `${todaySnapshotDateKey.slice(0, 4)}-${todaySnapshotDateKey.slice(4, 6)}-${todaySnapshotDateKey.slice(6, 8)}`
    : dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
  const prevDayKey = dayjs(snapshotBase).subtract(1, 'day').format('YYYYMMDD');

  let total = 0;
  let hasTotal = false;

  const mapped = rows.map((row) => {
    if (!row) return row;
    if (row.isTotalRow) return { ...row, todayDiff: '-' };

    const machineKey = String(row.machineNumber ?? '');
    const prevDayValue = row?.[prevDayKey];
    const hasPrevDayValue = !(prevDayValue === undefined || prevDayValue === null || prevDayValue === '-');
    if (!hasPrevDayValue) {
      return { ...row, todayDiff: '-' };
    }
    const diff = normalizedMap[machineKey];
    const todayDiff = Number.isFinite(diff) ? diff : '-';
    if (typeof todayDiff === 'number') {
      total += todayDiff;
      hasTotal = true;
    }
    return { ...row, todayDiff };
  });

  return mapped.map((row) => {
    if (!row?.isTotalRow) return row;
    return {
      ...row,
      todayDiff: hasTotal ? total : '-',
    };
  });
}

function applyTodayDiffToGroupedRows(
  groupedRows: any[],
  numberRows: any[],
  latestDate: string,
  includeStats: boolean
): any[] {
  if (!Array.isArray(groupedRows) || groupedRows.length === 0) return groupedRows;
  if (!Array.isArray(numberRows) || numberRows.length === 0) {
    return groupedRows.map((row) => ({ ...row, todayDiff: '-', machineNumbers: [] }));
  }

  const hasLatestData = (row: any): boolean => {
    if (!latestDate) return true;
    const v = row?.[latestDate];
    return !(v === undefined || v === null || v === '-');
  };

  const sumByName: Record<string, number> = {};
  const countByName: Record<string, number> = {};
  const positiveByName: Record<string, number> = {};
  const machineNumbersByName: Record<string, string[]> = {};
  let totalSum = 0;
  let totalCount = 0;
  let totalPositive = 0;

  numberRows.forEach((row) => {
    if (!row || row.isTotalRow) return;
    if (!hasLatestData(row)) return;
    const name = String(row.name ?? '');
    const machineKey = String(row.machineNumber ?? '').trim();
    if (name && machineKey) {
      const list = machineNumbersByName[name] ?? (machineNumbersByName[name] = []);
      if (!list.includes(machineKey)) list.push(machineKey);
    }
    const diff = row.todayDiff;
    if (!name || typeof diff !== 'number') return;
    sumByName[name] = (sumByName[name] ?? 0) + diff;
    countByName[name] = (countByName[name] ?? 0) + 1;
    if (diff > 0) positiveByName[name] = (positiveByName[name] ?? 0) + 1;
    totalSum += diff;
    totalCount += 1;
    if (diff > 0) totalPositive += 1;
  });

  return groupedRows.map((row) => {
    if (!row) return row;
    if (row.isTotalRow) {
      const totalAvg = totalCount > 0 ? Math.round(totalSum / totalCount) : '-';
      return {
        ...row,
        todayDiff: includeStats
          ? (totalCount > 0 ? formatGroupedMetricCell(totalSum, totalCount, totalPositive) : '-')
          : totalAvg,
        machineNumbers: [],
      };
    }
    const name = String(row.name ?? row.modelName ?? '');
    const count = countByName[name] ?? 0;
    const machineNumbers = [...(machineNumbersByName[name] ?? [])].sort((a, b) => {
      const ai = Number(a);
      const bi = Number(b);
      if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
      return a.localeCompare(b, 'ja');
    });
    if (count <= 0) return { ...row, todayDiff: '-', machineNumbers };
    const avg = Math.round((sumByName[name] ?? 0) / count);
    return {
      ...row,
      todayDiff: includeStats
        ? formatGroupedMetricCell(sumByName[name] ?? 0, count, positiveByName[name] ?? 0)
        : avg,
      machineNumbers,
    };
  });
}

function applyTodayDiffToTailRows(tailRows: any[], numberRows: any[], includeStats: boolean): any[] {
  if (!Array.isArray(tailRows) || tailRows.length === 0) return tailRows;
  if (!Array.isArray(numberRows) || numberRows.length === 0) {
    return tailRows.map((row) => ({ ...row, todayDiff: '-' }));
  }

  const labels = [
    '末尾0', '末尾1', '末尾2', '末尾3', '末尾4',
    '末尾5', '末尾6', '末尾7', '末尾8', '末尾9',
    'ゾロ目',
  ];
  const sums = Array.from({ length: labels.length }, () => ({ sum: 0, count: 0, positiveCount: 0 }));

  const getMachineNumber = (item: any): number | null => {
    const raw = item?.machineNumber;
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const isZorome = (machineNumber: number) => {
    const twoDigits = Math.abs(machineNumber % 100).toString().padStart(2, '0');
    return twoDigits[0] === twoDigits[1];
  };

  numberRows.forEach((row) => {
    if (!row || row.isTotalRow) return;
    const machineNumber = getMachineNumber(row);
    const diff = row.todayDiff;
    if (machineNumber == null || typeof diff !== 'number') return;

    const tail = Math.abs(machineNumber % 10);
    sums[tail].sum += diff;
    sums[tail].count += 1;
    if (diff > 0) sums[tail].positiveCount += 1;

    if (isZorome(machineNumber)) {
      sums[10].sum += diff;
      sums[10].count += 1;
      if (diff > 0) sums[10].positiveCount += 1;
    }
  });

  return tailRows.map((row) => {
    const idx = labels.indexOf(String(row?.tailLabel ?? ''));
    if (idx < 0) return { ...row, todayDiff: '-' };
    const g = sums[idx];
    if (!g || g.count <= 0) return { ...row, todayDiff: '-' };
    const avg = Math.round(g.sum / g.count);
    return {
      ...row,
      todayDiff: includeStats ? `${avg}(${g.positiveCount}/${g.count})` : avg,
    };
  });
}


// ★ 追加：少なくとも1件データのある最新日付を返す
function pickEffectiveLatestDate(
  allData: Record<string, any>,  // rawMapRef.current を想定（YYYYMMDD => { dataKey: item })
  candidateDates: string[]
): string | null {
  // 候補日を「新しい順」に
  const sorted = [...candidateDates].sort((a, b) => b.localeCompare(a));
  for (const d of sorted) {
    const dayMap = allData[d] || {};
    // “データあり”の定義：diff が数値 or 0（0もデータとして扱う想定）
    const hasAny = Object.values(dayMap).some((it: any) => {
      const v = it?.diff;
      return v !== undefined && v !== null && v !== '-';
    });
    if (hasAny) return d;
  }
  return null;
}

// 既存：最新欠損を下へ（effectiveLatestDate が空なら何もしない）
function sortByLatestMissing(rows: any[], latestDate: string): any[] {
  if (!Array.isArray(rows) || rows.length === 0 || !latestDate) return rows;

  const isMissing = (row: any) => {
    const v = row?.[latestDate];
    // “欠損”の定義：undefined / null / '-'（0 はデータ扱い）
    return v === undefined || v === null || v === '-';
  };

  const total = rows.find(r => r?.isTotalRow);
  const others = rows.filter(r => !r?.isTotalRow);

  others.sort((a: any, b: any) => {
    const aMissing = isMissing(a);
    const bMissing = isMissing(b);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;

    const am = Number(a.machineNumber);
    const bm = Number(b.machineNumber);
    if (Number.isFinite(am) && Number.isFinite(bm)) return am - bm;

    return String(a.machineNumber).localeCompare(String(b.machineNumber), 'ja') ||
           String(a.name).localeCompare(String(b.name), 'ja');
  });

  return total ? [total, ...others] : others;
}

// ★ 追加：台番昇順（フォールバック用）
function sortByMachineNumber(rows: any[]): any[] {
  const total = rows.find(r => r?.isTotalRow);
  const others = rows.filter(r => !r?.isTotalRow);

  others.sort((a: any, b: any) => {
    const am = Number(a.machineNumber);
    const bm = Number(b.machineNumber);
    if (Number.isFinite(am) && Number.isFinite(bm)) return am - bm;
    return String(a.machineNumber).localeCompare(String(b.machineNumber), 'ja') ||
           String(a.name).localeCompare(String(b.name), 'ja');
  });

  return total ? [total, ...others] : others;
}

