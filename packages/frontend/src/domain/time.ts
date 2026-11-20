import { DateTime, IANAZone } from 'luxon';

export const DEFAULT_DISPLAY_TZ = 'America/New_York';
export const MINUTE_MS = 60_000;

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export function localDate(date: string, zone: string): DateTime {
  if (!IANAZone.isValidZone(zone)) {
    throw new RangeError(`Invalid IANA time zone: ${zone}`);
  }
  const parsed = DateTime.fromISO(date, { zone });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parsed.isValid || parsed.toISODate() !== date) {
    throw new RangeError(`Invalid calendar date: ${date}`);
  }
  return parsed.startOf('day');
}

export function displayDayWindow(
  date: string,
  displayTz = DEFAULT_DISPLAY_TZ,
): TimeWindow {
  const start = localDate(date, displayTz);
  return { startMs: start.toMillis(), endMs: start.plus({ days: 1 }).toMillis() };
}

export function parseClock(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError(`Invalid clock time (expected HH:mm): ${time}`);
  }
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/** Luxon shifts missing clock times forward; reject that shift and choose the first repeated time. */
export function wallClock(day: DateTime, minuteOfDay: number): number | undefined {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const time = DateTime.fromObject({
    year: day.year, month: day.month, day: day.day, hour, minute,
  }, { zone: day.zoneName ?? undefined });
  if (!time.isValid || time.hour !== hour || time.minute !== minute || time.day !== day.day) {
    return undefined;
  }
  return Math.min(...time.getPossibleOffsets().map((candidate) => candidate.toMillis()));
}

export function validateWindow({ startMs, endMs }: TimeWindow): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new RangeError('Time windows must have finite bounds with end after start.');
  }
}
