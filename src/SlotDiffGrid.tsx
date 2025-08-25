import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
    ColDef,
    CellStyleFunc,
    ModuleRegistry,
    RowStyleModule,
    CellStyleModule,
    ClientSideRowModelModule,
    provideGlobalGridOptions
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { fetchSlotDiffs } from './dataFetcher';
import { transformToGridData } from './dataTransformer';
import dayjs from 'dayjs';
// 🔧 追加: Firestore & モーダルUI
import { Modal, Radio } from 'antd';
import { doc, updateDoc, getDoc, getFirestore } from 'firebase/firestore';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'; // 🔧 追加
import { SelectChangeEvent } from '@mui/material/Select'; // ✅ 正しい場所
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// AG Grid モジュール登録
ModuleRegistry.registerModules([ClientSideRowModelModule, RowStyleModule, CellStyleModule]);

interface Props {
    storeId: string;
}

export const SlotDiffGrid: React.FC<Props> = ({ storeId }) => {
    const [columnDefs, setColumnDefs] = useState<ColDef[]>([]);
    const [rowData, setRowData] = useState<any[]>([]);
    const rowDataRef = useRef<any[]>([]);
    const [loadedDates, setLoadedDates] = useState<Set<string>>(new Set());
    const gridRef = useRef<AgGridReact<any>>(null);
    const loadingRef = useRef(false);
    const scrollReady = useRef(false); // ✅ 初回スクロール防止
    const didInitRef = useRef(false);

    // 🔧 追加: モーダル表示用 state
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedCell, setSelectedCell] = useState<{ rowData: any; field: string; value: any } | null>(null);
    const [selectedFlag, setSelectedFlag] = useState<number | null>(null);


    // 🔧 追加: Firestore フラグ更新処理
    const updateFlagInSlotDiff = async (docId: string, dataKey: string, newFlag: number) => {
        const db = getFirestore();
        const ref = doc(db, 'slot_diff', docId);
        await updateDoc(ref, {
            [`data.${dataKey}.flag`]: newFlag
        });
    };

    // 🔧 追加: 機種名フィルタ用
    const [selectedName, setSelectedName] = useState<string>(""); // ✅ 初期値を "" に

    useEffect(() => {
        if (didInitRef.current) return;
        didInitRef.current = true;
        loadInitialData();
    }, []);

    useEffect(() => {
        rowDataRef.current = rowData;
    }, [rowData]);

    useEffect(() => {
        if (modalOpen && selectedCell) {
            const originalFlag = selectedCell?.rowData?.flag?.[selectedCell.field] ?? 0;
            setSelectedFlag(originalFlag); // ✅ これで選択済状態に
        }
    }, [modalOpen, selectedCell]);

    // 🔧 1. useMemo でフィルタ済みデータを計算
    const filteredRowData = useMemo(() => {
        return selectedName
            ? rowData.filter((r) => r.name === selectedName)
            : rowData;
    }, [selectedName, rowData]);


    const loadInitialData = async () => {
        const nowJST = dayjs().tz('Asia/Tokyo');
        const hour = nowJST.hour();
        const minute = nowJST.minute();

        const isBefore820 = hour < 8 || (hour === 8 && minute < 20);
        const offset = isBefore820 ? 2 : 1;

        const initialDates = getPastDates(30, offset);
        await loadDates(initialDates);
        scrollReady.current = true; // ✅ スクロール処理有効化
    };

    const loadMoreDates = async () => {
        if (loadingRef.current) return;
        loadingRef.current = true;

        const alreadyLoaded = loadedDates.size;
        const nextDates = getPastDates(30, alreadyLoaded);
        await loadDates(nextDates);

        loadingRef.current = false;
    };

    const showModal = useCallback((value: any, rowData: any, field: string) => {
        setSelectedCell({ value, rowData, field });
        setSelectedFlag(null);
        setModalOpen(true);
    }, []);

    const loadDates = async (dates: string[]) => {
        const raw = await fetchSlotDiffs(storeId, dates);
        const latestKey = dates[dates.length - 1];
        const latest = raw[latestKey] || Object.values(raw)[0] || [];

        const rows = transformToGridData(latest, raw);
        // 🔧 修正: showModal を渡すよう変更
        const newCols = buildColumns(dates, columnDefs, showModal);

        setRowData(prev => mergeRowData(prev, rows));
        setColumnDefs(prev => [...prev, ...newCols]);
        setLoadedDates(prev => new Set([...Array.from(prev), ...dates]));
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
            loadMoreDates();
        }
    };

    const CustomCellRenderer = (props: any) => {
        const lastTap = useRef<number | null>(null);
      
        const handleClick = () => {
          const now = Date.now();
          if (lastTap.current && now - lastTap.current < 300) {
            props.showModal(props.value, props.node.data, props.colDef.field); // ✅ ダブルタップ／ダブルクリックで起動
          }
          lastTap.current = now;
        };
      
        return (
          <div
            onClick={handleClick}  // ✅ PC・スマホ共通でダブルタップ検知
            style={{ width: '100%', height: '100%' }}
          >
            {props.value === 0 || props.value === null || props.value === undefined ? '-' : props.value}
          </div>
        );
      };

    const handleSelectChange = (e: SelectChangeEvent) => {
        // 🔽 スクロール先にリセットする
        const gridBody = document.querySelector('.ag-body-viewport') as HTMLElement;
        if (gridBody) {
          gridBody.scrollTop = 0; // ← 🎯 グリッドの縦スクロールを即座に上へ
        }
      
        setSelectedName(e.target.value);
      };

    return (
        <>
            <div style={{ height: '80vh', width: '100%' }}>
                <div className="ag-theme-alpine" style={{ height: '100%', width: '100%', }}>
                    <AgGridReact
                        ref={gridRef}
                        rowData={filteredRowData} // 🔧 変更
                        columnDefs={columnDefs}
                        components={{ customCellRenderer: CustomCellRenderer }} // 🔧 追加
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
                    {rowData
                        .map((r) => r.name)
                        .filter((v, i, arr) => v && arr.indexOf(v) === i) // ✅ 空行 + 重複除去
                        .sort((a, b) => a.localeCompare(b, 'ja'))
                        .map((name) => (
                            <MenuItem key={name} value={name}>
                                {name}
                            </MenuItem>
                        ))}
                </Select>
            </FormControl>


            {/* 🔧 追加: モーダルUI */}
            <Modal
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={async () => {
                    if (!selectedCell || selectedFlag === null) return;

                    const docId = `${storeId}_${selectedCell.field}`;
                    const db = getFirestore();
                    const ref = doc(db, 'slot_diff', docId);
                    const snap = await getDoc(ref);
                    if (!snap.exists()) return;

                    const data = snap.data().data;
                    const targetName = selectedCell.rowData.name;
                    const dataKey = selectedCell.rowData.dataKey;

                    const originalFlag = selectedCell?.rowData?.flag?.[selectedCell.field] ?? 0;

                    const updates: Record<string, any> = {};

                    // ✅ 全台系 → フラグ解除 の場合、同機種全台を 0 に
                    if (originalFlag === 9 && selectedFlag === 0) {
                        Object.entries(data).forEach(([key, val]: [string, any]) => {
                            if (val.name === targetName) {
                                updates[`data.${key}.flag`] = 0;
                            }
                        });
                    }
                    // ✅ 全台系 選択 → 同機種を 9 に
                    else if (selectedFlag === 9) {
                        Object.entries(data).forEach(([key, val]: [string, any]) => {
                            if (val.name === targetName) {
                                updates[`data.${key}.flag`] = 9;
                            }
                        });
                    }
                    // ✅ 通常の個別更新
                    else {
                        updates[`data.${dataKey}.flag`] = selectedFlag;
                    }

                    await updateDoc(ref, updates);
                    setModalOpen(false);

                    const api = gridRef.current?.api;
                    if (!api) return;

                    const field = selectedCell.field;

                    // ✅ rowDataRef も同様に反映
                    rowDataRef.current.forEach(row => {
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
                <p>台番号: {selectedCell?.rowData.machineNumber}</p>
                <p>日付: {selectedCell?.field}</p>
                <Radio.Group
                    onChange={(e) => setSelectedFlag(Number(e.target.value))}
                    value={selectedFlag}
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

// 🔧 修正: showModal を受け取るように変更
function buildColumns(dates: string[], existing: ColDef[], showModal: Function): ColDef[] {
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
            cellRenderer: 'customCellRenderer', // 🔧 追加
            cellRendererParams: { showModal },  // 🔧 追加
            cellStyle: (params) => {
                const v = params.value;
                const row = params.data;
                const field = params.colDef.field;

                if (typeof field !== 'string') return {};

                const flag = row?.flag?.[field];

                let color = '#ccc';
                let backgroundColor;

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
                } as any; // ← ここが重要
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
                ...row.flag,       // 追加された日付用
                ...mergedRow.flag, // 既存のユーザー更新を優先
            };
        }
    }

    return Object.values(merged);
}
