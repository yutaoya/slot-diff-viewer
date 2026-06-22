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
import { Modal } from 'antd';
import { FormControl, MenuItem, Select } from '@mui/material';
import { SelectChangeEvent } from '@mui/material/Select';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { Button } from '@mui/material';
import {
  type DisplayMetric,
  applyGroupedDateMetricCells,
  applyTodayDiffToGroupedRows,
  applyTodayDiffToRows,
  applyTodayDiffToTailRows,
  buildGroupedColumnsForDates,
  buildNumberColumns,
  buildTailColumnsForDates,
  getPastDates,
  mergeRowData,
  parseGroupedMetricCell,
  pickEffectiveLatestDate,
  sortByLatestMissing,
  sortByMachineNumber,
} from './features/slotDiffGrid/gridUtils';
import type { GridUiStateSnapshot, TodayGalleryItem, TodayOatariHistoryRow, TodaySnapshotItem, ViewMode } from './features/slotDiffGrid/types';
import { Android12LineSpacingSwitch } from './features/slotDiffGrid/Android12LineSpacingSwitch';
import { buildTodayGalleryStats } from './features/slotDiffGrid/todayGalleryStats';
import { exportSlotAnalyticsJson } from './features/slotDiffGrid/gridAnalyticsExportUtils';
import {
  applyJugglerSettingHeatmapScoresToGroupedRows,
  applyJugglerSettingHeatmapScoresToNumberRows,
  averageJugglerSettingHeatmapScore,
  buildJugglerSettingHeatmapScoreMap,
  buildJugglerSettingHeatmapScoreMapsByDate,
  getJugglerSettingHeatmapScoreFromRow,
  getJugglerSettingHeatmapColorByScore,
} from './features/slotDiffGrid/jugglerSettingHeatmap';
import {
  fetchNameCombineMap,
  fetchSnapshotDetailFromOatariSubcollection,
  fetchOatariHistorySubcollection,
  fetchShortNameMap,
  fetchSlotDiffDateData,
  fetchTodaySnapshotDetailMap,
  fetchTooltipMapsByStoreId,
  updateModelModeFlagsAndComment,
  updateNumberModeFlagsAndComment,
} from './features/slotDiffGrid/slotDiffRepository';
import { FlagSettingModal } from './features/slotDiffGrid/components/FlagSettingModal';
import { JugglerSettingEstimatePanel } from './features/slotDiffGrid/components/JugglerSettingEstimatePanel';
import { MachineDataModal } from './features/slotDiffGrid/components/MachineDataModal';
import { FloorMapView, type FloorMapDateOption, type FloorMapMachineData } from './features/slotDiffGrid/components/FloorMapView';

dayjs.extend(utc);
dayjs.extend(timezone);

// AG Grid モジュール登録
ModuleRegistry.registerModules([ClientSideRowModelModule, RowStyleModule, CellStyleModule]);

const JugglerHeatmapIcon: React.FC<{ active: boolean }> = ({ active }) => {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden="true"
      style={{
        display: 'block',
        width: 20,
        height: 20,
        overflow: 'hidden',
        color: active ? '#fff' : '#7c8797',
        fontSize: 20,
        lineHeight: '20px',
        fontVariationSettings: "'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 20",
      }}
    >
      mode_heat
    </span>
  );
};

const ExportShareIcon: React.FC = () => {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{
        display: 'block',
      }}
    >
      <path
        d="M12 4v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M7.5 8.5 12 4l4.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 13.5V19h12v-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const footerToolbarShellStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '0 0 calc(10px + env(safe-area-inset-bottom))',
  borderTop: '1px solid #d7dde4',
  background: '#eef2f6',
  overflow: 'hidden',
};

const footerToolbarScrollerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  minHeight: 34,
  overflowX: 'auto',
  overflowY: 'hidden',
  WebkitOverflowScrolling: 'touch',
  overscrollBehaviorX: 'contain',
  touchAction: 'pan-x',
  whiteSpace: 'nowrap',
  background: '#fff',
  borderLeft: '1px solid #d7dde4',
  borderBottom: '1px solid #d7dde4',
};

const footerToolbarBlockStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: 34,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  padding: 0,
  border: 'none',
  borderRight: '1px solid #d7dde4',
  borderRadius: 0,
  background: '#fff',
  overflow: 'hidden',
};

const machineFilterBlockStyle: React.CSSProperties = {
  ...footerToolbarBlockStyle,
  minWidth: 0,
};

const machineSelectFormStyle: React.CSSProperties = {
  width: 'clamp(112px, 36vw, 190px)',
  minWidth: 0,
  flexShrink: 1,
};

const footerNativeButtonStyle: React.CSSProperties = {
  height: 34,
  minWidth: 30,
  padding: '0 8px',
  border: 'none',
  borderRadius: 0,
  background: 'transparent',
  color: '#172033',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
};

const footerZoomValueStyle: React.CSSProperties = {
  minWidth: 44,
  height: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  color: '#172033',
  fontSize: 12,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const heatmapButtonSx = (active: boolean) => ({
  flexShrink: 0,
  minWidth: 0,
  width: 34,
  height: 34,
  padding: 0,
  border: 0,
  borderRadius: 0,
  backgroundColor: active ? '#d32f2f' : 'transparent',
  color: active ? '#fff' : '#5f6877',
  boxShadow: 'none',
  '&:hover': {
    border: 0,
    backgroundColor: active ? '#c62828' : '#e8edf3',
    boxShadow: 'none',
  },
});

const metricToggleButtonSx = {
  flexShrink: 0,
  height: 34,
  minWidth: 56,
  padding: '0 8px',
  border: 0,
  borderRadius: 0,
  textTransform: 'none',
  whiteSpace: 'nowrap',
  fontSize: '0.78rem',
  fontWeight: 700,
  color: '#1565c0',
  '&:hover': {
    border: 0,
    backgroundColor: 'rgba(100,181,246,0.12)',
  },
};

const exportButtonSx = {
  flexShrink: 0,
  minWidth: 0,
  height: 34,
  width: 34,
  padding: 0,
  border: 0,
  borderRadius: 0,
  textTransform: 'none',
  backgroundColor: '#455a64',
  color: '#fff',
  '&:hover': {
    backgroundColor: '#37474f',
  },
};

const refreshButtonSx = {
  flexShrink: 0,
  minWidth: 0,
  height: 34,
  width: 34,
  padding: 0,
  border: 0,
  borderRadius: 0,
  textTransform: 'none',
  backgroundColor: '#1976d2',
  color: '#fff',
  '&:hover': {
    backgroundColor: '#1565c0',
  },
  '&.Mui-disabled': {
    backgroundColor: '#90caf9',
    color: '#fff',
  },
};

interface Props {
  storeId: string;
}

type HistoryDebugEvent = {
  at: number;
  label: string;
  meta?: Record<string, unknown>;
};

const HISTORY_DEBUG_EVENT_LIMIT = 80;

const isHistoryDebugEnabled = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has('historyDebug')) return true;
  try {
    return window.localStorage.getItem('slotHistoryDebug') === '1';
  } catch {
    return false;
  }
};

const stringifyHistoryDebugMeta = (meta?: Record<string, unknown>) => {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
};

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
  const [refreshing, setRefreshing] = useState(false);
  const scrollReady = useRef(false);
  const didInitRef = useRef(false);

  const [viewMode, setViewMode] = useState<ViewMode>('number');
  const viewModeRef = useRef<ViewMode>('number');
  const [displayMetric, setDisplayMetric] = useState<DisplayMetric>('diff');
  const displayMetricRef = useRef<DisplayMetric>('diff');
  const [showJugglerHeatmap, setShowJugglerHeatmap] = useState(false);
  const showJugglerHeatmapRef = useRef(false);
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
  const [flagModalModeOverride, setFlagModalModeOverride] = useState<ViewMode | null>(null);
  const [flagModalSaving, setFlagModalSaving] = useState(false);
  const [flagModalDetailSnapshot, setFlagModalDetailSnapshot] = useState<TodaySnapshotItem | null>(null);
  const [flagModalDetailDateKey, setFlagModalDetailDateKey] = useState('');
  const [flagModalDetailHistoryRows, setFlagModalDetailHistoryRows] = useState<TodayOatariHistoryRow[]>([]);
  const [flagModalDetailHistoryLoading, setFlagModalDetailHistoryLoading] = useState(false);
  const [flagModalDetailHistoryCount, setFlagModalDetailHistoryCount] = useState<number | null>(null);
  const [flagModalDetailGalleryItems, setFlagModalDetailGalleryItems] = useState<
    Array<{ machineKey: string; snapshot: TodaySnapshotItem; historyRows: TodayOatariHistoryRow[]; historyCount: number }>
  >([]);
  const [flagModalReturnContext, setFlagModalReturnContext] = useState<{
    selectedCell: { rowData: any; field: string; value: any };
    selectedCellUrl: string | null;
    machineKeys: string[];
  } | null>(null);
  const flagModalDetailReqRef = useRef(0);
  const flagModalMachineOrderOverrideRef = useRef<string[]>([]);
  const [todayDetailModalOpen, setTodayDetailModalOpen] = useState(false);
  const [todayDetailItem, setTodayDetailItem] = useState<TodaySnapshotItem | null>(null);
  const [todayDetailMachineKey, setTodayDetailMachineKey] = useState<string | null>(null);
  const [todayDetailFromGallery, setTodayDetailFromGallery] = useState(false);
  const [todayGalleryModalOpen, setTodayGalleryModalOpen] = useState(false);
  const [todayGalleryTitle, setTodayGalleryTitle] = useState('');
  const [todayGalleryItems, setTodayGalleryItems] = useState<TodayGalleryItem[]>([]);
  const [todayDetailAnimName, setTodayDetailAnimName] = useState<'none' | 'slideLeft' | 'slideRight'>('none');
  const [todayDetailAnimTick, setTodayDetailAnimTick] = useState(0);
  const [todaySwipeHintDx, setTodaySwipeHintDx] = useState(0);
  const [todayOatariHistoryRows, setTodayOatariHistoryRows] = useState<TodayOatariHistoryRow[]>([]);
  const [todayOatariHistoryLoading, setTodayOatariHistoryLoading] = useState(false);
  const [todayOatariHistoryCount, setTodayOatariHistoryCount] = useState<number | null>(null);
  const todayOatariHistoryReqRef = useRef(0);
  const todayMachineOrderRef = useRef<string[]>([]);
  const historyDebugEnabledRef = useRef(false);
  const [historyDebugEvents, setHistoryDebugEvents] = useState<HistoryDebugEvent[]>([]);


  // 機種名フィルタ
  const [selectedName, setSelectedName] = useState<string>("");

  // 読み込み済みの「生データ（date => map）」を保持（機種別集計に使用）
  const rawMapRef = useRef<Record<string, any>>({});
  const tooltipColorMapRef = useRef<Record<string, string>>({});
  const tooltipTextMapRef = useRef<Record<string, string>>({});
  const [tooltipMapVersion, setTooltipMapVersion] = useState(0);
  const nameCombineMapRef = useRef<Record<string, string>>({});
  const floorMapShortNameMapRef = useRef<Record<string, string>>({});
  const todaySnapshotMapRef = useRef<Record<string, TodaySnapshotItem>>({});
  const todaySettingHeatmapScoreMapRef = useRef<Record<string, number>>({});
  const [todayDiffMap, setTodayDiffMap] = useState<Record<string, number>>({});
  const [todaySnapshotDateKey, setTodaySnapshotDateKey] = useState('');
  const todaySnapshotDocIdRef = useRef('');
  const [todayColumnHeader, setTodayColumnHeader] = useState('本日');
  const [hasTodayDiffData, setHasTodayDiffData] = useState(false);
  const [nameMapReady, setNameMapReady] = useState(false);
  const [floorMapShortNameVersion, setFloorMapShortNameVersion] = useState(0);
  const lastHorizontalScrollLeftRef = useRef(0);
  // タブ/表示指標切替前後でソート・スクロール状態を引き継ぐためのスナップショット
  const gridUiStateByKeyRef = useRef<Record<string, GridUiStateSnapshot>>({});
  const pendingGridUiRestoreRef = useRef<GridUiStateSnapshot | null>(null);
  const flagModalEffectiveMode: ViewMode = flagModalModeOverride ?? viewMode;

  const rowDataRef = useRef<any[]>([]);  // ★ 追加
  const pendingScrollRestoreRef = useRef<number | null>(null);

  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [machineUrl, setMachineUrl] = useState<string | null>(null);
  const [machineTooltip, setMachineTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const machineTooltipRef = useRef<HTMLDivElement | null>(null);
  const [hasFloorMap, setHasFloorMap] = useState(false);
  const [selectedFloorMapDateField, setSelectedFloorMapDateField] = useState('');
  const [floorMapScale, setFloorMapScale] = useState(1);
  const floorMapUrl = `/${storeId}/floormap.html`;

  useEffect(() => {
    const enabled = isHistoryDebugEnabled();
    historyDebugEnabledRef.current = enabled;
    if (!enabled) return;
    setHistoryDebugEvents([]);
    (window as any).__slotHistoryDebugEvents = [];
  }, []);

  const pushHistoryDebugEvent = useCallback((label: string, meta?: Record<string, unknown>) => {
    if (!historyDebugEnabledRef.current) return;
    const event: HistoryDebugEvent = {
      at: Math.round(performance.now()),
      label,
      meta,
    };
    setHistoryDebugEvents((prev) => {
      const next = [...prev, event].slice(-HISTORY_DEBUG_EVENT_LIMIT);
      (window as any).__slotHistoryDebugEvents = next;
      return next;
    });
    // eslint-disable-next-line no-console
    console.info('[history-debug]', label, meta ?? {});
  }, []);

  const resolveDisplayName = useCallback((name: string) => {
    const raw = String(name ?? '').trim();
    if (!raw) return '';
    return nameCombineMapRef.current[raw] ?? raw;
  }, []);

  const resolveFloorMapDisplayName = useCallback((name: string) => {
    const raw = String(name ?? '').trim();
    if (!raw) return '';
    const normalized = resolveDisplayName(raw);
    return floorMapShortNameMapRef.current[normalized] ?? floorMapShortNameMapRef.current[raw] ?? normalized;
  }, [resolveDisplayName]);

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

  const normalizeEstimateMachineName = useCallback((value: unknown): string => (
    resolveDisplayName(String(value ?? ''))
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase()
  ), [resolveDisplayName]);

  const parseEstimateNumber = useCallback((value: unknown): number | null => {
    const parsed = toNumericValue(value);
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
  }, [toNumericValue]);

  const findPastSlotDiffItemForEstimate = useCallback((
    dateField: string,
    machineKey: string,
    machineName: unknown
  ): any | null => {
    const dateData = rawMapRef.current?.[dateField];
    if (!dateData || typeof dateData !== 'object') return null;

    const targetMachineKey = String(machineKey ?? '').trim();
    const targetName = normalizeEstimateMachineName(machineName);
    const entries = Array.isArray(dateData)
      ? dateData.map((item, index) => [String(index), item] as const)
      : Object.entries(dateData);

    const byMachineAndName = entries.find(([key, item]: any) => {
      if (!item || typeof item !== 'object') return false;
      const itemMachineKey = String(item?.machineNumber ?? key ?? '').trim();
      const itemName = normalizeEstimateMachineName(item?.name ?? item?.modelName);
      return itemMachineKey === targetMachineKey && !!targetName && itemName === targetName;
    });
    if (byMachineAndName) return byMachineAndName[1];

    const byMachine = entries.find(([key, item]: any) => {
      if (!item || typeof item !== 'object') return false;
      return String(item?.machineNumber ?? key ?? '').trim() === targetMachineKey;
    });
    return byMachine?.[1] ?? null;
  }, [normalizeEstimateMachineName]);

  const mergeSlotDiffEstimateFields = useCallback((
    dateField: string,
    machineKey: string,
    fallbackSnapshot: TodaySnapshotItem | null,
    fallbackName: unknown
  ): TodaySnapshotItem | null => {
    const slotDiffItem = findPastSlotDiffItemForEstimate(
      dateField,
      machineKey,
      fallbackSnapshot?.name ?? fallbackName
    );
    if (!slotDiffItem) return fallbackSnapshot;

    const games = parseEstimateNumber(slotDiffItem?.games ?? slotDiffItem?.totalGameCount);
    const bb = parseEstimateNumber(slotDiffItem?.bb ?? slotDiffItem?.bbCount);
    const rb = parseEstimateNumber(slotDiffItem?.rb ?? slotDiffItem?.rbCount);
    const diff = parseEstimateNumber(slotDiffItem?.diff ?? slotDiffItem?.currentDifference);
    const hasSlotDiffEstimateFields = [games, bb, rb, diff].some((value) => value !== null);
    if (!hasSlotDiffEstimateFields) return fallbackSnapshot;

    return {
      ...(fallbackSnapshot ?? {}),
      machineNumber: fallbackSnapshot?.machineNumber ?? slotDiffItem?.machineNumber ?? machineKey,
      name: fallbackSnapshot?.name ?? slotDiffItem?.name ?? fallbackName,
      currentDifference: diff !== null ? diff : fallbackSnapshot?.currentDifference,
      totalGameCount: games !== null ? String(games) : fallbackSnapshot?.totalGameCount,
      bbCount: bb !== null ? String(bb) : fallbackSnapshot?.bbCount,
      rbCount: rb !== null ? String(rb) : fallbackSnapshot?.rbCount,
      bbProbability: slotDiffItem?.bbProbability ?? fallbackSnapshot?.bbProbability,
      rbProbability: slotDiffItem?.rbProbability ?? fallbackSnapshot?.rbProbability,
      combinedProbability: slotDiffItem?.combinedProbability ?? fallbackSnapshot?.combinedProbability,
    };
  }, [findPastSlotDiffItemForEstimate, parseEstimateNumber]);

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

  useEffect(() => {
    let cancelled = false;
    setHasFloorMap(false);
    fetch(floorMapUrl, { method: 'GET', cache: 'force-cache' })
      .then((res) => {
        if (!cancelled) setHasFloorMap(res.ok);
      })
      .catch(() => {
        if (!cancelled) setHasFloorMap(false);
      });
    return () => {
      cancelled = true;
    };
  }, [floorMapUrl]);

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
    // 現在の「列状態(ソート含む)」「縦/横スクロール位置」を保存
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
    // 切替先キーに保存済み状態があればそれを優先し、なければ直前状態をフォールバック利用
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
      // 列状態を先に戻すことで、ソート/列順の再現を先に確定させる
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
        const { colorMap, textMap } = await fetchTooltipMapsByStoreId(storeId);
        if (cancelled) return;
        tooltipColorMapRef.current = colorMap;
        tooltipTextMapRef.current = textMap;
        setTooltipMapVersion((v) => v + 1);
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
        const [next, shortNameMap] = await Promise.all([
          fetchNameCombineMap(),
          fetchShortNameMap(),
        ]);
        if (cancelled) return;
        nameCombineMapRef.current = next;
        floorMapShortNameMapRef.current = shortNameMap;
        setFloorMapShortNameVersion((v) => v + 1);
        gridRef.current?.api?.refreshCells({ force: true });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load config name maps:', error);
      } finally {
        if (!cancelled) setNameMapReady(true);
      }
    };

    void loadNameCombineMap();
    return () => {
      cancelled = true;
    };
  }, [resolveDisplayName]);

  const loadTodaySnapshotData = useCallback(async (isCancelled?: () => boolean) => {
    try {
      todaySettingHeatmapScoreMapRef.current = {};
      const nowJst = dayjs().tz('Asia/Tokyo');
      const todayKey = nowJst.hour() < 8
        ? nowJst.subtract(1, 'day').format('YYYYMMDD')
        : nowJst.format('YYYYMMDD');
      const currentKey = nowJst.format('YYYYMMDD');
      const nextHeader = todayKey === currentKey ? '本日' : '前日';
      if (isCancelled?.()) return;
      setTodaySnapshotDateKey(todayKey);
      setTodayColumnHeader(nextHeader);
      const snapshotId = `${storeId}_${todayKey}`;
      todaySnapshotDocIdRef.current = snapshotId;
      const snapshotResult = await fetchTodaySnapshotDetailMap(snapshotId);
      if (isCancelled?.()) return;
      if (!snapshotResult.exists) {
        setTodayDiffMap({});
        setHasTodayDiffData(false);
        todaySnapshotMapRef.current = {};
        todaySettingHeatmapScoreMapRef.current = {};
        todaySnapshotDocIdRef.current = '';
        return;
      }

      const detailMap = snapshotResult.detailMap;
      const nextMap = buildTodayMetricMapFromSnapshot(detailMap, displayMetricRef.current);
      setTodayDiffMap(nextMap);
      setHasTodayDiffData(Object.keys(nextMap).length > 0);
      todaySnapshotMapRef.current = detailMap;
      todaySettingHeatmapScoreMapRef.current = buildJugglerSettingHeatmapScoreMap(detailMap);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load site777Snapshots:', error);
      if (isCancelled?.()) return;
      setTodayDiffMap({});
      setHasTodayDiffData(false);
      todaySnapshotMapRef.current = {};
      todaySettingHeatmapScoreMapRef.current = {};
      setTodaySnapshotDateKey('');
      todaySnapshotDocIdRef.current = '';
      setTodayColumnHeader('本日');
    }
  }, [buildTodayMetricMapFromSnapshot, storeId]);

  useEffect(() => {
    let cancelled = false;
    void loadTodaySnapshotData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadTodaySnapshotData]);

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
      if (flagModalEffectiveMode === 'model') {
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
  }, [flagModalEffectiveMode, modalOpen, selectedCell, resolveDisplayName]);

  useEffect(() => {
    if (!modalOpen) return;
    pushHistoryDebugEvent('past modal render state', {
      field: selectedCell?.field ?? '',
      machine: selectedCell?.rowData?.machineNumber ?? '',
      mode: flagModalEffectiveMode,
      loading: flagModalDetailHistoryLoading,
      rows: flagModalDetailHistoryRows.length,
      count: flagModalDetailHistoryCount,
      hasSnapshot: !!flagModalDetailSnapshot,
      galleryItems: flagModalDetailGalleryItems.length,
    });
  }, [
    flagModalDetailGalleryItems.length,
    flagModalDetailHistoryCount,
    flagModalDetailHistoryLoading,
    flagModalDetailHistoryRows.length,
    flagModalDetailSnapshot,
    flagModalEffectiveMode,
    modalOpen,
    pushHistoryDebugEvent,
    selectedCell,
  ]);

  useEffect(() => {
    if (!todayDetailModalOpen) return;
    pushHistoryDebugEvent('today modal render state', {
      machine: todayDetailMachineKey ?? '',
      loading: todayOatariHistoryLoading,
      rows: todayOatariHistoryRows.length,
      count: todayOatariHistoryCount,
      hasSnapshot: !!todayDetailItem,
    });
  }, [
    pushHistoryDebugEvent,
    todayDetailItem,
    todayDetailMachineKey,
    todayDetailModalOpen,
    todayOatariHistoryCount,
    todayOatariHistoryLoading,
    todayOatariHistoryRows.length,
  ]);

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
    if (viewMode === 'floor') return rowData;
    if (!selectedName) return rowData;
    return rowData.filter((r) => (r.name ?? r.modelName) === selectedName);
  }, [selectedName, rowData, viewMode]);

  const floorMapDateField = useMemo(() => {
    const loaded = Array.from(loadedDates).sort();
    if (loaded.length === 0) return '';
    return pickEffectiveLatestDate(rawMapRef.current, loaded) || loaded[loaded.length - 1] || '';
  }, [loadedDates]);

  const floorMapDateOptions = useMemo<FloorMapDateOption[]>(() => {
    const dateOptions = Array.from(loadedDates)
      .sort((a, b) => b.localeCompare(a))
      .map((dateKey) => ({
        field: dateKey,
        label: `${dateKey.slice(4, 6)}/${dateKey.slice(6)}`,
      }));
    return hasTodayDiffData
      ? [{ field: 'todayDiff', label: todayColumnHeader }, ...dateOptions]
      : dateOptions;
  }, [hasTodayDiffData, loadedDates, todayColumnHeader]);

  const defaultFloorMapDateField = hasTodayDiffData ? 'todayDiff' : floorMapDateField;
  const floorMapActiveDateField = useMemo(() => {
    const fields = new Set(floorMapDateOptions.map((option) => option.field));
    if (selectedFloorMapDateField && fields.has(selectedFloorMapDateField)) {
      return selectedFloorMapDateField;
    }
    if (defaultFloorMapDateField && fields.has(defaultFloorMapDateField)) {
      return defaultFloorMapDateField;
    }
    return floorMapDateOptions[0]?.field ?? '';
  }, [defaultFloorMapDateField, floorMapDateOptions, selectedFloorMapDateField]);

  useEffect(() => {
    if (selectedFloorMapDateField === floorMapActiveDateField) return;
    setSelectedFloorMapDateField(floorMapActiveDateField);
  }, [floorMapActiveDateField, selectedFloorMapDateField]);

  const getTodaySettingHeatmapColor = useCallback((row: any) => {
    if (!row || row.isTotalRow) return undefined;
    const machineNumbers = Array.isArray(row?.machineNumbers)
      ? row.machineNumbers
      : row?.machineNumber != null
        ? [row.machineNumber]
        : [];
    const score = averageJugglerSettingHeatmapScore(machineNumbers, todaySettingHeatmapScoreMapRef.current);
    return getJugglerSettingHeatmapColorByScore(score);
  }, []);

  const getSettingHeatmapColor = useCallback((row: any, field: string) => {
    if (!showJugglerHeatmapRef.current) return undefined;
    if (field === 'todayDiff') {
      return getTodaySettingHeatmapColor(row);
    }
    const score = getJugglerSettingHeatmapScoreFromRow(row, field);
    return getJugglerSettingHeatmapColorByScore(score);
  }, [getTodaySettingHeatmapColor]);

  const handleToggleJugglerHeatmap = useCallback(() => {
    const next = !showJugglerHeatmapRef.current;
    showJugglerHeatmapRef.current = next;
    setShowJugglerHeatmap(next);
    setColumnDefs((prev) => [...prev]);
    numberColDefsRef.current = [...numberColDefsRef.current];
    requestAnimationFrame(() => {
      gridRef.current?.api?.refreshCells({ force: true });
    });
  }, []);

  const floorMapMachineDataByNumber = useMemo<Record<string, FloorMapMachineData>>(() => {
    if (!floorMapActiveDateField) return {};
    const next: Record<string, FloorMapMachineData> = {};
    const hasTargetDateDataByNumber: Record<string, boolean> = {};
    const getFloorMapFlagColor = (flag: unknown) => {
      switch (flag) {
        case 9: return '#FFBFC7';
        case 6: return '#5bd799';
        case 5: return '#D3B9DE';
        case 4: return '#FFE899';
        default: return undefined;
      }
    };
    const sourceRows = (() => {
      if (floorMapActiveDateField === 'todayDiff') return numberRowDataRef.current ?? [];
      const loadedDesc = Array.from(loadedDates).sort((a, b) => b.localeCompare(a));
      const latestKey = loadedDesc[0];
      const latest = (latestKey && rawMapRef.current[latestKey]) ? rawMapRef.current[latestKey] : Object.values(rawMapRef.current)[0] ?? {};
      return applyJugglerSettingHeatmapScoresToNumberRows(
        transformToGridData(latest, rawMapRef.current),
        buildJugglerSettingHeatmapScoreMapsByDate(rawMapRef.current)
      );
    })();
    const hasFloorMapDateData = (value: unknown) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed !== '' && trimmed !== '-';
      }
      return true;
    };
    (sourceRows ?? []).forEach((row: any) => {
      if (!row || row?.isTotalRow || row?.machineNumber == null) return;
      const machineNumber = String(row.machineNumber).trim();
      if (!machineNumber) return;
      const rawDiff = row?.[floorMapActiveDateField];
      const hasSelectedDateData = hasFloorMapDateData(rawDiff);
      if (!hasSelectedDateData && floorMapDateField && !hasFloorMapDateData(row?.[floorMapDateField])) return;
      const hasData = hasFloorMapDateData(rawDiff);
      const existingHasData = hasTargetDateDataByNumber[machineNumber] ?? false;
      if (next[machineNumber] && existingHasData && !hasData) return;
      const diff = typeof rawDiff === 'number'
        ? rawDiff.toLocaleString('ja-JP')
        : String(rawDiff ?? '-').trim() || '-';
      next[machineNumber] = {
        machineNumber,
        name: resolveFloorMapDisplayName(String(row?.name ?? row?.modelName ?? '')),
        diff,
        url: floorMapActiveDateField === 'todayDiff' ? null : row?.urls?.[floorMapActiveDateField] ?? null,
        flagColor: showJugglerHeatmap ? undefined : floorMapActiveDateField === 'todayDiff' ? undefined : getFloorMapFlagColor(row?.flag?.[floorMapActiveDateField]),
        settingHeatmapColor: getSettingHeatmapColor(row, floorMapActiveDateField),
        tooltipColor: tooltipColorMapRef.current[machineNumber],
      };
      hasTargetDateDataByNumber[machineNumber] = hasData;
    });
    return next;
  }, [floorMapActiveDateField, floorMapDateField, floorMapShortNameVersion, getSettingHeatmapColor, loadedDates, resolveFloorMapDisplayName, showJugglerHeatmap, todayDiffMap, tooltipMapVersion]);

  const floorMapMachineOrder = useMemo(() => {
    return Object.keys(floorMapMachineDataByNumber)
      .filter((key) => !!key)
      .sort((a, b) => {
        const an = Number(a);
        const bn = Number(b);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        return a.localeCompare(b, 'ja');
      });
  }, [floorMapMachineDataByNumber]);

  const findMachineRowForDate = useCallback((machineNumber: string, dateField: string) => {
    const hasFieldData = (value: unknown) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed !== '' && trimmed !== '-';
      }
      return true;
    };
    const sourceRows = (() => {
      if (dateField === 'todayDiff') return numberRowDataRef.current ?? [];
      const loadedDesc = Array.from(loadedDates).sort((a, b) => b.localeCompare(a));
      const latestKey = loadedDesc[0];
      const latest = (latestKey && rawMapRef.current[latestKey]) ? rawMapRef.current[latestKey] : Object.values(rawMapRef.current)[0] ?? {};
      return transformToGridData(latest, rawMapRef.current);
    })();
    let row: any = null;
    let rowHasData = false;
    (sourceRows ?? []).forEach((item: any) => {
      if (!item || item?.isTotalRow || String(item?.machineNumber ?? '').trim() !== machineNumber) return;
      const hasData = hasFieldData(item?.[dateField]);
      if (!hasData && floorMapDateField && !hasFieldData(item?.[floorMapDateField])) return;
      if (row && rowHasData && !hasData) return;
      row = item;
      rowHasData = hasData;
    });
    return row;
  }, [floorMapDateField, loadedDates]);

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
    pushHistoryDebugEvent('modal open requested', {
      field,
      mode: viewModeRef.current,
      machine: row?.machineNumber ?? '',
      name: row?.name ?? row?.modelName ?? '',
    });
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
    // 台番別フラグモーダルでは、対象日セルにデータがない場合は開かない。
    if (viewModeRef.current === 'number') {
      const hasCellData = !(value === undefined || value === null || value === '-');
      if (!hasCellData) return;
    }
    setSelectedCell({ value, rowData: row, field });
    setSelectedFlag(null);
    setselectedCellUrl(null);
    setFlagModalModeOverride(null);
    setFlagModalDetailGalleryItems([]);
    setFlagModalReturnContext(null);
    flagModalMachineOrderOverrideRef.current = [];
    setModalOpen(true);
  }, [pushHistoryDebugEvent]);

  const handleOpenFloorMapMachineDetail = useCallback((machineNumber: string) => {
    if (!floorMapActiveDateField) return;
    const row = findMachineRowForDate(machineNumber, floorMapActiveDateField);
    if (!row) return;
    const value = row?.[floorMapActiveDateField];
    const order = floorMapMachineOrder.length > 0 ? floorMapMachineOrder : [machineNumber];
    if (floorMapActiveDateField === 'todayDiff') {
      todayMachineOrderRef.current = order;
      showModal(value, row, 'todayDiff');
      return;
    }
    flagModalMachineOrderOverrideRef.current = order;
    setSelectedCell({ value, rowData: row, field: floorMapActiveDateField });
    setSelectedFlag(null);
    setselectedCellUrl(row?.urls?.[floorMapActiveDateField] ?? null);
    setFlagModalModeOverride('number');
    setFlagModalDetailGalleryItems([]);
    setFlagModalReturnContext(null);
    setModalOpen(true);
  }, [findMachineRowForDate, floorMapActiveDateField, floorMapMachineOrder, showModal]);

  const getTooltipColor = useCallback((machineNumber: number | string | null | undefined) => {
    if (machineNumber == null) return undefined;
    return tooltipColorMapRef.current[String(machineNumber)];
  }, []);

  const getTooltipText = useCallback((machineNumber: number | string | null | undefined) => {
    if (machineNumber == null) return undefined;
    return tooltipTextMapRef.current[String(machineNumber)];
  }, []);

  const buildSnapshotGraphUrl = useCallback((item: TodaySnapshotItem | null | undefined, dateKey: string) => {
    const rawUrl = item?.graphImageUrl;
    if (!rawUrl) return '';
    const version = item?.scrapedAt || item?.dataUpdatedAt || dateKey || '';
    if (!version) return rawUrl;
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}v=${encodeURIComponent(version)}`;
  }, []);

  const buildTodayGraphUrl = useCallback((item: TodaySnapshotItem | null | undefined) => {
    return buildSnapshotGraphUrl(item, todaySnapshotDateKey);
  }, [buildSnapshotGraphUrl, todaySnapshotDateKey]);

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

  /**
   * 過去日付の機種別モーダルで「その日に実データがある台」かを判定する。
   * @param snapshot 対象台のスナップショット
   * @param historyRows 大当り履歴行
   * @param historyCount 大当り履歴件数
   */
  const hasPastDateSnapshotData = useCallback(
    (
      snapshot: TodaySnapshotItem | null | undefined,
      historyRows: TodayOatariHistoryRow[],
      historyCount: number | null | undefined
    ): boolean => {
      const hasDisplayableValue = (value: unknown): boolean => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'number') return Number.isFinite(value);
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (!trimmed) return false;
          if (trimmed === '--' || trimmed === '-') return false;
          return true;
        }
        return false;
      };

      const countNumber = typeof historyCount === 'number' ? historyCount : Number(historyCount);
      const hasHistory = (Number.isFinite(countNumber) && countNumber > 0) || (historyRows?.length ?? 0) > 0;

      const hasMetricData = [
        snapshot?.totalGameCount,
        snapshot?.bbCount,
        snapshot?.rbCount,
        snapshot?.artCount,
        snapshot?.combinedProbability,
        snapshot?.bbProbability,
        snapshot?.rbProbability,
        snapshot?.highestPayout,
      ].some((value) => hasDisplayableValue(value));

      return hasHistory || hasMetricData;
    },
    []
  );

  useEffect(() => {
    const reqId = ++flagModalDetailReqRef.current;

    const reset = () => {
      setFlagModalDetailSnapshot(null);
      setFlagModalDetailDateKey('');
      setFlagModalDetailHistoryRows([]);
      setFlagModalDetailHistoryCount(null);
      setFlagModalDetailHistoryLoading(false);
      setFlagModalDetailGalleryItems([]);
    };

    if (!modalOpen || !selectedCell) {
      reset();
      return;
    }

    const dateField = String(selectedCell.field ?? '');
    if (!/^\d{8}$/.test(dateField)) {
      reset();
      return;
    }

    const candidateMachineKeys = Array.from(
      new Set(
        [
          selectedCell?.rowData?.machineNumber != null ? String(selectedCell.rowData.machineNumber).trim() : '',
          ...(Array.isArray(selectedCell?.rowData?.machineNumbers)
            ? selectedCell.rowData.machineNumbers.map((v: any) => String(v).trim())
            : []),
        ].filter((v) => !!v)
      )
    );

    if (candidateMachineKeys.length === 0) {
      reset();
      return;
    }

    setFlagModalDetailDateKey(dateField);
    setFlagModalDetailSnapshot(null);
    setFlagModalDetailHistoryRows([]);
    setFlagModalDetailHistoryCount(null);
    setFlagModalDetailGalleryItems([]);
    setFlagModalDetailHistoryLoading(true);
    const loadStartedAt = performance.now();
    pushHistoryDebugEvent('past detail effect start', {
      field: dateField,
      mode: flagModalEffectiveMode,
      machineKeys: candidateMachineKeys.length,
    });

    const loadDetail = async () => {
      try {
        const snapshotId = `${storeId}_${dateField}`;
        if (flagModalEffectiveMode === 'model') {
          const targetCanonicalName = resolveDisplayName(
            String(selectedCell?.rowData?.name ?? selectedCell?.rowData?.modelName ?? '')
          );
          const dayRawMap = rawMapRef.current?.[dateField] ?? {};
          const modelMachineKeys = Array.from(
            new Set(
              Object.values(dayRawMap as Record<string, any>)
                // 機種別平均差枚の計算対象（その日 diff が数値）だけを対象にする。
                .filter((item: any) => typeof item?.diff === 'number' && Number.isFinite(item.diff))
                .filter((item: any) => resolveDisplayName(String(item?.name ?? item?.modelName ?? '')) === targetCanonicalName)
                .map((item: any) => String(item?.machineNumber ?? '').trim())
                .filter((v: string) => !!v)
            )
          ).sort((a, b) => {
            const ai = Number(a);
            const bi = Number(b);
            if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
            return a.localeCompare(b, 'ja');
          });

          if (modelMachineKeys.length === 0) return;

          const fetchStartedAt = performance.now();
          pushHistoryDebugEvent('past model fetch start', {
            snapshotId,
            machines: modelMachineKeys.length,
          });
          const results = await Promise.all(
            modelMachineKeys.map(async (machineKey) => {
              const result = await fetchSnapshotDetailFromOatariSubcollection(snapshotId, machineKey);
              if (!result.exists || !result.snapshot) return null;
              const estimateSnapshot = mergeSlotDiffEstimateFields(
                dateField,
                machineKey,
                result.snapshot,
                targetCanonicalName
              ) ?? result.snapshot;
              return {
                machineKey,
                snapshot: estimateSnapshot,
                historyRows: result.rows,
                historyCount: result.count ?? result.rows.length,
                timing: result.timing,
              };
            })
          );
          const resultTimings = results
            .map((v) => v?.timing)
            .filter((v): v is { readMs: number; parseMs: number; totalMs: number } => !!v);
          pushHistoryDebugEvent('past model fetch done', {
            ms: Math.round(performance.now() - fetchStartedAt),
            results: results.filter((v) => !!v).length,
            maxReadMs: resultTimings.length > 0 ? Math.max(...resultTimings.map((v) => v.readMs)) : null,
            maxParseMs: resultTimings.length > 0 ? Math.max(...resultTimings.map((v) => v.parseMs)) : null,
            maxTotalMs: resultTimings.length > 0 ? Math.max(...resultTimings.map((v) => v.totalMs)) : null,
          });

          if (reqId !== flagModalDetailReqRef.current) return;
          const galleryItems = results.filter(
            (
              v
            ): v is {
              machineKey: string;
              snapshot: TodaySnapshotItem;
              historyRows: TodayOatariHistoryRow[];
              historyCount: number;
              timing: { readMs: number; parseMs: number; totalMs: number } | undefined;
            } =>
              !!v &&
              !!String(v.snapshot?.graphImageUrl ?? '').trim() &&
              hasPastDateSnapshotData(v.snapshot, v.historyRows, v.historyCount)
          );
          setFlagModalDetailGalleryItems(galleryItems);
          pushHistoryDebugEvent('past model state set', {
            galleryItems: galleryItems.length,
          });
          return;
        }

        // 取得件数を抑えるため、過去日付の台番別詳細は
        // oatariHistories/{machineNumber} の単一ドキュメントのみ読む。
        const machineKey = candidateMachineKeys[0];
        if (!machineKey) return;
        const selectedMachineName = selectedCell?.rowData?.name ?? selectedCell?.rowData?.modelName;
        const slotDiffEstimateSnapshot = mergeSlotDiffEstimateFields(
          dateField,
          machineKey,
          null,
          selectedMachineName
        );

        const fetchStartedAt = performance.now();
        pushHistoryDebugEvent('past detail fetch start', {
          snapshotId,
          machineKey,
        });
        const detailResult = await fetchSnapshotDetailFromOatariSubcollection(snapshotId, machineKey);
        pushHistoryDebugEvent('past detail fetch done', {
          ms: Math.round(performance.now() - fetchStartedAt),
          exists: detailResult.exists,
          rows: detailResult.rows.length,
          count: detailResult.count,
          hasSnapshot: !!detailResult.snapshot,
          readMs: detailResult.timing?.readMs,
          parseMs: detailResult.timing?.parseMs,
          totalMs: detailResult.timing?.totalMs,
        });
        if (reqId !== flagModalDetailReqRef.current) return;
        if (!detailResult.exists || !detailResult.snapshot) {
          if (!slotDiffEstimateSnapshot) return;
          setFlagModalDetailSnapshot(slotDiffEstimateSnapshot);
          setFlagModalDetailHistoryRows([]);
          setFlagModalDetailHistoryCount(0);
          pushHistoryDebugEvent('past detail fallback state set', {
            rows: 0,
            count: 0,
          });
          return;
        }

        const mergedSnapshot = mergeSlotDiffEstimateFields(
          dateField,
          machineKey,
          detailResult.snapshot,
          selectedMachineName
        ) ?? detailResult.snapshot;
        setFlagModalDetailSnapshot(mergedSnapshot);
        setFlagModalDetailHistoryRows(detailResult.rows);
        setFlagModalDetailHistoryCount(detailResult.count ?? detailResult.rows.length);
        pushHistoryDebugEvent('past detail state set', {
          rows: detailResult.rows.length,
          count: detailResult.count ?? detailResult.rows.length,
          hasGraph: !!String(mergedSnapshot?.graphImageUrl ?? '').trim(),
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load past-date snapshot detail:', error);
        if (reqId !== flagModalDetailReqRef.current) return;
        setFlagModalDetailSnapshot(null);
        setFlagModalDetailHistoryRows([]);
        setFlagModalDetailHistoryCount(0);
        setFlagModalDetailGalleryItems([]);
        pushHistoryDebugEvent('past detail error state set', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (reqId === flagModalDetailReqRef.current) {
          setFlagModalDetailHistoryLoading(false);
          pushHistoryDebugEvent('past detail loading false', {
            ms: Math.round(performance.now() - loadStartedAt),
          });
        }
      }
    };

    void loadDetail();
  }, [
    flagModalEffectiveMode,
    hasPastDateSnapshotData,
    mergeSlotDiffEstimateFields,
    modalOpen,
    pushHistoryDebugEvent,
    resolveDisplayName,
    selectedCell,
    storeId,
  ]);

  const loadTodayOatariHistory = useCallback(async (machineKey: string, snapshot: TodaySnapshotItem) => {
    const reqId = ++todayOatariHistoryReqRef.current;
    setTodayOatariHistoryLoading(true);
    setTodayOatariHistoryRows([]);
    setTodayOatariHistoryCount(null);
    const loadStartedAt = performance.now();
    pushHistoryDebugEvent('today history load start', {
      snapshotDocId: todaySnapshotDocIdRef.current,
      machineKey,
      storage: snapshot?.oatariHistoryStorage ?? '',
    });

    try {
      const useSubcollection = snapshot?.oatariHistoryStorage === 'subcollection';
      const isStorageUnset =
        snapshot?.oatariHistoryStorage === undefined || snapshot?.oatariHistoryStorage === null;
      const snapshotDocId = todaySnapshotDocIdRef.current;
      const trySubcollectionFirst = !!snapshotDocId && (useSubcollection || isStorageUnset);
      if (trySubcollectionFirst) {
        const fetchStartedAt = performance.now();
        pushHistoryDebugEvent('today history fetch start', {
          snapshotDocId,
          machineKey,
        });
        const result = await fetchOatariHistorySubcollection(snapshotDocId, machineKey);
        pushHistoryDebugEvent('today history fetch done', {
          ms: Math.round(performance.now() - fetchStartedAt),
          exists: result.exists,
          rows: result.rows.length,
          count: result.count,
          readMs: result.timing?.readMs,
          parseMs: result.timing?.parseMs,
          totalMs: result.timing?.totalMs,
        });
        if (reqId !== todayOatariHistoryReqRef.current) return;

        if (!result.exists) {
          // subcollection 未作成時は旧形式にフォールバック
        } else {
          setTodayOatariHistoryRows(result.rows);
          setTodayOatariHistoryCount(result.count ?? result.rows.length);
          pushHistoryDebugEvent('today history state set', {
            rows: result.rows.length,
            count: result.count ?? result.rows.length,
            source: 'subcollection',
          });
          return;
        }
      }

      const fallbackRows = parseTodayOatariHistory(snapshot?.oatariHistory);
      if (reqId !== todayOatariHistoryReqRef.current) return;
      setTodayOatariHistoryRows(fallbackRows);
      setTodayOatariHistoryCount(fallbackRows.length);
      pushHistoryDebugEvent('today history state set', {
        rows: fallbackRows.length,
        count: fallbackRows.length,
        source: 'snapshot',
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load oatariHistories subcollection:', error);
      if (reqId !== todayOatariHistoryReqRef.current) return;
      setTodayOatariHistoryRows([]);
      setTodayOatariHistoryCount(0);
      pushHistoryDebugEvent('today history error state set', {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (reqId === todayOatariHistoryReqRef.current) {
        setTodayOatariHistoryLoading(false);
        pushHistoryDebugEvent('today history loading false', {
          ms: Math.round(performance.now() - loadStartedAt),
        });
      }
    }
  }, [parseTodayOatariHistory, pushHistoryDebugEvent]);

  const openTodayDetailByMachineKey = useCallback(async (
    machineKey: string,
    direction: -1 | 0 | 1 = 0
  ) => {
    const snapshot = todaySnapshotMapRef.current[machineKey];
    if (!snapshot) return;
    pushHistoryDebugEvent('today detail open by machine', {
      machineKey,
      direction,
      hasSnapshot: !!snapshot,
    });
    setTodayDetailAnimName(direction > 0 ? 'slideLeft' : direction < 0 ? 'slideRight' : 'none');
    setTodayDetailAnimTick((v) => v + 1);
    setTodayDetailMachineKey(machineKey);
    setTodayDetailItem(snapshot);
    setTodayDetailModalOpen(true);
    void loadTodayOatariHistory(machineKey, snapshot);
  }, [loadTodayOatariHistory, pushHistoryDebugEvent]);

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
  numberRowDataRef.current = applyJugglerSettingHeatmapScoresToNumberRows(
    numberRowDataRef.current,
    buildJugglerSettingHeatmapScoreMapsByDate(rawMapRef.current)
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
    getTooltipText,
    getSettingHeatmapColor,
    () => showJugglerHeatmapRef.current
  );

  numberColDefsRef.current = [...numberColDefsRef.current, ...newCols];
  setLoadedDates(prev => new Set([...Array.from(prev), ...dates]));

  if (viewMode === 'number') {
    setRowData(numberRowDataRef.current);
    setColumnDefs(numberColDefsRef.current);
  } else if (viewMode === 'model') {
    buildAndSetGrouped(allLoadedArr, allDisplayData);
  } else if (viewMode === 'tail') {
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
    const flag = showJugglerHeatmapRef.current ? undefined : props.node?.data?.flag?.[field];
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
    const settingHeatmapScoreMapsByDate = buildJugglerSettingHeatmapScoreMapsByDate(rawMapRef.current);
    let groupedRows = transformToGroupedGridData(latest, allData);
    groupedRows = applyGroupedTotalLabelByMetric(groupedRows);
    if (displayMetric === 'diff') {
      groupedRows = applyGroupedDateMetricCells(groupedRows, allData);
    }
    const groupedWithSettingHeatmap = applyJugglerSettingHeatmapScoresToGroupedRows(
      groupedRows,
      rawMapRef.current,
      settingHeatmapScoreMapsByDate
    );
    const groupedWithToday = applyTodayDiffToGroupedRows(
      groupedWithSettingHeatmap,
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
      displayMetric,
      getSettingHeatmapColor,
      () => showJugglerHeatmapRef.current
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
    numberRows = applyJugglerSettingHeatmapScoresToNumberRows(
      numberRows,
      buildJugglerSettingHeatmapScoreMapsByDate(rawMapRef.current)
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
      getTooltipText,
      getSettingHeatmapColor,
      () => showJugglerHeatmapRef.current
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

    const newMode: ViewMode = newValue === 0 ? 'number' : newValue === 1 ? 'model' : newValue === 2 ? 'tail' : 'floor';
    queueGridUiRestore(newMode, currentMetric);
    setViewMode(newMode);
    if (newMode === 'tail' || newMode === 'floor') {
      setSelectedName('');
    }

    if (newMode === 'model') {
      buildAndSetGrouped();
    } else if (newMode === 'tail') {
      buildAndSetTail();
    } else if (newMode === 'number') {
      // ★ 台番別に“確実に”戻す（ref に保持していた元データを復元）
      setRowData(numberRowDataRef.current);
      setColumnDefs(numberColDefsRef.current);
    }
  };

  useEffect(() => {
    if (!hasFloorMap && viewMode === 'floor') {
      setViewMode('number');
    }
  }, [hasFloorMap, viewMode]);

  const tabValue = viewMode === 'number' ? 0 : viewMode === 'model' ? 1 : viewMode === 'tail' ? 2 : 3;
  const groupedRowNeedsExtraHeight = viewMode === 'model' && displayMetric === 'diff' && showGroupedWinStats;
  const currentGridRowHeight = viewMode === 'tail' || groupedRowNeedsExtraHeight ? 34 : 22;
  // 再マウントは「勝率表示スイッチの手動切替時」のみに限定する
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

  // ギャラリー内の平均行計算は純粋関数へ分離。
  const todayGalleryStats = useMemo(() => buildTodayGalleryStats(todayGalleryItems), [todayGalleryItems]);
  const flagModalGalleryStats = useMemo(
    () =>
      buildTodayGalleryStats(
        (flagModalDetailGalleryItems ?? []).map(({ machineKey, snapshot }) => ({
          machineKey,
          snapshot,
        }))
      ),
    [flagModalDetailGalleryItems]
  );

  const handleExportJson = () => {
    if (!window.confirm('表示データのJSONファイルを出力します。よろしいですか？')) return;
    exportSlotAnalyticsJson({
      storeId,
      viewMode: viewModeRef.current,
      displayMetric: displayMetricRef.current,
      numberRows: numberRowDataRef.current,
      loadedDates: Array.from(loadedDates),
      rawDataByDate: rawMapRef.current,
      todaySnapshotMap: todaySnapshotMapRef.current,
      todaySnapshotDateKey,
      todayColumnHeader,
      hasTodayDiffData,
    });
  };

  const handleRefreshData = async () => {
    if (refreshing || loadingRef.current) return;
    const dates = Array.from(loadedDates).sort((a, b) => b.localeCompare(a));
    const currentMode = viewModeRef.current;
    const currentMetric = displayMetricRef.current;
    const currentSnapshot = captureGridUiState(currentMode, currentMetric);

    setRefreshing(true);
    loadingRef.current = true;
    try {
      await loadTodaySnapshotData();
      if (dates.length === 0) {
        queueGridUiRestore(currentMode, currentMetric, currentSnapshot);
        await loadInitialData();
        return;
      }

      rawMapRef.current = {};
      numberRowDataRef.current = [];
      numberColDefsRef.current = [];
      setLoadedDates(new Set());
      queueGridUiRestore(currentMode, currentMetric, currentSnapshot);
      await loadDates(dates);
      gridRef.current?.api?.refreshCells({ force: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to refresh slot diff data:', error);
      window.alert('更新に失敗しました。時間をおいて再度お試しください。');
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  };

  // 指定台番でフラグモーダルを台番別コンテキストへ切り替える。
  const applyFlagModalNumberSelection = useCallback((machineKey: string, dateField: string) => {
    const row = findMachineRowForDate(machineKey, dateField);
    if (!row) return false;

    const detail = flagModalDetailGalleryItems.find((item) => item.machineKey === machineKey);
    pushHistoryDebugEvent('past number selection applied', {
      machineKey,
      dateField,
      hasPreloadedDetail: !!detail,
      preloadedRows: detail?.historyRows?.length ?? 0,
      preloadedCount: detail?.historyCount ?? null,
    });
    setFlagModalModeOverride('number');
    setSelectedCell({ value: row?.[dateField], rowData: row, field: dateField });
    setSelectedFlag(null);
    setselectedCellUrl(row?.urls?.[dateField] ?? null);
    if (detail) {
      setFlagModalDetailSnapshot(detail.snapshot);
      setFlagModalDetailHistoryRows(detail.historyRows);
      setFlagModalDetailHistoryCount(detail.historyCount);
      setFlagModalDetailHistoryLoading(false);
    }
    return true;
  }, [findMachineRowForDate, flagModalDetailGalleryItems, pushHistoryDebugEvent]);

  // 機種別グラフ一覧から台番を選択したとき、同日付の台番別モーダルへ切り替える。
  const handleOpenNumberModalFromModelGallery = useCallback((machineKey: string) => {
    if (!selectedCell) return;
    const dateField = String(selectedCell.field ?? '');
    if (!/^\d{8}$/.test(dateField)) return;

    const machineKeys = Array.from(
      new Set(
        (flagModalDetailGalleryItems ?? [])
          .map((item) => String(item.machineKey ?? '').trim())
          .filter((v) => !!v)
      )
    );

    if (flagModalEffectiveMode === 'model') {
      setFlagModalReturnContext({
        selectedCell: selectedCell as { rowData: any; field: string; value: any },
        selectedCellUrl,
        machineKeys,
      });
    }

    void applyFlagModalNumberSelection(machineKey, dateField);
  }, [
    applyFlagModalNumberSelection,
    flagModalDetailGalleryItems,
    flagModalEffectiveMode,
    selectedCell,
    selectedCellUrl,
  ]);

  // 台番別フラグモーダルで次/前の台へ移動する。
  const moveFlagModalMachine = useCallback((delta: number) => {
    if (!modalOpen || flagModalEffectiveMode !== 'number') return;
    const dateField = String(selectedCell?.field ?? '');
    if (!/^\d{8}$/.test(dateField)) return;
    const currentMachineKey = String(selectedCell?.rowData?.machineNumber ?? '').trim();
    if (!currentMachineKey) return;

    const overrideOrder = flagModalMachineOrderOverrideRef.current ?? [];
    const contextOrder = flagModalReturnContext?.machineKeys ?? [];
    const fallbackOrder = (numberRowDataRef.current ?? [])
      .filter((row: any) => !row?.isTotalRow && row?.machineNumber != null)
      .filter((row: any) => {
        if (!selectedName) return true;
        return (row?.name ?? row?.modelName) === selectedName;
      })
      .map((row: any) => String(row.machineNumber).trim())
      .filter((v: string) => !!v);
    const order = overrideOrder.length > 0 ? overrideOrder : contextOrder.length > 0 ? contextOrder : fallbackOrder;
    if (order.length <= 1) return;

    const currentIndex = order.indexOf(currentMachineKey);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    const nextKey = order[nextIndex];
    if (!nextKey) return;

    void applyFlagModalNumberSelection(nextKey, dateField);
  }, [
    applyFlagModalNumberSelection,
    flagModalEffectiveMode,
    flagModalReturnContext,
    modalOpen,
    selectedCell,
    selectedName,
  ]);

  const handleFlagModalSwipePrev = useCallback(() => {
    moveFlagModalMachine(-1);
  }, [moveFlagModalMachine]);

  const handleFlagModalSwipeNext = useCallback(() => {
    moveFlagModalMachine(1);
  }, [moveFlagModalMachine]);

  // フラグ編集モーダルを閉じる。
  const handleCloseFlagModal = useCallback(() => {
    // 機種別 -> 台番別へ遷移していた場合は、閉じる時に機種別へ戻す。
    if (flagModalReturnContext && flagModalEffectiveMode === 'number') {
      flagModalDetailReqRef.current += 1;
      setFlagModalModeOverride('model');
      setSelectedCell(flagModalReturnContext.selectedCell);
      setSelectedFlag(null);
      setselectedCellUrl(flagModalReturnContext.selectedCellUrl);
      setFlagModalDetailSnapshot(null);
      setFlagModalDetailDateKey(String(flagModalReturnContext.selectedCell?.field ?? ''));
      setFlagModalDetailHistoryRows([]);
      setFlagModalDetailHistoryCount(null);
      setFlagModalDetailHistoryLoading(false);
      setFlagModalReturnContext(null);
      return;
    }

    flagModalDetailReqRef.current += 1;
    setFlagModalModeOverride(null);
    setModalOpen(false);
    setSelectedComment('');
    setFlagModalDetailSnapshot(null);
    setFlagModalDetailDateKey('');
    setFlagModalDetailHistoryRows([]);
    setFlagModalDetailHistoryCount(null);
    setFlagModalDetailHistoryLoading(false);
    setFlagModalDetailGalleryItems([]);
    setFlagModalReturnContext(null);
    flagModalMachineOrderOverrideRef.current = [];
  }, [flagModalEffectiveMode, flagModalReturnContext]);

  // 選択セルのURLを使って「台データ」モーダルを開く。
  const handleOpenMachineDataModal = useCallback(() => {
    if (!selectedCellUrl) return;
    setMachineUrl(selectedCellUrl);
    setIsMachineModalOpen(true);
  }, [selectedCellUrl]);

  // 「台データ」モーダルを閉じる。
  const handleCloseMachineDataModal = useCallback(() => {
    setIsMachineModalOpen(false);
    setMachineUrl(null);
  }, []);

  // フラグ編集モーダルのOK処理（Firestore更新 + ローカル状態反映）。
  const handleFlagModalOk = useCallback(async () => {
    if (!selectedCell || selectedFlag === null || flagModalSaving) return;
    setFlagModalSaving(true);
    try {
      const scrollTopBeforeUpdate = getCurrentVerticalScrollTop();

      const dateField = selectedCell.field;
      const loadResult = await fetchSlotDiffDateData(storeId, dateField);
      if (!loadResult.exists) return;

      const data = loadResult.data;
      const targetName = String(selectedCell.rowData.name ?? selectedCell.rowData.modelName ?? '');
      const targetCanonicalName = resolveDisplayName(targetName);
      const targetNumber = String(selectedCell.rowData.machineNumber ?? '');

      const originalFlag = selectedCell?.rowData?.flag?.[dateField] ?? 0;
      const commentValue = selectedComment ?? '';

      // 台番別と機種別で分岐
      if (flagModalEffectiveMode === 'model') {
        // 機種別ではコメントは常に一括反映、flag は 9/0 選択時のみ反映する。
        const shouldUpdateFlag = [9, 0].includes(selectedFlag);
        const targetKeys: string[] = [];
        Object.entries(data).forEach(([key, val]: [string, any]) => {
          const canonical = resolveDisplayName(String(val?.name ?? ''));
          if (canonical === targetCanonicalName) targetKeys.push(key);
        });

        if (targetKeys.length === 0) {
          setModalOpen(false);
          return;
        }

        await updateModelModeFlagsAndComment({
          storeId,
          dateField,
          targetKeys,
          selectedFlag,
          commentValue,
          shouldUpdateFlag,
        });

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
        setRowData((prev) =>
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
        setFlagModalReturnContext(null);
        flagModalMachineOrderOverrideRef.current = [];
        setSelectedComment('');
        gridRef.current?.api?.refreshCells({ force: true });
        return;
      }

      // ここから先は従来の台番別ロジック。
      const targetKeys: string[] = [];
      if (originalFlag === 9 && selectedFlag === 0) {
        Object.entries(data).forEach(([key, val]: [string, any]) => {
          const canonical = resolveDisplayName(String(val?.name ?? ''));
          if (canonical === targetCanonicalName) targetKeys.push(key);
        });
      } else if (selectedFlag === 9) {
        Object.entries(data).forEach(([key, val]: [string, any]) => {
          const canonical = resolveDisplayName(String(val?.name ?? ''));
          if (canonical === targetCanonicalName) targetKeys.push(key);
        });
      } else {
        Object.entries(data).forEach(([key, val]: [string, any]) => {
          const canonical = resolveDisplayName(String(val?.name ?? ''));
          if (canonical === targetCanonicalName && String(val?.machineNumber ?? '') === targetNumber) {
            targetKeys.push(key);
          }
        });
      }

      await updateNumberModeFlagsAndComment({
        storeId,
        dateField,
        targetKeys,
        selectedFlag,
        commentValue,
      });

      setModalOpen(false);
      setFlagModalReturnContext(null);
      flagModalMachineOrderOverrideRef.current = [];
      setSelectedComment('');

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
    } finally {
      setFlagModalSaving(false);
    }
  }, [
    flagModalSaving,
    getCurrentVerticalScrollTop,
    resolveDisplayName,
    selectedCell,
    selectedComment,
    selectedFlag,
    storeId,
    flagModalEffectiveMode,
  ]);

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
          <Tab label="機種別" 
            sx={{
              minHeight: 24,     // ★ タブ本体の高さを下げる
              paddingY: 0,       // ★ 上下の余白をゼロに
              fontSize: '0.8rem' // フォントサイズ調整
            }}
          />
          <Tab label="末尾別" 
            sx={{
              minHeight: 24,
              paddingY: 0,
              fontSize: '0.8rem'
            }}
          />
          {hasFloorMap ? (
            <Tab label="マップ"
              sx={{
                minHeight: 24,
                paddingY: 0,
                fontSize: '0.8rem'
              }}
            />
          ) : null}
        </Tabs>
      </Box>

      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {viewMode === 'floor' ? (
          <FloorMapView
            htmlUrl={floorMapUrl}
            machineDataByNumber={floorMapMachineDataByNumber}
            dateOptions={floorMapDateOptions}
            activeDateField={floorMapActiveDateField}
            onDateFieldChange={setSelectedFloorMapDateField}
            scale={floorMapScale}
            onScaleChange={setFloorMapScale}
            onOpenMachineData={handleOpenFloorMapMachineDetail}
          />
        ) : (
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
        )}
      </div>

      {/* フッターツールバー */}
      <div style={footerToolbarShellStyle}>
        <div style={footerToolbarScrollerStyle}>
          {viewMode === 'floor' ? (
            <div style={footerToolbarBlockStyle}>
              <button
                type="button"
                onClick={() => setFloorMapScale((v) => Math.max(0.5, Math.round((v - 0.1) * 10) / 10))}
                style={footerNativeButtonStyle}
                aria-label="マップを縮小"
              >
                -
              </button>
              <span style={footerZoomValueStyle}>{Math.round(floorMapScale * 100)}%</span>
              <button
                type="button"
                onClick={() => setFloorMapScale((v) => Math.min(2.5, Math.round((v + 0.1) * 10) / 10))}
                style={footerNativeButtonStyle}
                aria-label="マップを拡大"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setFloorMapScale(1)}
                style={{ ...footerNativeButtonStyle, minWidth: 54 }}
                aria-label="マップ倍率を100%へ戻す"
              >
                100%
              </button>
              <Button
                variant={showJugglerHeatmap ? 'contained' : 'outlined'}
                onClick={handleToggleJugglerHeatmap}
                aria-label="ジャグラーヒートマップ"
                aria-pressed={showJugglerHeatmap}
                title={showJugglerHeatmap ? 'ジャグラーヒートマップ ON' : 'ジャグラーヒートマップ OFF'}
                sx={heatmapButtonSx(showJugglerHeatmap)}
              >
                <JugglerHeatmapIcon active={showJugglerHeatmap} />
              </Button>
            </div>
          ) : viewMode !== 'tail' ? (
            <div style={machineFilterBlockStyle}>
              <FormControl variant="outlined" fullWidth style={machineSelectFormStyle}>
                <Select
                  labelId="machine-select-label"
                  value={selectedName}
                  onChange={handleSelectChange}
                  displayEmpty
                  renderValue={(value) => {
                    const currentValue = String(value ?? '');
                    return currentValue ? currentValue : '全機種';
                  }}
                  sx={{
                    height: 34,
                    fontSize: '0.76em',
                    backgroundColor: '#fff',
                    borderRadius: 0,
                    '& .MuiOutlinedInput-notchedOutline': {
                      border: 'none',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      border: 'none',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      border: 'none',
                    },
                    '& .MuiSelect-select': {
                      paddingTop: 0,
                      paddingBottom: 0,
                      paddingLeft: '6px',
                      paddingRight: '20px !important',
                      minHeight: '34px',
                      lineHeight: '34px',
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      boxSizing: 'border-box',
                    },
                    '& .MuiSelect-icon': {
                      right: 1,
                    },
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
              {viewMode === 'number' ? (
                <Button
                  variant={showJugglerHeatmap ? 'contained' : 'outlined'}
                  onClick={handleToggleJugglerHeatmap}
                  aria-label="ジャグラーヒートマップ"
                  aria-pressed={showJugglerHeatmap}
                  title={showJugglerHeatmap ? 'ジャグラーヒートマップ ON' : 'ジャグラーヒートマップ OFF'}
                  sx={heatmapButtonSx(showJugglerHeatmap)}
                >
                  <JugglerHeatmapIcon active={showJugglerHeatmap} />
                </Button>
              ) : null}
            </div>
          ) : null}

          {viewMode !== 'floor' ? (
            <div style={footerToolbarBlockStyle}>
              <Button variant="outlined" onClick={handleToggleDisplayMetric} sx={metricToggleButtonSx}>
                {displayMetric === 'diff' ? '差枚' : '回転数'}
              </Button>
            </div>
          ) : null}

          {viewMode === 'model' ? (
            <div style={footerToolbarBlockStyle}>
              <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', lineHeight: 0 }}>
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
            </div>
          ) : null}

          {viewMode !== 'floor' ? (
            <div style={footerToolbarBlockStyle}>
              <Button
                variant="contained"
                onClick={handleExportJson}
                aria-label="JSON出力"
                title="JSON出力"
                sx={exportButtonSx}
              >
                <ExportShareIcon />
              </Button>
              <Button
                variant="contained"
                onClick={() => void handleRefreshData()}
                disabled={refreshing}
                aria-label="データ更新"
                title="データ更新"
                sx={refreshButtonSx}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                  style={{
                    display: 'block',
                    transform: refreshing ? 'rotate(90deg)' : 'none',
                    transition: 'transform 160ms ease',
                  }}
                >
                  <path
                    d="M20 11a8 8 0 1 0-2.34 5.66"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M20 4v7h-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Button>
            </div>
          ) : null}
        </div>
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

            <JugglerSettingEstimatePanel snapshot={todayDetailItem} />

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
          // ギャラリー -> 詳細の遷移中に onCancel が走っても内容を失わないよう、
          // 閉じる時は open 状態のみ更新し、items/title は維持する。
          setTodayGalleryModalOpen(false);
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

      {historyDebugEvents.length > 0 ? (
        <div
          style={{
            position: 'fixed',
            right: 8,
            bottom: 54,
            zIndex: 20000,
            width: 'min(360px, calc(100vw - 16px))',
            maxHeight: '38dvh',
            overflowY: 'auto',
            padding: 8,
            border: '1px solid rgba(20, 42, 70, 0.35)',
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.94)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
            fontSize: 11,
            lineHeight: 1.35,
            color: '#172033',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>履歴DEBUG</div>
          {historyDebugEvents.slice(-14).map((event, index) => (
            <div
              key={`${event.at}_${event.label}_${index}`}
              style={{ borderTop: index === 0 ? 'none' : '1px solid #e0e5ec', padding: '3px 0' }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums', color: '#4f627a' }}>
                {(event.at / 1000).toFixed(1)}s
              </span>
              <span style={{ marginLeft: 5, fontWeight: 700 }}>{event.label}</span>
              {event.meta ? (
                <div style={{ wordBreak: 'break-all', color: '#546477' }}>
                  {stringifyHistoryDebugMeta(event.meta)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <FlagSettingModal
        open={modalOpen}
        selectedCell={selectedCell}
        selectedCellUrl={selectedCellUrl}
        selectedFlag={selectedFlag}
        selectedComment={selectedComment}
        viewMode={flagModalEffectiveMode}
        onCancel={handleCloseFlagModal}
        onOk={handleFlagModalOk}
        okLoading={flagModalSaving}
        onFlagChange={setSelectedFlag}
        onCommentChange={setSelectedComment}
        onOpenMachineData={handleOpenMachineDataModal}
        detailSnapshot={flagModalDetailSnapshot}
        detailGraphUrl={buildSnapshotGraphUrl(flagModalDetailSnapshot, flagModalDetailDateKey)}
        detailHistoryRows={flagModalDetailHistoryRows}
        detailHistoryLoading={flagModalDetailHistoryLoading}
        detailHistoryCount={flagModalDetailHistoryCount}
        detailGalleryItems={flagModalDetailGalleryItems}
        detailGalleryStats={flagModalGalleryStats}
        onOpenDetailMachineFromGallery={handleOpenNumberModalFromModelGallery}
        onSwipePrevMachine={handleFlagModalSwipePrev}
        onSwipeNextMachine={handleFlagModalSwipeNext}
      />
      <MachineDataModal open={isMachineModalOpen} machineUrl={machineUrl} onClose={handleCloseMachineDataModal} />
    </>
  );
};
