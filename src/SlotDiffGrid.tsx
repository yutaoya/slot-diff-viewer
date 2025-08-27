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
    setSelectedCell({ value, rowData: row, field });
    setSelectedFlag(null);
    setModalOpen(true);
  }, []);

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
    const groupedCols = buildGroupedColumnsForDates(loaded, [], showModal);
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
              bgColor = styleObj.backgroundColor;
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
    saveAs(new Blob([buffer]), `slot-diff_${new Date().toISOString().slice(0,10)}.xlsx`);
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
      <div style={{ marginTop: 6, height: "5vh" }}>
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

      <Button
        variant="contained"
        color="primary"
        onClick={handleExportXlsx}
        style={{  padding: "3px 12px", marginLeft: 10 }}
      >
        Excel出力
      </Button>
      </div>

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
            ops.push({ path: new FieldPath('data', dataKey, 'flag'), value: selectedFlag });
          }

          if (ops.length === 1) {
            await updateDoc(ref, ops[0].path, ops[0].value);
          } else if (ops.length > 1) {
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
            } else if (row.dataKey === dataKey) {
              row.flag[field] = selectedFlag;
            }
          });

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

          api.refreshCells({ force: true });
        }}


        title="フラグ設定"
      >
        <p>台番号: {selectedCell?.rowData?.machineNumber}</p>
        <p>機種名: {selectedCell?.rowData?.name ?? selectedCell?.rowData?.modelName}</p>
        <p>日付: {selectedCell?.field}</p>
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
function buildGroupedColumnsForDates(
  dates: string[],
  existing: ColDef[],
  showModal: (value: any, row: any, field: string) => void
): ColDef[] {  const existingFields = new Set(existing.map(c => c.field));
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
    // ★ 機種別でもダブルタップでモーダル起動
    cellRendererParams: { showModal },
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
