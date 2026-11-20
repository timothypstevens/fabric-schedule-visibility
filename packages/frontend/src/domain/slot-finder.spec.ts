import { describe, expect, it } from 'vitest';
import { findRecurringSlots } from './slot-finder';
import type { Occurrence } from './schedule';

function job(id: string, date: string, start: string, end: string): Occurrence {
  return { id, itemKey: id, itemName: id, itemType: 'Notebook', kind: 'projected',
    startMs: Date.parse(`${date}T${start}:00Z`), endMs: Date.parse(`${date}T${end}:00Z`), noHistory: false };
}

describe('recurring slots', () => {
  it('ranks one common time by worst day, then average daily peak, then earliest time', () => {
    const days = ['2026-11-16', '2026-11-17'];
    const jobs = [
      ...[1, 2, 3].map((n) => job(`busy-${n}`, days[0], '06:00', '06:05')),
      ...[1, 2].map((n) => job(`mon-${n}`, days[0], '06:05', '06:10')),
      ...[1, 2].map((n) => job(`tue-${n}`, days[1], '06:05', '06:10')),
      ...[1, 2].map((n) => job(`later-${n}`, days[0], '06:10', '06:20')),
    ];
    const slots = findRecurringSlots(jobs, 5, '06:00', '06:20', days, 'UTC');
    expect(slots.map((slot) => slot.minute)).toEqual([370, 375, 365]);
    expect(slots.map((slot) => [slot.peakConcurrency, slot.averagePeak])).toEqual([[2, 1], [2, 1], [2, 2]]);
    expect(slots[0].days[0].peakJobs.map((run) => run.id)).toEqual(['later-1', 'later-2']);
    expect(slots[0].days[1].peakJobs).toEqual([]);
    expect(findRecurringSlots(jobs, 5, '06:00', '06:20', [days[1]], 'UTC')[0].minute).toBe(360);
  });

  it('lists only jobs simultaneous at the first exact peak, not every job overlapping the window', () => {
    const day = '2026-11-16';
    const slots = findRecurringSlots([
      job('first', day, '06:00', '06:05'), job('second', day, '06:05', '06:10'),
    ], 10, '06:00', '06:10', [day], 'UTC');
    expect(slots[0].peakConcurrency).toBe(1);
    expect(slots[0].days[0].peakJobs.map((run) => run.id)).toEqual(['first']);
  });

  it('requires a valid common start on every day, including overnight and DST windows', () => {
    const slots = findRecurringSlots([], 10, '23:55', '00:10', ['2026-11-16', '2026-11-17'], 'UTC');
    expect(slots.map((slot) => slot.minute)).toEqual([1435, 1440]);
    expect(slots[0].days).toHaveLength(2);
    expect(findRecurringSlots([], 5, '02:00', '03:10', ['2026-03-07', '2026-03-08'])
      .map((slot) => slot.minute)).toEqual([180, 185]);
    expect(findRecurringSlots([], 5, '06:00', '07:00', [])).toEqual([]);
  });
});
