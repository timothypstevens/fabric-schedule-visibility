import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { computeConcurrency, displayDayWindow, expandOccurrences } from '../domain';
import { generateSampleData, SAMPLE_DATE, simulateRunningNow } from './data';

const data = generateSampleData();

describe('deterministic demonstration data', () => {
  it('repeats exactly, with the requested types and fictional ownership', () => {
    expect(generateSampleData()).toEqual(data);
    expect(data.items).toHaveLength(385);
    expect(data.items.filter((item) => item.itemType === 'SemanticModel')).toHaveLength(300);
    expect(data.items.filter((item) => item.itemType === 'DataflowGen2')).toHaveLength(40);
    expect(data.items.filter((item) => item.itemType === 'DataPipeline')).toHaveLength(25);
    expect(data.items.filter((item) => item.itemType === 'Notebook')).toHaveLength(15);
    expect(data.items.filter((item) => item.itemType === 'CopyJob')).toHaveLength(5);
    expect(new Set(data.items.map((item) => item.workspaceName)).size).toBe(12);
    expect(data.items.every((item) => item.owner?.endsWith('@example.org') && item.source === 'sample')).toBe(true);
    expect(new Set([...data.items, ...data.runs, ...data.annotations].map((row) => row.id)).size)
      .toBe(data.items.length + data.runs.length + data.annotations.length);
  });

  it('exceeds 160 semantic refreshes Monday 06:00, with normal weekday peaks from 120 to 150', () => {
    const models = data.items.filter((item) => item.itemType === 'SemanticModel');
    const monday = expandOccurrences(models, SAMPLE_DATE);
    const peak = (date: string) => Math.max(...computeConcurrency(
      expandOccurrences(models, date), 5, displayDayWindow(date),
    ).map((entry) => entry.projected.total));
    const six = DateTime.fromISO(`${SAMPLE_DATE}T06:00`, { zone: 'America/New_York' }).toMillis();
    expect(monday.filter((item) => item.startMs <= six && item.endMs > six).length).toBeGreaterThan(160);
    for (const date of ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']) {
      expect(peak(date)).toBeGreaterThanOrEqual(120);
      expect(peak(date)).toBeLessThanOrEqual(150);
    }
  });

  it('preserves collision, executive and Friday research patterns', () => {
    const collision = data.items.filter((item) => item.scheduleTimes === '08:50');
    expect(new Set(collision.map((item) => item.workspaceName))).toEqual(new Set(['Clarity - Cardiology', 'Clarity - Radiology']));
    const executiveKeys = new Set(data.annotations.filter((row) => row.criticality === 'Executive').map((row) => row.itemKey));
    expect(data.items.filter((item) => executiveKeys.has(item.itemKey)).every((item) => item.scheduleTimes === '06:00')).toBe(true);
    const research = data.items.filter((item) => item.workspaceName === 'Research Analytics' && item.scheduleDays === 'Fri');
    expect(research.length).toBeGreaterThan(0);
    expect(research.every((item) => item.scheduleTimes === '14:00')).toBe(true);
  });

  it('has approximately 5% Monday and 2% weekend failures with consistent counters', () => {
    for (const [weekday, rate] of [[1, 0.05], [6, 0.02], [7, 0.02]]) {
      const runs = data.runs.filter((run) => DateTime.fromJSDate(run.startUtc, { zone: 'America/New_York' }).weekday === weekday);
      expect(runs.filter((run) => run.status === 'Failed').length / runs.length).toBeCloseTo(rate, 2);
    }
    for (const item of data.items) {
      const runs = data.runs.filter((row) => row.itemKey === item.itemKey);
      expect(item.runs7d).toBe(runs.length);
      expect(item.failures7d).toBe(runs.filter((row) => row.status === 'Failed').length);
    }
  });

  it.each(['2026-11-17T00:01:00Z', '2026-11-17T12:00:00Z', '2026-11-22T23:59:00Z'])(
    'simulates running items and deliberate overruns at %s, re-jittered on refresh', (time) => {
      const now = DateTime.fromISO(time).toMillis();
      const first = simulateRunningNow(data.items, now, 0);
      const next = simulateRunningNow(data.items, now, 1);
      expect(first.length).toBeGreaterThanOrEqual(2);
      expect(first.filter((run) => run.overrun).length).toBeGreaterThanOrEqual(2);
      expect(first.every((run) => run.kind === 'actual' && run.startMs <= now && run.endMs > now)).toBe(true);
      for (const run of first) {
        const item = data.items.find((candidate) => candidate.itemKey === run.itemKey)!;
        expect(run.expectedDurationSec).toBe(item.avgDurationSec ?? item.medianDurationSec ?? 300);
      }
      expect(first[0].startMs).not.toBe(next[0].startMs);
    },
  );

  it.each(['2026-11-17', '2026-11-22', '2026-03-08', '2026-11-01'])(
    'keeps every running row on a real slot without early starts throughout %s', (date) => {
      const day = DateTime.fromISO(date, { zone: 'America/New_York' });
      const scheduled = [
        ...expandOccurrences(data.items, day.minus({ days: 1 }).toISODate()!),
        ...expandOccurrences(data.items, date),
      ];
      const bySlot = new Map(scheduled.map((run) => [`${run.itemKey}:${run.startMs}`, run]));
      for (let hour = 0; hour < day.plus({ days: 1 }).diff(day, 'hours').hours; hour++) {
        const now = day.plus({ hours: hour, seconds: hour % 2 === 0 ? 0 : 1 }).toMillis();
        for (const sequence of [0, 1]) {
          const rows = simulateRunningNow(data.items, now, sequence);
          expect(new Set(rows.map((run) => run.itemKey)).size).toBe(rows.length);
          for (const run of rows) {
            const projection = bySlot.get(`${run.itemKey}:${run.scheduledStartMs}`);
            expect(projection).toBeDefined();
            expect(run.startMs).toBeGreaterThanOrEqual(run.scheduledStartMs);
            expect(run.startMs - run.scheduledStartMs).toBeLessThanOrEqual(30_000);
            expect(run.startMs).toBeLessThanOrEqual(now);
            expect(run.endMs).toBeGreaterThan(now);
            expect(run.expectedDurationSec).toBe(Math.max(1, (projection!.endMs - projection!.startMs) / 1000));
            expect(run.overrun).toBe(now - run.startMs > run.expectedDurationSec * 1500);
          }
        }
      }
  });

  it('uses an earlier hourly CopyJob 381 occurrence for its overrun, including before midnight', () => {
    const now = DateTime.fromISO('2026-11-17T00:10', { zone: 'America/New_York' }).toMillis();
    const row = simulateRunningNow(data.items, now).find((run) => run.itemKey === data.items[380].itemKey)!;
    expect(row.overrun).toBe(true);
    expect(DateTime.fromMillis(row.scheduledStartMs, { zone: 'America/New_York' }).toFormat('yyyy-MM-dd HH:mm'))
      .toBe('2026-11-16 22:00');
    expect(row.startMs).toBeGreaterThanOrEqual(row.scheduledStartMs);
    expect(simulateRunningNow([], now)).toEqual([]);
    expect(simulateRunningNow([{ ...data.items[380], enabled: false }], now)).toEqual([]);
  });
});
