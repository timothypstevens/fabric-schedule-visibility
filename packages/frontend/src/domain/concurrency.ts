import type { ItemType } from '@rayfin-app/shared';

import type { Occurrence } from './schedule';
import { MINUTE_MS, type TimeWindow, validateWindow } from './time';

export interface ConcurrencyCounts {
  total: number;
  byType: Partial<Record<ItemType, number>>;
}

export interface ConcurrencySlice extends TimeWindow {
  projected: ConcurrencyCounts;
  actual: ConcurrencyCounts;
}

function validateOccurrences(occurrences: readonly Occurrence[]): void {
  for (const occurrence of occurrences) {
    if (!Number.isFinite(occurrence.startMs) || !Number.isFinite(occurrence.endMs)
      || occurrence.endMs < occurrence.startMs) {
      throw new RangeError(`Invalid occurrence time range: ${occurrence.id}`);
    }
  }
}

export function overlapping<T extends Occurrence>(
  occurrences: readonly T[],
  sliceStart: number,
  sliceEnd: number,
): T[] {
  validateWindow({ startMs: sliceStart, endMs: sliceEnd });
  validateOccurrences(occurrences);
  return occurrences.filter((item) =>
    item.endMs > item.startMs && item.startMs < sliceEnd && item.endMs > sliceStart);
}

/** The type breakdown is the simultaneous composition at the earliest total peak, not per-type maxima. */
export function peakConcurrency(
  occurrences: readonly Occurrence[],
  startMs: number,
  endMs: number,
): ConcurrencyCounts {
  const events = new Map<number, Partial<Record<ItemType, number>>>();
  for (const item of overlapping(occurrences, startMs, endMs)) {
    for (const [at, delta] of [
      [Math.max(startMs, item.startMs), 1],
      [Math.min(endMs, item.endMs), -1],
    ]) {
      const changes = events.get(at) ?? {};
      changes[item.itemType] = (changes[item.itemType] ?? 0) + delta;
      events.set(at, changes);
    }
  }
  const counts: ConcurrencyCounts = { total: 0, byType: {} };
  let peak: ConcurrencyCounts = { total: 0, byType: {} };
  for (const [, changes] of [...events].sort(([a], [b]) => a - b)) {
    for (const [type, delta] of Object.entries(changes) as [ItemType, number][]) {
      counts.byType[type] = (counts.byType[type] ?? 0) + delta;
      counts.total += delta;
    }
    if (counts.total > peak.total) {
      peak = {
        total: counts.total,
        byType: Object.fromEntries(
          Object.entries(counts.byType).filter(([, count]) => count !== 0),
        ),
      };
    }
  }
  return peak;
}

export function computeConcurrency(
  occurrences: readonly Occurrence[],
  sliceMinutes = 5,
  window?: TimeWindow,
): ConcurrencySlice[] {
  if (!Number.isFinite(sliceMinutes) || sliceMinutes <= 0) {
    throw new RangeError('Slice duration must be finite and positive.');
  }
  validateOccurrences(occurrences);
  if (window) validateWindow(window);
  const active = occurrences.filter((item) => item.endMs > item.startMs);
  if (active.length === 0 && !window) return [];
  const sliceMs = sliceMinutes * MINUTE_MS;
  const bounds = window ?? {
    startMs: Math.floor(Math.min(...active.map((item) => item.startMs)) / sliceMs) * sliceMs,
    endMs: Math.ceil(Math.max(...active.map((item) => item.endMs)) / sliceMs) * sliceMs,
  };
  const projected = active.filter((item) => item.kind === 'projected');
  const actual = active.filter((item) => item.kind === 'actual');
  const slices: ConcurrencySlice[] = [];
  for (let startMs = bounds.startMs; startMs < bounds.endMs; startMs += sliceMs) {
    const endMs = Math.min(startMs + sliceMs, bounds.endMs);
    slices.push({
      startMs, endMs,
      projected: peakConcurrency(projected, startMs, endMs),
      actual: peakConcurrency(actual, startMs, endMs),
    });
  }
  return slices;
}
