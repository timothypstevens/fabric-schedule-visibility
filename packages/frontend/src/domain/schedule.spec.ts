import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  computeConcurrency, displayDayWindow, expandOccurrences, findSlots, overlapping,
  type Occurrence, type ScheduleDefinition,
} from './index';

function schedule(overrides: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
  return {
    itemKey: 'sample-item',
    itemName: 'Sample item',
    itemType: 'SemanticModel',
    scheduleType: 'Daily',
    scheduleTimes: '06:00',
    timeZoneId: 'America/New_York',
    enabled: true,
    avgDurationSec: 300,
    ...overrides,
  };
}

function utc(iso: string): number {
  return DateTime.fromISO(iso, { zone: 'UTC' }).toMillis();
}

function occurrence(
  start: string, end: string, overrides: Partial<Occurrence> = {},
): Occurrence {
  return {
    id: `${start}:${end}`,
    itemKey: 'sample-item',
    itemName: 'Sample item',
    itemType: 'SemanticModel',
    kind: 'projected',
    noHistory: false,
    startMs: utc(start),
    endMs: utc(end),
    ...overrides,
  };
}

function localStarts(occurrences: readonly Occurrence[], zone = 'America/New_York'): string[] {
  return occurrences.map(({ startMs }) =>
    DateTime.fromMillis(startMs, { zone }).toFormat('yyyy-MM-dd HH:mm ZZ'));
}

describe('expandOccurrences', () => {
  it('projects multiple live schedules only inside validity bounds and keeps interval phase across midnight', () => {
    const base = { enabled: true, timeZoneId: 'UTC', startUtc: '2026-11-16T23:07:00Z', endUtc: '2026-11-17T02:00:00Z' };
    const live = schedule({ liveSchedulesJson: JSON.stringify([
      { ...base, type: 'Interval', intervalMinutes: 70 },
      { ...base, type: 'Daily', times: '01:27' },
      { ...base, type: 'Daily', times: '00:01', enabled: false },
    ]) });
    const starts = expandOccurrences([live], '2026-11-17', 'UTC').map((row) => new Date(row.startMs).toISOString());
    expect(starts).toEqual(['2026-11-17T00:17:00.000Z', '2026-11-17T01:27:00.000Z']);
    expect(expandOccurrences([live], '2026-11-18', 'UTC')).toEqual([]);
    expect(() => expandOccurrences([schedule({ liveSchedulesJson: '[{}]' })], '2026-11-17')).toThrow(/Stored live schedule/);
  });

  it('distinguishes daily, weekly and weekday-restricted daily schedules in the item time zone', () => {
    const items = [
      schedule(),
      schedule({ itemKey: 'weekly', scheduleType: 'Weekly', scheduleDays: 'Fri' }),
      schedule({ itemKey: 'weekdays', scheduleDays: 'Mon,Tue,Wed,Thu,Fri' }),
    ];
    expect(expandOccurrences(items, '2026-11-16').map((item) => item.itemKey))
      .toEqual(['sample-item', 'weekdays']);
    expect(expandOccurrences(items, '2026-11-20')).toHaveLength(3);
    expect(expandOccurrences(items, '2026-11-21')).toHaveLength(1);
    expect(expandOccurrences([schedule({ enabled: false })], '2026-11-16')).toEqual([]);
  });

  it('converts source-calendar days into the selected display day', () => {
    const items = [
      schedule({ itemKey: 'tokyo', timeZoneId: 'Asia/Tokyo', scheduleTimes: '00:30' }),
      schedule({ itemKey: 'la', timeZoneId: 'America/Los_Angeles', scheduleTimes: '23:30' }),
    ];
    expect(localStarts(expandOccurrences(items, '2026-11-16'))).toEqual([
      '2026-11-16 02:30 -05:00',
      '2026-11-16 10:30 -05:00',
    ]);
    expect(localStarts(expandOccurrences([schedule()], '2026-11-16', 'Europe/London'), 'Europe/London'))
      .toEqual(['2026-11-16 11:00 +00:00']);
  });

  it('evaluates weekly restrictions on the source day, not the display day', () => {
    const output = expandOccurrences([schedule({
      scheduleType: 'Weekly', scheduleDays: 'Mon',
      timeZoneId: 'Asia/Tokyo', scheduleTimes: '00:30',
    })], '2026-11-15');
    expect(localStarts(output)).toEqual(['2026-11-15 10:30 -05:00']);
  });

  it('skips nonexistent spring times and selects the earlier repeated fall time exactly once', () => {
    expect(expandOccurrences([schedule({ scheduleTimes: '02:30' })], '2026-03-08')).toEqual([]);
    const fall = expandOccurrences([schedule({ scheduleTimes: '01:30' })], '2026-11-01');
    expect(localStarts(fall)).toEqual(['2026-11-01 01:30 -04:00']);
    expect(fall[0].startMs).toBe(utc('2026-11-01T05:30:00Z'));
  });

  it('uses elapsed duration across a clock change, not wall-clock subtraction', () => {
    const [spring] = expandOccurrences([
      schedule({ scheduleTimes: '01:50', avgDurationSec: 1200 }),
    ], '2026-03-08');
    expect(spring.endMs - spring.startMs).toBe(20 * 60_000);
    expect(DateTime.fromMillis(spring.endMs, { zone: 'America/New_York' }).toFormat('HH:mm'))
      .toBe('03:10');
  });

  it('keeps carry-in and carry-out runs untrimmed and excludes runs ending at midnight', () => {
    const items = [
      schedule({ itemKey: 'carry', scheduleTimes: '23:50', avgDurationSec: 1200 }),
      schedule({ itemKey: 'boundary', scheduleTimes: '23:55', avgDurationSec: 300 }),
    ];
    const output = expandOccurrences(items, '2026-11-16');
    expect(output).toHaveLength(3);
    expect(localStarts(output)).toEqual([
      '2026-11-15 23:50 -05:00',
      '2026-11-16 23:50 -05:00',
      '2026-11-16 23:55 -05:00',
    ]);
    expect(output[0].endMs).toBe(utc('2026-11-16T05:10Z'));
    expect(output[1].endMs).toBe(utc('2026-11-17T05:10Z'));
  });

  it('includes carry-in from more than one day ago for long durations', () => {
    const output = expandOccurrences([
      schedule({ scheduleTimes: '23:00', avgDurationSec: 26 * 3600 }),
    ], '2026-11-16');
    expect(localStarts(output)).toEqual([
      '2026-11-14 23:00 -05:00',
      '2026-11-15 23:00 -05:00',
      '2026-11-16 23:00 -05:00',
    ]);
  });

  it.each([
    ['2026-11-16', 24],
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ])('anchors hourly intervals at local midnight on %s (%i elapsed hours)', (date, count) => {
    const output = expandOccurrences([
      schedule({ scheduleType: 'Interval', intervalMinutes: 60, scheduleTimes: null }),
    ], date);
    expect(output).toHaveLength(count);
    expect(DateTime.fromMillis(output[0].startMs, { zone: 'America/New_York' }).toFormat('HH:mm'))
      .toBe('00:00');
    expect(output.slice(1).every((item, index) =>
      item.startMs - output[index].startMs === 3600_000)).toBe(true);
  });

  it('resets intervals at each local midnight and respects weekday restrictions', () => {
    const item = schedule({ scheduleType: 'Interval', intervalMinutes: 100, scheduleDays: 'Mon' });
    const output = expandOccurrences([item], '2026-11-16');
    expect(output).toHaveLength(15);
    expect(localStarts(output).at(-1)).toBe('2026-11-16 23:20 -05:00');
    expect(expandOccurrences([item], '2026-11-17')).toEqual([]);
  });

  it('retains all 100 slots, deduplicates repeated slots and sorts chronologically', () => {
    const times = Array.from({ length: 100 }, (_, i) =>
      `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`);
    const output = expandOccurrences([
      schedule({ scheduleTimes: times.reverse().join(',') }),
    ], '2026-11-16');
    expect(output).toHaveLength(100);
    expect(output[0].startMs).toBe(utc('2026-11-16T05:00Z'));
    expect(output.at(-1)?.startMs).toBe(utc('2026-11-16T06:39Z'));
    expect(expandOccurrences([
      schedule({ scheduleTimes: '06:00,06:00' }),
    ], '2026-11-16')).toHaveLength(1);
  });

  it('falls back between average/median, flags missing history, and preserves known zero duration', () => {
    const items = [
      schedule({ itemKey: 'missing', avgDurationSec: null, medianDurationSec: null }),
      schedule({ itemKey: 'median', avgDurationSec: undefined, medianDurationSec: 120 }),
      schedule({ itemKey: 'zero', avgDurationSec: 0 }),
    ];
    const output = expandOccurrences(items, '2026-11-16');
    expect(output.map((item) => [item.itemKey, item.endMs - item.startMs, item.noHistory]))
      .toEqual([['median', 120_000, false], ['missing', 300_000, true], ['zero', 0, false]]);
    const [median] = expandOccurrences([
      schedule({ avgDurationSec: 600, medianDurationSec: 180 }),
    ], '2026-11-16', 'America/New_York', 'median');
    expect(median.endMs - median.startMs).toBe(180_000);
    const midnight = expandOccurrences([
      schedule({ avgDurationSec: 0, scheduleTimes: '00:00' }),
    ], '2026-11-16');
    expect(midnight).toHaveLength(1);
    expect(midnight[0].startMs).toBe(midnight[0].endMs);
  });

  it.each([
    { scheduleTimes: '24:00' },
    { scheduleTimes: '06:60' },
    { scheduleTimes: '' },
    { scheduleTimes: Array(101).fill('06:00').join(',') },
    { scheduleType: 'Weekly' as const, scheduleDays: undefined },
    { scheduleDays: 'Monday' },
    { scheduleType: 'Monthly' as const },
    { scheduleType: 'Interval' as const, intervalMinutes: 0 },
    { scheduleType: 'Interval' as const, intervalMinutes: 2.5 },
    { timeZoneId: 'Not/A_Zone' },
    { avgDurationSec: -1 },
    { avgDurationSec: NaN },
  ])('rejects invalid or unsupported schedules instead of hiding them: %j', (overrides) => {
    expect(() => expandOccurrences([schedule(overrides)], '2026-11-16')).toThrow(RangeError);
  });

  it('rejects invalid display dates and time zones', () => {
    expect(() => expandOccurrences([], '2026-02-30')).toThrow(RangeError);
    expect(() => expandOccurrences([], '2026-11-16', 'Invalid/Zone')).toThrow(RangeError);
  });
});

describe('overlap and concurrency', () => {
  it('treats ranges as half-open and ignores zero-duration events', () => {
    const items = [
      occurrence('2026-11-16T06:00Z', '2026-11-16T06:05Z'),
      occurrence('2026-11-16T06:05Z', '2026-11-16T06:10Z'),
      occurrence('2026-11-16T06:05Z', '2026-11-16T06:05Z'),
    ];
    expect(overlapping(items, utc('2026-11-16T06:05Z'), utc('2026-11-16T06:10Z')))
      .toEqual([items[1]]);
  });

  it('counts exact simultaneous peaks, not the number of runs touching a slice', () => {
    const items = [
      occurrence('2026-11-16T06:00Z', '2026-11-16T06:02Z'),
      occurrence('2026-11-16T06:02Z', '2026-11-16T06:05Z', { itemType: 'Notebook' }),
      occurrence('2026-11-16T06:01Z', '2026-11-16T06:04Z', { kind: 'actual' }),
    ];
    const [slice] = computeConcurrency(items);
    expect(slice.projected).toEqual({ total: 1, byType: { SemanticModel: 1 } });
    expect(slice.actual).toEqual({ total: 1, byType: { SemanticModel: 1 } });
  });

  it('splits a shared peak by type and projected/actual without counting estimates as actual', () => {
    const items = [
      occurrence('2026-11-16T06:00Z', '2026-11-16T06:10Z'),
      occurrence('2026-11-16T06:03Z', '2026-11-16T06:08Z', { itemType: 'Notebook' }),
      occurrence('2026-11-16T06:04Z', '2026-11-16T06:06Z', { kind: 'actual' }),
    ];
    const slices = computeConcurrency(items);
    expect(slices).toHaveLength(2);
    for (const slice of slices) {
      expect(slice.projected).toEqual({ total: 2, byType: { SemanticModel: 1, Notebook: 1 } });
      expect(slice.actual.total).toBe(1);
    }
  });

  it.each([
    ['2026-03-08', 276],
    ['2026-11-01', 300],
  ])('supports a full DST display day %s with empty slices', (date, count) => {
    const window = displayDayWindow(date);
    const slices = computeConcurrency([], 5, window);
    expect(slices).toHaveLength(count);
    expect(slices[0].startMs).toBe(window.startMs);
    expect(slices.at(-1)?.endMs).toBe(window.endMs);
    expect(slices.every((slice) => slice.projected.total === 0 && slice.actual.total === 0)).toBe(true);
  });

  it('clips carry-in runs to slice bounds without mutating input', () => {
    const item = occurrence('2026-11-16T05:55Z', '2026-11-16T06:07Z');
    const original = { ...item };
    const window = { startMs: utc('2026-11-16T06:00Z'), endMs: utc('2026-11-16T06:07Z') };
    const slices = computeConcurrency([item], 5, window);
    expect(slices.map((slice) => slice.projected.total)).toEqual([1, 1]);
    expect(slices.at(-1)?.endMs).toBe(window.endMs);
    expect(item).toEqual(original);
  });

  it('rejects invalid bounds and slice sizes', () => {
    expect(computeConcurrency([])).toEqual([]);
    expect(() => computeConcurrency([], 0)).toThrow(RangeError);
    expect(() => computeConcurrency([], Infinity)).toThrow(RangeError);
    expect(() => overlapping([], 10, 5)).toThrow(RangeError);
    expect(() => computeConcurrency([
      occurrence('2026-11-16T06:10Z', '2026-11-16T06:00Z'),
    ])).toThrow(RangeError);
  });
});

describe('findSlots', () => {
  it('returns the three least-congested starts with chronological tie-breaking', () => {
    const items = [
      occurrence('2026-11-16T11:00Z', '2026-11-16T11:10Z'),
      occurrence('2026-11-16T11:05Z', '2026-11-16T11:20Z'),
    ];
    const slots = findSlots(items, 10, '06:00', '06:40', ['2026-11-16']);
    expect(slots.map((slot) => slot.startMs)).toEqual([
      utc('2026-11-16T11:20Z'), utc('2026-11-16T11:25Z'), utc('2026-11-16T11:30Z'),
    ]);
    expect(slots.every((slot) => slot.peakConcurrency === 0 && slot.endMs - slot.startMs === 600_000))
      .toBe(true);
  });

  it('ranks by exact peak across the entire duration, not a bucket count or start-only count', () => {
    const items = [
      occurrence('2026-11-16T06:00Z', '2026-11-16T06:02Z'),
      occurrence('2026-11-16T06:02Z', '2026-11-16T06:05Z'),
      occurrence('2026-11-16T06:09Z', '2026-11-16T06:15Z'),
      occurrence('2026-11-16T06:09Z', '2026-11-16T06:15Z', { itemType: 'Notebook' }),
    ];
    const slots = findSlots(items, 5, '06:00', '06:15', ['2026-11-16'], 'UTC');
    expect(slots.map((slot) => slot.peakConcurrency)).toEqual([1, 2, 2]);
    expect(slots[0].startMs).toBe(utc('2026-11-16T06:00Z'));
  });

  it('supports multiple unique dates and an overnight window, without truncating duration', () => {
    const slots = findSlots([], 10, '23:55', '00:10', ['2026-11-17', '2026-11-16', '2026-11-16']);
    expect(slots.map((slot) => slot.startMs)).toEqual([
      utc('2026-11-17T04:55Z'), utc('2026-11-17T05:00Z'), utc('2026-11-18T04:55Z'),
    ]);
    expect(findSlots([], 60, '06:00', '06:30', ['2026-11-16'])).toEqual([]);
    expect(findSlots([], 30, '06:00', '06:30', ['2026-11-16'])).toHaveLength(1);
  });

  it('skips missing spring candidate times and chooses repeated fall times only once', () => {
    const spring = findSlots([], 5, '02:50', '03:15', ['2026-03-08']);
    expect(localStarts(spring.map((slot) => ({
      ...occurrence('2026-03-08T07:00Z', '2026-03-08T07:05Z'), ...slot,
    })))).toEqual([
      '2026-03-08 03:00 -04:00', '2026-03-08 03:05 -04:00', '2026-03-08 03:10 -04:00',
    ]);
    const fall = findSlots([], 5, '01:00', '01:15', ['2026-11-01']);
    expect(fall.map((slot) => slot.startMs)).toEqual([
      utc('2026-11-01T05:00Z'), utc('2026-11-01T05:05Z'), utc('2026-11-01T05:10Z'),
    ]);
  });

  it('rejects invalid duration, dates, clocks and a nonexistent window end', () => {
    expect(() => findSlots([], 0, '06:00', '07:00', ['2026-11-16'])).toThrow(RangeError);
    expect(() => findSlots([], NaN, '06:00', '07:00', ['2026-11-16'])).toThrow(RangeError);
    expect(() => findSlots([], 5, '6:00', '07:00', ['2026-11-16'])).toThrow(RangeError);
    expect(() => findSlots([], 5, '06:00', '07:00', ['not-a-date'])).toThrow(RangeError);
    expect(() => findSlots([], 5, '01:00', '02:30', ['2026-03-08'])).toThrow(RangeError);
  });
});
