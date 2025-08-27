import React, { useCallback } from 'react';
import type { GridApi } from 'ag-grid-community';

type Props = {
  getApi: () => GridApi | null;
  filename?: string;
  label?: string;
  className?: string;
};

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CsvExportButton: React.FC<Props> = ({
  getApi,
  filename = `slot-diff_${new Date().toISOString().slice(0,10)}.csv`,
  label = 'CSV出力',
  className = 'px-3 py-1.5 rounded bg-gray-800 text-white text-sm',
}) => {
  const handleClick = useCallback(() => {
    const api = getApi();
    if (!api) return;

    // Column API 取得（型差異吸収）
    const columnApi: any =
      (api as any).getColumnApi?.() ??
      (api as any).columnApi ??
      null;

    // 表示中カラム（見た目順）を取得
    const displayedColumns: any[] =
      columnApi?.getAllDisplayedColumns?.() ??
      (api as any).getAllDisplayedColumns?.() ??
      (api as any).getDisplayedCenterColumns?.() ?? // 古い版
      (api as any).getColumns?.() ??
      [];

    const columns = displayedColumns.filter((c: any) =>
      typeof c.isVisible !== 'function' ? true : c.isVisible()
    );

    // ヘッダ行
    const headers = columns.map((col: any) => {
      const def = col.getColDef ? col.getColDef() : col.colDef;
      const header = def?.headerName ?? def?.field ?? (col.getColId ? col.getColId() : col.colId) ?? '';
      return escapeCsv(header);
    });
    const lines: string[] = [headers.join(',')];

    // 値の取得ロジック（valueGetter > field > colId）
    const getCellRawValue = (col: any, rowNode: any) => {
      const def = col.getColDef ? col.getColDef() : col.colDef || {};
      const colId = col.getColId ? col.getColId() : col.colId;

      // valueGetter（function 想定）を評価
      if (typeof def.valueGetter === 'function') {
        try {
          const params = {
            data: rowNode?.data,
            node: rowNode,
            colDef: def,
            column: col,
            api,
            columnApi,
            context: (api as any).context ?? undefined,
            getValue: (field: string) => {
              // 簡易 getValue: data[field] を返す
              return rowNode?.data ? rowNode.data[field] : undefined;
            },
          };
          return def.valueGetter(params);
        } catch {
          // valueGetter 評価失敗時は後段へフォールバック
        }
      }

      // field
      if (def.field) {
        return rowNode?.data ? rowNode.data[def.field] : undefined;
      }

      // フォールバック：colId をキーにする
      return rowNode?.data ? rowNode.data[colId] : undefined;
    };

    // valueFormatter（function 想定）で最終表示値に近づける
    const formatCellValue = (col: any, rowNode: any, raw: any) => {
      const def = col.getColDef ? col.getColDef() : col.colDef || {};
      if (typeof def.valueFormatter === 'function') {
        try {
          const params = {
            value: raw,
            data: rowNode?.data,
            node: rowNode,
            colDef: def,
            column: col,
            api,
            columnApi,
            context: (api as any).context ?? undefined,
          };
          return def.valueFormatter(params);
        } catch {
          // フォーマッタ失敗時は raw を返す
        }
      }
      return raw;
    };

    // データ行（フィルタ/ソート後）
    api.forEachNodeAfterFilterAndSort((rowNode: any) => {
      if (rowNode?.group) return; // グループ行は除外

      const rowVals = columns.map((col: any) => {
        const raw = getCellRawValue(col, rowNode);
        const formatted = formatCellValue(col, rowNode, raw);
        return escapeCsv(formatted);
      });

      lines.push(rowVals.join(','));
    });

    const csv = lines.join('\r\n');
    const bom = '\uFEFF'; // Excel 対策
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`;

    if ((window.navigator as any).msSaveOrOpenBlob) {
      (window.navigator as any).msSaveOrOpenBlob(blob, safeName);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }, [getApi, filename]);

  return (
    <button type="button" onClick={handleClick} className={className} title="表示中のデータをCSV出力">
      {label}
    </button>
  );
};

export default CsvExportButton;
