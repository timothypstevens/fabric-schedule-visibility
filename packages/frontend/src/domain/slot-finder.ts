import { overlapping, peakConcurrency } from './concurrency';
import type { Occurrence } from './schedule';
import {
  DEFAULT_DISPLAY_TZ, localDate, MINUTE_MS, parseClock, wallClock, type TimeWindow,
} from './time';

export interface SlotSuggestion extends TimeWindow {
  peakConcurrency: number;
}

function slotCandidates(
  occurrences: readonly Occurrence[],
  durationMin: number,
  windowStart: string,
  windowEnd: string,
  days: readonly string[],
  displayTz = DEFAULT_DISPLAY_TZ,
): (SlotSuggestion & { minute: number })[] {
  if (!Number.isFinite(durationMin) || durationMin <= 0) {
    throw new RangeError('Slot duration must be finite and positive.');
  }
  const startMinute = parseClock(windowStart);
  const endMinute = parseClock(windowEnd);
  const candidates: (SlotSuggestion & { minute: number })[] = [];
  for (const date of new Set(days)) {
    const day = localDate(date, displayTz);
    const overnight = endMinute <= startMinute;
    const endDay = overnight ? day.plus({ days: 1 }) : day;
    const endMs = wallClock(endDay, endMinute);
    if (endMs === undefined) {
      throw new RangeError(`Slot window end does not exist on ${date} in ${displayTz}.`);
    }
    const lastMinute = overnight ? 1440 + endMinute : endMinute;
    for (let minute = startMinute; minute < lastMinute; minute += 5) {
      const dateOfStart = minute >= 1440 ? day.plus({ days: 1 }) : day;
      const startMs = wallClock(dateOfStart, minute % 1440);
      if (startMs === undefined) continue;
      const finishMs = startMs + durationMin * MINUTE_MS;
      if (finishMs > endMs) continue;
      candidates.push({
        minute,
        startMs,
        endMs: finishMs,
        peakConcurrency: peakConcurrency(occurrences, startMs, finishMs).total,
      });
    }
  }
  return candidates;
}

export function findSlots(
  occurrences: readonly Occurrence[], durationMin: number, windowStart: string,
  windowEnd: string, days: readonly string[], displayTz = DEFAULT_DISPLAY_TZ,
): SlotSuggestion[] {
  return slotCandidates(occurrences, durationMin, windowStart, windowEnd, days, displayTz)
    .sort((a, b) => a.peakConcurrency - b.peakConcurrency || a.startMs - b.startMs)
    .filter((slot, index, slots) => index === 0 || slot.startMs !== slots[index - 1].startMs)
    .slice(0, 3)
    .map(({ startMs, endMs, peakConcurrency }) => ({ startMs, endMs, peakConcurrency }));
}

export interface RecurringSlotSuggestion {
  minute: number;
  peakConcurrency: number;
  averagePeak: number;
  days: (SlotSuggestion & { date: string; peakJobs: Occurrence[] })[];
}

export function findRecurringSlots(
  occurrences: readonly Occurrence[], durationMin: number, windowStart: string,
  windowEnd: string, days: readonly string[], displayTz = DEFAULT_DISPLAY_TZ,
): RecurringSlotSuggestion[] {
  const dates = [...new Set(days)];
  const groups = new Map<number, SlotSuggestion[]>();
  for (const candidate of slotCandidates(occurrences, durationMin, windowStart, windowEnd, dates, displayTz)) {
    const group = groups.get(candidate.minute) ?? [];
    group.push(candidate);
    groups.set(candidate.minute, group);
  }
  return [...groups].filter(([, group]) => group.length === dates.length)
    .map(([minute, group]) => ({
      minute, peakConcurrency: Math.max(...group.map((day) => day.peakConcurrency)),
      averagePeak: group.reduce((sum, day) => sum + day.peakConcurrency, 0) / group.length,
      days: group,
    }))
    .sort((a, b) => a.peakConcurrency - b.peakConcurrency || a.averagePeak - b.averagePeak || a.minute - b.minute)
    .slice(0, 3)
    .map((slot) => ({
      ...slot,
      days: slot.days.map((day, index) => {
        const jobs = overlapping(occurrences, day.startMs, day.endMs);
        const starts = [...new Set([day.startMs, ...jobs.map((job) => Math.max(day.startMs, job.startMs))])].sort((a, b) => a - b);
        let peakJobs: Occurrence[] = [];
        for (const start of starts) {
          const active = jobs.filter((job) => job.startMs <= start && job.endMs > start);
          if (active.length === day.peakConcurrency) { peakJobs = active; break; }
        }
        return { ...day, date: dates[index], peakJobs };
      }),
    }));
}
