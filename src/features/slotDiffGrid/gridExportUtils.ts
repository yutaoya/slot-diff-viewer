import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(timezone);

// CSV/XLSX 出力機能を画面本体から分離。
// 表示値の抽出手順は既存実装を維持し、出力仕様を変えないことを優先する。

/**
 * CSV の1セル値をエスケープする。
 * @param val 文字列化対象の値
 */
const escapeCsv = (val: any): string => {
  if (val == null) return '';
  const s = String(val);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * AG Grid の列定義から、表示対象の末端カラムのみを抽出する。
 * @param colDefs AG Grid columnDefs
 */
const pickVisibleLeafColDefs = (colDefs: any[]) => {
  /**
   * グループ列を再帰的に平坦化する。
   * @param defs 現在階層の列定義
   * @param acc 蓄積先配列
   */
  const flat = (defs: any[], acc: any[] = []): any[] =>
    defs.reduce((a, d) => {
      if (Array.isArray(d?.children) && d.children.length) return flat(d.children, a);
      a.push(d);
      return a;
    }, acc);

  const defs = flat(colDefs ?? []);
  return defs.filter((d) => d && d.hide !== true && !d.rowGroup && !d.pivot);
};

/**
 * columnDef からセル値を評価する。
 * @param def 対象カラム定義
 * @param row 行データ
 */
const getCellValueFromDef = (def: any, row: any): any => {
  if (typeof def?.valueGetter === 'function') {
    try {
      const params = {
        data: row,
        colDef: def,
        getValue: (field: string) => (row ? row[field] : undefined),
      };
      return def.valueGetter(params);
    } catch {
      // 既存挙動維持: valueGetter エラー時は fallback
    }
  }
  if (def?.field) return row ? row[def.field] : undefined;
  if (def?.colId) return row ? row[def.colId] : undefined;
  return undefined;
};

/**
 * columnDef の valueFormatter を適用する。
 * @param def 対象カラム定義
 * @param row 行データ
 * @param value フォーマット前の値
 */
const applyValueFormatterFromDef = (def: any, row: any, value: any) => {
  if (typeof def?.valueFormatter === 'function') {
    try {
      const params = { value, data: row, colDef: def };
      return def.valueFormatter(params);
    } catch {
      // 既存挙動維持: formatter エラー時は生値
    }
  }
  return value;
};

/**
 * 画面で表示している行/列定義から CSV 文字列を作る。
 * @param rows 出力対象の行配列
 * @param colDefs 出力対象の列定義
 */
export function buildCsvFromGridProps(rows: any[], colDefs: any[]): string {
  const visibleDefs = pickVisibleLeafColDefs(colDefs);
  const headers = visibleDefs.map((d) => d.headerName ?? d.field ?? d.colId ?? '');

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
}

/**
 * CSV テキストをダウンロードする。
 * @param csv 出力するCSV文字列
 * @param baseName 拡張子なしファイル名
 */
export function downloadCsv(csv: string, baseName = 'export') {
  const bom = '\uFEFF';
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
}

/**
 * CSS16進色を ExcelJS が要求する ARGB 形式へ変換する。
 * @param hexColor `#RRGGBB` または `AARRGGBB`
 */
const toArgb = (hexColor: string): string | undefined => {
  const hex = hexColor.replace('#', '');
  if (hex.length === 6) return `FF${hex.toUpperCase()}`;
  if (hex.length === 8) return hex.toUpperCase();
  return undefined;
};

/**
 * 画面用カラーを XLSX 出力向けに補正する。
 * @param color 元の背景色
 */
const remapExportBgColor = (color: string): string => {
  if (color === '#FFBFC7') return '#FF0000';
  if (color === '#5bd799') return '#008000';
  if (color === '#D3B9DE') return '#5a4498';
  if (color === '#FFE899') return '#ffff00';
  return color;
};

type ExportXlsxParams = {
  columnDefs: any[];
  rowData: any[];
  storeId: string;
};

/**
 * 表示中グリッドを XLSX として出力する。
 * @param params 出力対象の列/行データと店舗ID
 * @param params.columnDefs AG Grid columnDefs
 * @param params.rowData AG Grid rowData
 * @param params.storeId ファイル名生成に使う店舗ID
 */
export async function exportVisibleGridToXlsx({ columnDefs, rowData, storeId }: ExportXlsxParams) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  // 既存実装維持: XLSX はトップレベルの表示カラムを対象とする。
  const visibleDefs = (columnDefs ?? []).filter((d: any) => !d.hide && !d.rowGroup && !d.pivot);
  const headers = visibleDefs.map((d: any) => d.headerName ?? d.field ?? d.colId ?? '');
  worksheet.addRow(headers);

  (rowData ?? []).forEach((row: any) => {
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

    visibleDefs.forEach((def: any, i: number) => {
      let bgColor: string | undefined;

      if (typeof def.cellStyle === 'object' && def.cellStyle.backgroundColor) {
        bgColor = def.cellStyle.backgroundColor;
      } else if (typeof def.cellStyle === 'function') {
        try {
          const styleObj = def.cellStyle({ value: row[def.field], data: row, colDef: def });
          if (styleObj && styleObj.backgroundColor) {
            bgColor = remapExportBgColor(styleObj.backgroundColor);
          }
        } catch {
          // 既存挙動維持: style 解決失敗時は塗りつぶしなし
        }
      }

      if (!bgColor) return;
      const argb = toArgb(bgColor);
      if (!argb) return;
      const cell = addedRow.getCell(i + 1);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `${storeId}_${dayjs().tz('Asia/Tokyo').format('YYYYMMDDHHmmss')}.xlsx`;
  saveAs(new Blob([buffer]), fileName);
}
