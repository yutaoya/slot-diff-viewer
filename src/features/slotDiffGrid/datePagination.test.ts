import { getOlderDateKeys } from './datePagination';

describe('getOlderDateKeys', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts before the oldest loaded date regardless of order or duplicates', () => {
    expect(getOlderDateKeys(['20261008', '20261006', '20261007', '20261006'], 3)).toEqual([
      '20261005', '20261004', '20261003',
    ]);
  });

  it('defaults to 30 dates and accepts a Set', () => {
    const dates = getOlderDateKeys(new Set(['20261008', '20261001']));

    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe('20260930');
    expect(dates[29]).toBe('20260901');
    expect(new Set(dates).size).toBe(30);
  });

  it('continues a before-8am initial range without overlap when the current day changes', () => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(new Date('2026-10-09T07:59:00+09:00'));
    const loadedDates = ['20261007', '20261006', '20260908'];
    const datesBefore = getOlderDateKeys(loadedDates, 3);

    jest.setSystemTime(new Date('2026-10-10T08:01:00+09:00'));

    expect(datesBefore).toEqual(['20260907', '20260906', '20260905']);
    expect(getOlderDateKeys(loadedDates, 3)).toEqual(datesBefore);
    expect(getOlderDateKeys([...loadedDates, ...datesBefore], 2)).toEqual(['20260904', '20260903']);
  });

  it.each([
    { dateKey: '20260101', expected: ['20251231', '20251230'] },
    { dateKey: '20260301', expected: ['20260228', '20260227'] },
    { dateKey: '20240301', expected: ['20240229', '20240228'] },
  ])('handles month, year and leap-year boundaries before $dateKey', ({ dateKey, expected }) => {
    expect(getOlderDateKeys([dateKey], 2)).toEqual(expected);
  });

  it('ignores invalid date keys, including dates normalized into a different month', () => {
    expect(getOlderDateKeys([
      '', 'invalid', '2026-01-01', '2026011', '20260230', '20260229', '20260001', '20261301', '20260401',
    ], 2)).toEqual(['20260331', '20260330']);
  });

  it('returns no dates when there are no valid loaded dates', () => {
    expect(getOlderDateKeys([])).toEqual([]);
    expect(getOlderDateKeys(['20260230', 'invalid'])).toEqual([]);
  });

  it.each([0, -1, NaN, Infinity])('returns no dates for an invalid count of %s', (count) => {
    expect(getOlderDateKeys(['20261008'], count)).toEqual([]);
  });
});
