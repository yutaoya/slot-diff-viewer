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
import { transformToGridData, transformToGroupedGridData } from './dataTransformer';

// UI
import { Modal, Radio } from 'antd';
import { doc, updateDoc, getDoc, getFirestore, FieldPath, writeBatch } from 'firebase/firestore';
import { FormControl, MenuItem, Select } from '@mui/material';
import { SelectChangeEvent } from '@mui/material/Select';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

dayjs.extend(utc);
dayjs.extend(timezone);

// AG Grid モジュール登録
ModuleRegistry.registerModules([ClientSideRowModelModule, RowStyleModule, CellStyleModule]);

interface Props {
  storeId: string;
}

type ViewMode = 'number' | 'model'; // 台番別 / 機種別（平均）

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

  // モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ rowData: any; field: string; value: any } | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<number | null>(null);

  // 機種名フィルタ
  const [selectedName, setSelectedName] = useState<string>("");

  // 読み込み済みの「生データ（date => map）」を保持（機種別集計に使用）
  const rawMapRef = useRef<Record<string, any>>({});

  const rowDataRef = useRef<any[]>([]);  // ★ 追加


  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadInitialData();
  }, []);

  useEffect(() => {
    rowDataMirrorRef.current = rowData;
  }, [rowData]);

  useEffect(() => {
    if (modalOpen && selectedCell) {
      const originalFlag = selectedCell?.rowData?.flag?.[selectedCell.field] ?? 0;
      setSelectedFlag(originalFlag);
    }
  }, [modalOpen, selectedCell]);

  useEffect(() => {
    rowDataRef.current = rowData;        // ★ 常に最新の rowData を保持
  }, [rowData]);

  // フィルタ後データ
  const filteredRowData = useMemo(() => {
    if (!selectedName) return rowData;
    return rowData.filter((r) => (r.name ?? r.modelName) === selectedName);
  }, [selectedName, rowData]);

  const loadInitialData = async () => {
    const nowJST = dayjs().tz('Asia/Tokyo');
    const hour = nowJST.hour();
    const minute = nowJST.minute();
    const isBefore820 = hour < 8 || (hour === 8 && minute < 20);
    const offset = isBefore820 ? 2 : 1;

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
    if (viewMode !== 'number') return; // 機種別ではセル編集しない
    setSelectedCell({ value, rowData: row, field });
    setSelectedFlag(null);
    setModalOpen(true);
  }, [viewMode]);

  const loadDates = async (dates: string[]) => {
    const raw = await fetchSlotDiffs(storeId, dates);

    // 生データを累積（機種別で使う）
    Object.entries(raw).forEach(([k, v]) => {
      rawMapRef.current[k] = v;
    });

    // 台番別（最新日付の配列を基軸に transform）
    const latestKey = dates[dates.length - 1];
    const latest = raw[latestKey] || Object.values(raw)[0] || [];

    const numberRows = transformToGridData(latest, raw);
    const newCols = buildNumberColumns(dates, numberColDefsRef.current, showModal);

    // ★ 台番別の“元データ”を更新
    numberRowDataRef.current = mergeRowData(numberRowDataRef.current, numberRows);
    numberColDefsRef.current = [...numberColDefsRef.current, ...newCols];
    setLoadedDates(prev => new Set([...Array.from(prev), ...dates]));

    // ★ 現在のビューに応じて表示を更新
    if (viewMode === 'number') {
      setRowData(numberRowDataRef.current);
      setColumnDefs(numberColDefsRef.current);
    } else {
      // 機種別表示中：平均行/列を再構成
      buildAndSetGrouped();
    }
  };

  const onBodyScroll = async (event: any) => {
    if (!scrollReady.current) return;
    if (event.direction !== 'horizontal') return;

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
        {v === 0 || v === null || v === undefined || v === '-' ? '-' : v.toLocaleString?.() ?? v}
      </div>
    );
  };

  const handleSelectChange = (e: SelectChangeEvent) => {
    const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement;
    if (gridBody) gridBody.scrollTop = 0;
    setSelectedName(e.target.value);
  };

  // ========= 機種別（平均） =========
  const buildAndSetGrouped = () => {
    const allData = rawMapRef.current;

    // 読み込み済み日付（降順：最新→古い）
    const loaded = Array.from(loadedDates).sort((a, b) => b.localeCompare(a));

    // latest は読み込み済みの最新日付のデータ
    const latestKey = loaded[0];
    const latest = (latestKey && allData[latestKey]) ? allData[latestKey] : Object.values(allData)[0] ?? {};

    // あなたの transform に合わせる（機種名＋各日付の平均差枚、台番は空欄）
    const groupedRows = transformToGroupedGridData(latest, allData);
    setRowData(groupedRows);

    // 機種名（name優先、なければmodelName）＋日付列（降順）
    const groupedCols = buildGroupedColumnsForDates(loaded, []);
    setColumnDefs(groupedCols);
  };

  // ========= タブ切替 =========
  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    const newMode: ViewMode = newValue === 0 ? 'number' : 'model';
    setViewMode(newMode);

    // スクロールリセット
    const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement;
    if (gridBody) gridBody.scrollTop = 0;

    setTimeout(() => {
      const api = gridRef.current?.api;
      if (api) api.ensureIndexVisible(0, 'top');
    }, 0);

    if (newMode === 'model') {
      // ★ 機種別（平均）を構成
      buildAndSetGrouped();
    } else {
      // ★ 台番別に“確実に”戻す（ref に保持していた元データを復元）
      setRowData(numberRowDataRef.current);
      setColumnDefs(numberColDefsRef.current);
    }
  };

  const tabValue = viewMode === 'number' ? 0 : 1;

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
        </Tabs>
      </Box>

      <div style={{ height: '76vh', width: '100%' }}>
        <div className="ag-theme-alpine" style={{ height: '100%', width: '100%' }}>
          <AgGridReact
            ref={gridRef}
            rowData={filteredRowData}
            columnDefs={columnDefs}
            components={{ customCellRenderer: CustomCellRenderer }}
            suppressMovableColumns={true}
            suppressHorizontalScroll={false}
            rowHeight={22}
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
            getRowStyle={(params) => {
              if (params.data?.isTotalRow) {
                return {
                  backgroundColor: '#f0f0f0',
                  fontWeight: 'bold',
                };
              }
              return undefined;
            }}
            onBodyScroll={onBodyScroll}
            domLayout="normal"
          />
        </div>
      </div>

      {/* フィルタ（機種名） */}
      <FormControl variant="outlined" style={{ width: 240, marginTop: 6, height: "5vh" }} fullWidth>
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

      {/* モーダル（台番別のみ） */}
      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        // Modal の onOk 内の「更新処理」をまるっと置き換え
        onOk={async () => {
          if (!selectedCell || selectedFlag === null) return;

          const docId = `${storeId}_${selectedCell.field}`;
          const db = getFirestore();
          const ref = doc(db, 'slot_diff', docId);
          const snap = await getDoc(ref);
          if (!snap.exists()) return;

          const data = snap.data().data;
          const targetName = selectedCell.rowData.name;         // ← 既存のまま（完全一致でOKという前提）
          const dataKey    = selectedCell.rowData.dataKey;      // ← 個別更新用
          const originalFlag = selectedCell?.rowData?.flag?.[selectedCell.field] ?? 0;

          // まとめて更新するためのオペレーション配列を作る
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
            ops.push({ path: new FieldPath('data', dataKey, 'flag'), value: selectedFlag });
          }

          // 実行：1件なら updateDoc( FieldPath, value ) 形式、複数なら batch.update
          if (ops.length === 1) {
            await updateDoc(ref, ops[0].path, ops[0].value);
          } else if (ops.length > 1) {
            const batch = writeBatch(db);
            ops.forEach(op => batch.update(ref, op.path, op.value));
            await batch.commit();
          }

          setModalOpen(false);

          // 画面側へ反映（ローカル rowData も更新）— 既存ロジックそのまま
          const api = gridRef.current?.api;
          if (!api) return;
          const field = selectedCell.field;

          // rowDataRef を使っている場合
          if (typeof rowDataRef !== 'undefined') {
            rowDataRef.current.forEach((row: any) => {
              if (!row.flag) row.flag = {};
              if (originalFlag === 9 && selectedFlag === 0 && row.name === targetName) {
                row.flag[field] = 0;
              } else if (selectedFlag === 9 && row.name === targetName) {
                row.flag[field] = 9;
              } else if (row.dataKey === dataKey) {
                row.flag[field] = selectedFlag;
              }
            });
          }

          // numberRowDataRef を使っている構成ならこちらを使用
          if (typeof numberRowDataRef !== 'undefined') {
            numberRowDataRef.current.forEach((row: any) => {
              if (!row.flag) row.flag = {};
              if (originalFlag === 9 && selectedFlag === 0 && row.name === targetName) {
                row.flag[field] = 0;
              } else if (selectedFlag === 9 && row.name === targetName) {
                row.flag[field] = 9;
              } else if (row.dataKey === dataKey) {
                row.flag[field] = selectedFlag;
              }
            });
          }

          api.refreshCells({ force: true });
        }}

        title="フラグ設定"
      >
        <p>台番号: {selectedCell?.rowData?.machineNumber}</p>
        <p>日付: {selectedCell?.field}</p>
        <Radio.Group
          onChange={(e) => setSelectedFlag(Number(e.target.value))}
          value={selectedFlag}
          disabled={viewMode !== 'number'}
        >
          <Radio value={9}>全台系</Radio>
          <Radio value={6}>設定6</Radio>
          <Radio value={5}>設定56</Radio>
          <Radio value={4}>設定456</Radio>
          <Radio value={0}>フラグ解除</Radio>
        </Radio.Group>
      </Modal>
    </>
  );
};

// ================== 台番別（columns） ==================
function buildNumberColumns(dates: string[], existing: ColDef[], showModal: Function): ColDef[] {
  const existingFields = new Set(existing.map(c => c.field));
  const cols: ColDef[] = [];

  if (!existingFields.has('machineNumber')) {
    cols.push({
      headerName: '',
      field: 'machineNumber',
      pinned: 'left',
      width: 40,
      cellStyle: {
        fontSize: '0.8em',
        padding: 0,
        fontWeight: 'bold',
        textAlign: 'center',
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
      cellStyle: {
        fontSize: '0.6em',
        padding: 0,
        whiteSpace: 'normal',
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
          if (v > 0) color = '#4c6cb3';
          else if (v < 0) color = '#d9333f';
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
      }
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
  return name;
}

// ========= 機種別（平均）columns =========
function buildGroupedColumnsForDates(dates: string[], existing: ColDef[]): ColDef[] {
  const existingFields = new Set(existing.map(c => c.field));
  const cols: ColDef[] = [];

  if (!existingFields.has('name')) {
    cols.push({
      headerName: '機種名',
      field: 'name',
      valueGetter: (p) => getDisplayName(p.data?.name ?? p.data?.modelName ?? ''),
      pinned: 'left',
      width: 100,
      cellStyle: {
        fontSize: '0.6rem',
        padding: 0,
        whiteSpace: 'normal',
        textAlign: 'left',
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
      cellRenderer: 'customCellRenderer',
      cellRendererParams: { showModal: () => {} }, // 機種別ではモーダル非活性
      cellStyle: (params) => {
        const v = params.value;
        const row = params.data;
        const field = params.colDef.field as string;

        const flag = row?.flag?.[field];

        let color = '#333';
        if (typeof v === 'number') {
          if (v > 0) color = '#4c6cb3';
          else if (v < 0) color = '#d9333f';
        }

        let backgroundColor: string | undefined;
        switch (flag) {
          case 9: backgroundColor = '#FFBFC7'; break;
          case 6: backgroundColor = '#5bd799'; break;
          case 5: backgroundColor = '#D3B9DE'; break;
          case 4: backgroundColor = '#FFE899'; break;
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
        if (key !== 'flag') {
          mergedRow[key] = row[key];
        }
      }
      mergedRow.flag = {
        ...row.flag,
        ...mergedRow.flag, // 既存のユーザー更新を優先
      };
    }
  }

  return Object.values(merged);
}
