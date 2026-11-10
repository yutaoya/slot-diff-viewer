import type { ColDef } from 'ag-grid-community';
import {
  applyTodayDiffToRows,
  buildGroupedColumnsForDates,
  buildNumberColumns,
  buildTailColumnsForDates,
  DisplayMetric,
} from './gridUtils';

const readOnlyDate = '20261109';
const normalDate = '20261110';
const dates = [normalDate, readOnlyDate];
const isReadOnlyDate = (field: string) => field === readOnlyDate;

function getCellStyle(columns: ColDef[], field: string, data: any) {
  const column = columns.find((candidate) => candidate.field === field)!;
  if (typeof column.cellStyle !== 'function') throw new Error(`Missing cell style for ${field}`);
  return column.cellStyle({ value: data[field], data, colDef: column } as any);
}

describe('read-only historical date backgrounds', () => {
  it.each(['number', 'model', 'tail'])('%s explicitly clears yellow when a date becomes editable', (view) => {
    let readOnly = true;
    const isCurrentlyReadOnly = (field: string) => readOnly && field === readOnlyDate;
    const columns = view === 'number'
      ? buildNumberColumns(
          dates, [], () => {}, normalDate, '本日', true, (name) => name,
          () => undefined, () => undefined, undefined, undefined, isCurrentlyReadOnly
        )
      : view === 'model'
        ? buildGroupedColumnsForDates(
            dates, [], () => {}, normalDate, '本日', true, (name) => name,
            'diff', undefined, undefined, isCurrentlyReadOnly
          )
        : buildTailColumnsForDates(dates, normalDate, '本日', true, 'diff', [], isCurrentlyReadOnly);
    const row = { [normalDate]: 100, [readOnlyDate]: 100 };

    expect(getCellStyle(columns, readOnlyDate, row)?.backgroundColor).toBe('#fff7cc');
    readOnly = false;
    // AG Grid ignores undefined styles, so an empty string must remove the old color.
    expect(getCellStyle(columns, readOnlyDate, row)?.backgroundColor).toBe('');
  });

  it.each(['number', 'model diff', 'model games'])('%s gives yellow priority over flags, heatmaps and missing data', (view) => {
    const buildColumns = (heatmapActive: boolean) => {
      const getHeatmapColor = () => '#99aacc';
      if (view === 'number') {
        return buildNumberColumns(
          dates, [], () => {}, normalDate, '本日', true, (name) => name,
          () => undefined, () => undefined, getHeatmapColor, () => heatmapActive, isReadOnlyDate
        );
      }
      return buildGroupedColumnsForDates(
        dates, [], () => {}, normalDate, '本日', true, (name) => name,
        view === 'model games' ? 'games' : 'diff', getHeatmapColor, () => heatmapActive, isReadOnlyDate
      );
    };
    const row = {
      [normalDate]: 100,
      [readOnlyDate]: 100,
      todayDiff: 100,
      flag: { [normalDate]: 9, [readOnlyDate]: 9 },
    };
    const flagColumns = buildColumns(false);
    const heatmapColumns = buildColumns(true);
    const missingRow = { ...row, [normalDate]: '-', flag: {} };

    expect(getCellStyle(flagColumns, readOnlyDate, row)?.backgroundColor).toBe('#fff7cc');
    expect(getCellStyle(flagColumns, normalDate, row)?.backgroundColor).toBe('#FFBFC7');
    expect(getCellStyle(heatmapColumns, readOnlyDate, row)?.backgroundColor).toBe('#fff7cc');
    expect(getCellStyle(heatmapColumns, normalDate, row)?.backgroundColor).toBe('#99aacc');
    expect(getCellStyle(heatmapColumns, readOnlyDate, missingRow)?.backgroundColor).toBe('#fff7cc');
    expect(getCellStyle(heatmapColumns, normalDate, missingRow)?.backgroundColor).toBe('#e0e0e0');
    expect(getCellStyle(flagColumns, readOnlyDate, { ...row, isTotalRow: true })?.backgroundColor).toBe('#fff7cc');
    expect(getCellStyle(heatmapColumns, 'todayDiff', row)?.backgroundColor).toBe('#99aacc');
    expect(getCellStyle(heatmapColumns, 'todayDiff', missingRow)?.backgroundColor).toBe('#e0e0e0');
  });

  it.each<DisplayMetric>(['diff', 'games'])('tail %s keeps normal heatmaps while coloring read-only dates and totals yellow', (metric) => {
    const row = {
      [normalDate]: metric === 'games' ? 3000 : '100(1/1)',
      [readOnlyDate]: metric === 'games' ? 3000 : '100(1/1)',
      todayDiff: metric === 'games' ? 3000 : '100(1/1)',
    };
    const lowRow = { [normalDate]: 1000, [readOnlyDate]: 1000, todayDiff: 1000 };
    const columns = buildTailColumnsForDates(
      dates, normalDate, '本日', true, metric, [lowRow, row], isReadOnlyDate
    );
    const heatmapColor = metric === 'games' ? 'rgba(255, 40, 40, 0.600)' : 'rgba(255, 40, 40, 0.850)';
    const missingRow = { ...row, [normalDate]: '-' };

    expect(getCellStyle(columns, readOnlyDate, row)?.backgroundColor).toBe('#fff7cc');
    expect(getCellStyle(columns, normalDate, row)?.backgroundColor).toBe(heatmapColor);
    expect(getCellStyle(columns, readOnlyDate, missingRow)?.backgroundColor).toBe('#fff7cc');
    expect(getCellStyle(columns, normalDate, missingRow)?.backgroundColor).toBe('#e0e0e0');
    expect(getCellStyle(columns, readOnlyDate, { ...row, isTotalRow: true })?.backgroundColor).toBe('#fff7cc');
    expect(getCellStyle(columns, 'todayDiff', row)?.backgroundColor).toBe(heatmapColor);
    expect(getCellStyle(columns, 'todayDiff', missingRow)?.backgroundColor).toBe('#e0e0e0');
  });
});

describe('applyTodayDiffToRows', () => {
  it('uses the latest prior date with data when the previous day has no store data', () => {
    const rows = [
      { id: '__total__', isTotalRow: true, name: '総差枚' },
      { id: '101_model-a', machineNumber: 101, name: 'model-a', 20260511: 100 },
      { id: '102_model-b', machineNumber: 102, name: 'model-b', 20260511: '-' },
    ];

    const result = applyTodayDiffToRows(rows, {
      101: 1200,
      102: -300,
    }, '20260513');

    expect(result).toEqual([
      { id: '__total__', isTotalRow: true, name: '総差枚', todayDiff: 1200 },
      { id: '101_model-a', machineNumber: 101, name: 'model-a', 20260511: 100, todayDiff: 1200 },
      { id: '102_model-b', machineNumber: 102, name: 'model-b', 20260511: '-', todayDiff: '-' },
    ]);
  });

  it('does not apply today diff to rows missing on the effective prior date', () => {
    const rows = [
      { id: '__total__', isTotalRow: true, name: '総差枚' },
      { id: '101_active', machineNumber: 101, name: 'active', 20260512: 100 },
      { id: '101_ended', machineNumber: 101, name: 'ended', 20260511: 200 },
    ];

    const result = applyTodayDiffToRows(rows, {
      101: 1200,
    }, '20260513');

    expect(result).toEqual([
      { id: '__total__', isTotalRow: true, name: '総差枚', todayDiff: 1200 },
      { id: '101_active', machineNumber: 101, name: 'active', 20260512: 100, todayDiff: 1200 },
      { id: '101_ended', machineNumber: 101, name: 'ended', 20260511: 200, todayDiff: '-' },
    ]);
  });
});
