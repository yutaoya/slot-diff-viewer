import React, { useEffect, useState, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
    ColDef,
    CellStyleFunc,
    ModuleRegistry,
    RowStyleModule ,
    CellStyleModule ,
    ClientSideRowModelModule,
    provideGlobalGridOptions 
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { fetchSlotDiffs } from './dataFetcher';
import { transformToGridData } from './dataTransformer';
import dayjs from 'dayjs';

// AG Grid モジュール登録
ModuleRegistry.registerModules([ClientSideRowModelModule, RowStyleModule, CellStyleModule]);

interface Props {
  storeId: string;
}

export const SlotDiffGrid: React.FC<Props> = ({ storeId }) => {
  const [columnDefs, setColumnDefs] = useState<ColDef[]>([]);
  const [rowData, setRowData] = useState<any[]>([]);
  const [loadedDates, setLoadedDates] = useState<Set<string>>(new Set());
  const gridRef = useRef<AgGridReact<any>>(null);
  const loadingRef = useRef(false);
  const scrollReady = useRef(false); // ✅ 初回スクロール防止

  const didInitRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    const initialDates = getPastDates(30, 1);
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

  const loadDates = async (dates: string[]) => {
    const raw = await fetchSlotDiffs(storeId, dates);
    const latestKey = dates[dates.length - 1];
    const latest = raw[latestKey] || Object.values(raw)[0] || [];

    const rows = transformToGridData(latest, raw);
    const newCols = buildColumns(dates, columnDefs);

    setRowData(prev => mergeRowData(prev, rows));
    setColumnDefs(prev => [...prev, ...newCols]);
    setLoadedDates(prev => new Set([...Array.from(prev), ...dates]));
  };

  const onBodyScroll = async (event: any) => {
    if (!scrollReady.current) return; // ✅ 初回防止
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

  return (
    <div className="ag-theme-alpine" style={{ height: '80vh', width: '100%' }}>
      <AgGridReact
        ref={gridRef}
        rowData={rowData}
        columnDefs={columnDefs}
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
      />
    </div>
  );
};

function buildColumns(dates: string[], existing: ColDef[]): ColDef[] {
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
      width: 100,
      cellStyle: {
        fontSize: '0.7em',
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
      cellStyle: (params) => {
        const v = params.value;
        let color = '#000';
        if (typeof v === 'number') {
          if (v > 0) color = '#4c6cb3';
          else if (v < 0) color = '#d9333f';
        }
        return {
          color,
          fontSize: '0.8em',
          padding: 0,
          fontWeight: 'bold',
          textAlign: 'center',
          borderRight: '1px solid #ccc',
        };
      },
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
    if (!merged[row.id]) merged[row.id] = { ...row };
    else Object.assign(merged[row.id], row);
  }
  return Object.values(merged);
}
