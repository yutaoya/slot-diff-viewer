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

// データ関連（パスは環境に合わせて）
import { fetchSlotDiffs } from './dataFetcher';
import { transformToGridData, transformToGroupedGridData, transformToTailGridData } from './dataTransformer';

// UI
import { Modal, Radio } from 'antd';
import { doc, updateDoc, getDoc, getFirestore, FieldPath, writeBatch, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { FormControl, MenuItem, Select } from '@mui/material';
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

type TodaySnapshotItem = {
  machineNumber?: number | string;
  name?: string;
  currentDifference?: number | string;
  currentUrl?: string;
  graphImageUrl?: string;
  dataUpdatedAt?: string;
  totalGameCount?: string;
  bbCount?: string;
  rbCount?: string;
  artCount?: string;
  highestPayout?: string;
  bbProbability?: string;
  rbProbability?: string;
  combinedProbability?: string;
  rateLabel?: string;
  oatariHistory?: Array<{
    count?: string;
    kind?: string;
    time?: string;
    game?: string;
    payout?: string;
    isArtOrRt?: boolean;
  }>;
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
  const scrollReady = useRef(false);
  const didInitRef = useRef(false);

  const [viewMode, setViewMode] = useState<ViewMode>('number');
  const [disableVirtualization, setDisableVirtualization] = useState(false);
  const virtualizationPendingRef = useRef(false);

  // モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ rowData: any; field: string; value: any } | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<number | null>(null);
  const [selectedCellUrl, setselectedCellUrl] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | number | null>(null);
  const [todayDetailModalOpen, setTodayDetailModalOpen] = useState(false);
  const [todayDetailItem, setTodayDetailItem] = useState<TodaySnapshotItem | null>(null);


  // 機種名フィルタ
  const [selectedName, setSelectedName] = useState<string>("");

  // 読み込み済みの「生データ（date => map）」を保持（機種別集計に使用）
  const rawMapRef = useRef<Record<string, any>>({});
  const tooltipColorMapRef = useRef<Record<string, string>>({});
  const tooltipTextMapRef = useRef<Record<string, string>>({});
  const todaySnapshotMapRef = useRef<Record<string, TodaySnapshotItem>>({});
  const [todayDiffMap, setTodayDiffMap] = useState<Record<string, number>>({});
  const [hasTodayDiffData, setHasTodayDiffData] = useState(false);

  const rowDataRef = useRef<any[]>([]);  // ★ 追加
  const pendingScrollRestoreRef = useRef<number | null>(null);

  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [machineUrl, setMachineUrl] = useState<string | null>(null);
  const [machineTooltip, setMachineTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const machineTooltipRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadInitialData();
  }, []);

  useEffect(() => {
    rowDataMirrorRef.current = rowData;
  }, [rowData]);

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
    const loadTodaySnapshot = async () => {
      try {
        const todayKey = dayjs().tz('Asia/Tokyo').format('YYYYMMDD');
        const snapshotId = `${storeId}_${todayKey}`;
        const snap = await getDoc(doc(db, 'site777Snapshots', snapshotId));
        if (!snap.exists()) {
          if (!cancelled) {
            setTodayDiffMap({});
            setHasTodayDiffData(false);
            todaySnapshotMapRef.current = {};
          }
          return;
        }

        const payload = snap.data() as { data?: Record<string, any> };
        const entries = payload?.data ?? {};
        const nextMap: Record<string, number> = {};
        const detailMap: Record<string, TodaySnapshotItem> = {};

        Object.entries(entries).forEach(([key, item]) => {
          const machineKey = String(item?.machineNumber ?? key);
          const currentDiff = item?.currentDifference;
          const n = typeof currentDiff === 'number'
            ? currentDiff
            : (typeof currentDiff === 'string' && currentDiff.trim() !== '' ? Number(currentDiff) : NaN);
          detailMap[machineKey] = item as TodaySnapshotItem;
          if (Number.isFinite(n)) {
            nextMap[machineKey] = n;
          }
        });

        if (!cancelled) {
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
        }
      }
    };

    loadTodaySnapshot();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (numberRowDataRef.current.length === 0) return;
    numberRowDataRef.current = applyTodayDiffToRows(numberRowDataRef.current, todayDiffMap);
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
  }, [todayDiffMap, viewMode]);

  useEffect(() => {
    const updateTodayColumnVisibility = (cols: ColDef[]) =>
      (cols ?? []).map((col) => (
        col?.field === 'todayDiff'
          ? { ...col, hide: !hasTodayDiffData }
          : col
      ));

    numberColDefsRef.current = updateTodayColumnVisibility(numberColDefsRef.current);

    if (viewMode === 'number') {
      setColumnDefs(numberColDefsRef.current);
    }
  }, [hasTodayDiffData, viewMode]);

  useEffect(() => {
    if (modalOpen && selectedCell) {
      const originalFlag = selectedCell?.rowData?.flag?.[selectedCell.field] ?? 0;
      setSelectedFlag(originalFlag);

      const originalUrl = selectedCell?.rowData?.urls?.[selectedCell.field] ?? "";
      setselectedCellUrl(originalUrl);

    }
  }, [modalOpen, selectedCell]);

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

  const loadInitialData = async () => {
    const nowJST = dayjs().tz('Asia/Tokyo');
    const hour = nowJST.hour();
    // const minute = nowJST.minute();
    const isBefore = hour < 1;
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
      const machineKey = String(row?.machineNumber ?? '');
      const snapshot = todaySnapshotMapRef.current[machineKey];
      if (!snapshot) return;
      setTodayDetailItem(snapshot);
      setTodayDetailModalOpen(true);
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
  const raw = await fetchSlotDiffs(storeId, dates);

  // 生データを累積（機種別で使う）
  Object.entries(raw).forEach(([k, v]) => {
    rawMapRef.current[k] = v;
  });

  // 台番別（最新日付の配列を基軸に transform）
  const latestKey = dates[dates.length - 1];
  const latest = raw[latestKey] || Object.values(raw)[0] || [];

  const numberRows = transformToGridData(latest, raw);

  // ★ 読み込み済み + 追加日付から「実効的な最新日付」を決定
  const allLoaded = new Set<string>([...Array.from(loadedDates), ...dates]);
  const allLoadedArr = [...allLoaded];
  const effectiveLatestDate = pickEffectiveLatestDate(rawMapRef.current, allLoadedArr);

  // 台番別の“元データ”を更新（next の順序を尊重）
  numberRowDataRef.current = mergeRowData(numberRowDataRef.current, numberRows);
  numberRowDataRef.current = applyTodayDiffToRows(numberRowDataRef.current, todayDiffMap);

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
    hasTodayDiffData,
    getTooltipColor,
    getTooltipText
  );

  numberColDefsRef.current = [...numberColDefsRef.current, ...newCols];
  setLoadedDates(prev => new Set([...Array.from(prev), ...dates]));

  if (viewMode === 'number') {
    setRowData(numberRowDataRef.current);
    setColumnDefs(numberColDefsRef.current);
  } else if (viewMode === 'model') {
    buildAndSetGrouped(allLoadedArr);
  } else {
    buildAndSetTail(allLoadedArr);
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

    const v = props.value;
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
    const field = props.colDef.field as string;
    const flag = props.node?.data?.flag?.[field];

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
        {v === null || v === undefined || v === '-' ? '-' : v.toLocaleString?.() ?? v}
      </div>
    );
  };

  const handleSelectChange = (e: SelectChangeEvent) => {
    const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement;
    if (gridBody) gridBody.scrollTop = 0;
    setSelectedName(e.target.value);
    virtualizationPendingRef.current = true;
    setDisableVirtualization(true);
  };

  // ========= 機種別（平均） =========
  const buildAndSetGrouped = (loadedDatesOverride?: string[]) => {
    const allData = rawMapRef.current;

    // 読み込み済み日付（降順：最新→古い）
    const loaded = (loadedDatesOverride ?? Array.from(loadedDates)).sort((a, b) => b.localeCompare(a));

    // latest は読み込み済みの最新日付のデータ
    const latestKey = loaded[0];
    const latest = (latestKey && allData[latestKey]) ? allData[latestKey] : Object.values(allData)[0] ?? {};

    // あなたの transform に合わせる（機種名＋各日付の平均差枚、台番は空欄）
    const groupedRows = transformToGroupedGridData(latest, allData);
    const groupedWithToday = applyTodayDiffToGroupedRows(groupedRows, numberRowDataRef.current);
    setRowData(groupedWithToday);

    // 機種名（name優先、なければmodelName）＋日付列（降順）
    const effectiveLatestDate = pickEffectiveLatestDate(allData, loaded);
    const groupedCols = buildGroupedColumnsForDates(
      loaded,
      [],
      showModal,
      effectiveLatestDate || '',
      hasTodayDiffData
    );
    setColumnDefs(groupedCols);
  };

  // ========= 末尾別（平均） =========
  const buildAndSetTail = (loadedDatesOverride?: string[]) => {
    const allData = rawMapRef.current;
    const loaded = (loadedDatesOverride ?? Array.from(loadedDates)).sort((a, b) => b.localeCompare(a));
    const effectiveLatestDate = pickEffectiveLatestDate(allData, loaded);

    const tailRows = transformToTailGridData(allData);
    const tailWithToday = applyTodayDiffToTailRows(tailRows, numberRowDataRef.current);
    const tailCols = buildTailColumnsForDates(loaded, effectiveLatestDate || '', hasTodayDiffData);

    setRowData(tailWithToday);
    setColumnDefs(tailCols);
  };

  // ========= タブ切替 =========
  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    const newMode: ViewMode = newValue === 0 ? 'number' : newValue === 1 ? 'model' : 'tail';
    setViewMode(newMode);
    if (newMode === 'tail') {
      setSelectedName('');
    }

    // スクロールリセット
    const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement;
    if (gridBody) gridBody.scrollTop = 0;

    setTimeout(() => {
      const api = gridRef.current?.api;
      if (api) api.ensureIndexVisible(0, 'top');
    }, 0);

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

      <div style={{ height: '76vh', width: '100%' }}>
        <div className="ag-theme-alpine" style={{ height: '100%', width: '100%' }}>
          <AgGridReact
            ref={gridRef}
            rowData={filteredRowData}
            columnDefs={columnDefs}
            components={{
              customCellRenderer: CustomCellRenderer,
              groupedCellRenderer: GroupedCellRenderer,
            }}
            suppressMovableColumns={true}
            suppressHorizontalScroll={false}
            suppressRowVirtualisation={disableVirtualization}
            suppressColumnVirtualisation={disableVirtualization}
            getRowHeight={() => (viewMode === 'tail' ? 34 : 22)}
            headerHeight={20}
            defaultColDef={{
              resizable: false,
              cellStyle: {
                fontSize: '0.8em',
                padding: 0,
                textAlign: 'center',
                borderRight: '1px solid #ccc',
              },
              headerClass: 'custom-header',
            }}
            onModelUpdated={() => {
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
      <div style={{ marginTop: 6, height: "5vh" }}>
      {viewMode !== 'tail' ? (
        <FormControl variant="outlined"  fullWidth style={{ width: 240 }}>
          <Select
            labelId="machine-select-label"
            value={selectedName}
            onChange={handleSelectChange}
            displayEmpty
            style={{ height: 30, fontSize: "0.8em" }}
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
      ) : <div style={{ width: 240 }} />}

      <Button
        variant="contained"
        color="primary"
        onClick={handleExportXlsx}
        style={{  padding: "3px 12px", marginLeft: 10 }}
      >
        Excel出力
      </Button>
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
          setTodayDetailModalOpen(false);
          setTodayDetailItem(null);
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                  src={todayDetailItem.graphImageUrl}
                  alt="当日グラフ"
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
              <div>当日差枚: {todayDetailItem.currentDifference ?? '-'}</div>
              <div>更新: {todayDetailItem.dataUpdatedAt ?? '-'}</div>
            </div>

            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>大当り履歴</div>
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
                    {Array.isArray(todayDetailItem.oatariHistory) && todayDetailItem.oatariHistory.length > 0 ? (
                      todayDetailItem.oatariHistory.map((h, idx) => {
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
      </Modal>

      {/* モーダル（台番別のみ） */}
      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={async () => {
          if (!selectedCell || selectedFlag === null) return;

          const dateField = selectedCell.field; // YYYYMMDD
          const db = getFirestore();
          const ref = doc(db, 'slot_diff', `${storeId}_${dateField}`);
          const snap = await getDoc(ref);
          if (!snap.exists()) return;

          const data = snap.data().data;
          const targetName = selectedCell.rowData.name ?? selectedCell.rowData.modelName ?? '';
          const targetNumber = selectedCell.rowData.machineNumber ?? '';

          const dataKey    = selectedCell.rowData.dataKey;
          const originalFlag = selectedCell?.rowData?.flag?.[dateField] ?? 0;

          // 台番別と機種別で分岐
          if (viewMode === 'model') {
            // ★ 機種別：同一機種名の全台を selectedFlag（9 or 0）で一括更新
            if (![9, 0].includes(selectedFlag)) return;

            const ops: Array<{ path: FieldPath; value: any }> = [];
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              if (val.name === targetName) {
                ops.push({ path: new FieldPath('data', key, 'flag'), value: selectedFlag });
              }
            });

            if (ops.length === 0) {
              setModalOpen(false);
              return;
            }

            if (ops.length === 1) {
              await updateDoc(ref, ops[0].path, ops[0].value);
            } else {
              const batch = writeBatch(db);
              ops.forEach(op => batch.update(ref, op.path, op.value));
              await batch.commit();
            }

            // ローカル反映（台番別の元データ／現在表示データ／機種別行）
            numberRowDataRef.current.forEach((row: any) => {
              if (row?.name !== targetName) return;
              if (!row.flag) row.flag = {};
              row.flag[dateField] = selectedFlag;
            });
            rowDataRef.current.forEach((row: any) => {
              if (row?.name !== targetName) return;
              if (!row.flag) row.flag = {};
              row.flag[dateField] = selectedFlag;
            });
            pendingScrollRestoreRef.current = getCurrentVerticalScrollTop();
            setRowData(prev =>
              prev.map((r: any) => {
                const nm = r.name ?? r.modelName;
                if (nm !== targetName) return r;
                const next = { ...r, flag: { ...(r.flag ?? {}) } };
                next.flag[dateField] = selectedFlag;
                return next;
              })
            );

            setModalOpen(false);
            gridRef.current?.api?.refreshCells({ force: true });
            return;
          }

          // ★ ここから先は従来の「台番別」ロジック（既存と同等）
          const ops: Array<{ path: FieldPath; value: any }> = [];

          // 1) 全台系 → フラグ解除（同機種すべて 0）
          if (originalFlag === 9 && selectedFlag === 0) {
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              if (val.name === targetName) {
                ops.push({ path: new FieldPath('data', key, 'flag'), value: 0 });
              }
            });
          }
          // 2) 全台系 選択（同機種すべて 9）
          else if (selectedFlag === 9) {
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              if (val.name === targetName) {
                ops.push({ path: new FieldPath('data', key, 'flag'), value: 9 });
              }
            });
          }
          // 3) 個別更新（対象セルのみ）
          else {
            Object.entries(data).forEach(([key, val]: [string, any]) => {
              if (val.name === targetName && val.machineNumber === targetNumber) {
                ops.push({ path: new FieldPath('data', key, 'flag'), value: selectedFlag });
              }
            });
          }

          if (ops.length >= 1) {
            const batch = writeBatch(db);
            ops.forEach(op => batch.update(ref, op.path, op.value));
            await batch.commit();
          }

          setModalOpen(false);

          // 画面側へ反映
          const api = gridRef.current?.api;
          if (!api) return;
          const field = dateField;

          rowDataRef.current.forEach((row: any) => {
            if (!row.flag) row.flag = {};
            if (originalFlag === 9 && selectedFlag === 0 && row.name === targetName) {
              row.flag[field] = 0;
            } else if (selectedFlag === 9 && row.name === targetName) {
              row.flag[field] = 9;
            } else if (row.name === targetName && row.machineNumber === targetNumber) {
              row.flag[field] = selectedFlag;
            }
          });

          numberRowDataRef.current.forEach((row: any) => {
            if (!row.flag) row.flag = {};
            if (originalFlag === 9 && selectedFlag === 0 && row.name === targetName) {
              row.flag[field] = 0;
            } else if (selectedFlag === 9 && row.name === targetName) {
              row.flag[field] = 9;
            } else if (row.name === targetName && row.machineNumber === targetNumber) {
              row.flag[field] = selectedFlag;
            }
          });

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
function buildNumberColumns(
  dates: string[],
  existing: ColDef[],
  showModal: Function,
  latestDate: string,        // ★ 追加
  hasTodayDiffData: boolean,
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
      valueGetter: (p) => getDisplayName(p.data?.name),
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
      headerName: '当日',
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


// SlotDiffGrid.tsx の下の方に追加
function getDisplayName(name: string): string {
  if (!name) return '';
  // ★ 特定機種の省略ルール
  if (name === 'ToLOVEるダークネス TRANCE ver.8.7') {
    return 'ToLOVEるTRANCE'; // ← 省略名
  }
  if (name === '革命機ヴァルヴレイヴ2') {
    return 'ヴヴヴ2'; // ← 省略名
  }
  return name;
}

// ========= 機種別（平均）columns =========
function buildGroupedColumnsForDates(
  dates: string[],
  existing: ColDef[],
  showModal: (value: any, row: any, field: string) => void,
  latestDate: string,
  hasTodayDiffData: boolean
): ColDef[] {  const existingFields = new Set(existing.map(c => c.field));
  const cols: ColDef[] = [];

  const isMissingLatest = (row: any) => {
    if (!latestDate) return false;
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-';
  };

  if (!existingFields.has('name')) {
    cols.push({
      headerName: '機種名',
      field: 'name',
      valueGetter: (p) => getDisplayName(p.data?.name ?? p.data?.modelName ?? ''),
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
      headerName: '当日',
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      valueFormatter: (p: any) => {
        const v = p?.value;
        if (v === undefined || v === null || v === '-') return '-';
        if (typeof v === 'number') {
          const normalized = Object.is(v, -0) ? 0 : v;
          return normalized.toLocaleString();
        }
        return v;
      },
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
        if (typeof v === 'number') {
          if (v >= 0 || Object.is(v, -0)) base.color = '#4c6cb3';
          else base.color = '#d9333f';
        }
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
    cellStyle: (params) => {
      const v = params.value;
      const row = params.data;
      const field = params.colDef.field as string;

      const flag = row?.flag?.[field];

      let color = '#333';
      if (typeof v === 'number') {
        if (v >= 0) color = '#4c6cb3';
        else if (v < 0) color = '#d9333f';
      }

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

function buildTailColumnsForDates(dates: string[], latestDate: string, hasTodayDiffData: boolean): ColDef[] {
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

  const getHeatmapColor = (winRate: number): string | undefined => {
    // 勝率40%以下は無色、40%超を薄い赤〜濃い赤にマップ
    if (winRate <= 0.4) return undefined;
    const clamped = Math.max(0.4, Math.min(1, winRate));
    const normalized = (clamped - 0.4) / 0.6; // 0..1
    const alpha = 0.12 + normalized * 0.73;
    return `rgba(255, 40, 40, ${alpha.toFixed(3)})`;
  };

  const isMissingLatest = (row: any) => {
    if (!latestDate) return false;
    const v = row?.[latestDate];
    return v === undefined || v === null || v === '-';
  };

  const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));
  const dynamicCols: ColDef[] = sortedDates.map((date) => ({
    headerName: formatDate(date),
    field: date,
    width: 60,
    cellRenderer: (params: any) => {
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
      } else if (parsed) {
        backgroundColor = getHeatmapColor(parsed.winRate);
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
      headerName: '当日',
      field: 'todayDiff',
      hide: !hasTodayDiffData,
      width: 60,
      cellRenderer: (params: any) => {
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
        } else if (parsed) {
          base.backgroundColor = getHeatmapColor(parsed.winRate) ?? '#fff7cc';
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

function mergeRowData(prev: any[], next: any[]): any[] {
  const merged: Record<string, any> = {};
  for (const row of prev) merged[row.id] = { ...row };

  for (const row of next) {
    if (!merged[row.id]) {
      merged[row.id] = { ...row };
    } else {
      const mergedRow = merged[row.id];
      for (const key of Object.keys(row)) {
        if (key !== 'flag' && key !== 'urls') {
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
    }
  }

  return Object.values(merged);
}

function applyTodayDiffToRows(rows: any[], todayDiffMap: Record<string, number>): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const normalizedMap = todayDiffMap ?? {};
  const prevDayKey = dayjs().tz('Asia/Tokyo').subtract(1, 'day').format('YYYYMMDD');

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

function applyTodayDiffToGroupedRows(groupedRows: any[], numberRows: any[]): any[] {
  if (!Array.isArray(groupedRows) || groupedRows.length === 0) return groupedRows;
  if (!Array.isArray(numberRows) || numberRows.length === 0) {
    return groupedRows.map((row) => ({ ...row, todayDiff: '-' }));
  }

  const sumByName: Record<string, number> = {};
  const countByName: Record<string, number> = {};
  let totalSum = 0;
  let totalCount = 0;

  numberRows.forEach((row) => {
    if (!row || row.isTotalRow) return;
    const name = String(row.name ?? '');
    const diff = row.todayDiff;
    if (!name || typeof diff !== 'number') return;
    sumByName[name] = (sumByName[name] ?? 0) + diff;
    countByName[name] = (countByName[name] ?? 0) + 1;
    totalSum += diff;
    totalCount += 1;
  });

  return groupedRows.map((row) => {
    if (!row) return row;
    if (row.isTotalRow) {
      return {
        ...row,
        todayDiff: totalCount > 0 ? Math.round(totalSum / totalCount) : '-',
      };
    }
    const name = String(row.name ?? row.modelName ?? '');
    const count = countByName[name] ?? 0;
    if (count <= 0) return { ...row, todayDiff: '-' };
    return { ...row, todayDiff: Math.round((sumByName[name] ?? 0) / count) };
  });
}

function applyTodayDiffToTailRows(tailRows: any[], numberRows: any[]): any[] {
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
      todayDiff: `${avg}(${g.positiveCount}/${g.count})`,
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

