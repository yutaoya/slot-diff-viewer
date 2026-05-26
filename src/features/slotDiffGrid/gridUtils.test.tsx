import { applyTodayDiffToRows } from './gridUtils';

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
