import { IANAZone } from 'luxon';
import { parseLiveSchedules, type ItemType, type ScheduledItemRecord } from '@rayfin-app/shared';

import {
  DEFAULT_DISPLAY_TZ, displayDayWindow, localDate, MINUTE_MS, parseClock, wallClock,
} from './time';

export type ScheduleDefinition = Pick<ScheduledItemRecord,
  'itemKey' | 'itemName' | 'itemType' | 'scheduleType' | 'timeZoneId' | 'enabled'
> & {
  scheduleDays?: string | null;
  scheduleTimes?: string | null;
  intervalMinutes?: number | null;
  avgDurationSec?: number | null;
  medianDurationSec?: number | null;
  liveSchedulesJson?: string;
  scheduleStartUtc?: string;
  scheduleEndUtc?: string;
};

export type DurationMetric = 'average' | 'median';

export interface Occurrence {
  id: string;
  itemKey: string;
  itemName: string;
  itemType: ItemType;
  kind: 'projected' | 'actual';
  startMs: number;
  endMs: number;
  noHistory: boolean;
}

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function scheduleWeekdays(item: ScheduleDefinition): Set<number> | undefined {
  if (!item.scheduleDays?.trim()) {
    if (item.scheduleType === 'Weekly') {
      throw new RangeError(`Weekly schedule needs scheduleDays: ${item.itemKey}`);
    }
    return undefined;
  }
  return new Set(item.scheduleDays.split(',').map((part) => {
    const index = weekdays.indexOf(part.trim());
    if (index < 0) throw new RangeError(`Invalid schedule day: ${part}`);
    return index + 1;
  }));
}

function duration(item: ScheduleDefinition, metric: DurationMetric): number {
  for (const value of [item.avgDurationSec, item.medianDurationSec]) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`Duration must be finite and nonnegative: ${item.itemKey}`);
    }
  }
  return metric === 'median'
    ? item.medianDurationSec ?? item.avgDurationSec ?? 300
    : item.avgDurationSec ?? item.medianDurationSec ?? 300;
}

export function expandOccurrences(
  items: readonly ScheduleDefinition[],
  date: string,
  displayTz = DEFAULT_DISPLAY_TZ,
  metric: DurationMetric = 'average',
): Occurrence[] {
  const window = displayDayWindow(date, displayTz);
  const output: Occurrence[] = [];

  for (const item of items) {
    if (!item.enabled) continue;
    if (item.liveSchedulesJson != null) {
      const definitions = parseLiveSchedules(item.liveSchedulesJson).map((schedule) => ({
        ...item, liveSchedulesJson: undefined, enabled: schedule.enabled,
        scheduleType: schedule.type, timeZoneId: schedule.timeZoneId,
        scheduleDays: schedule.days, scheduleTimes: schedule.times,
        intervalMinutes: schedule.intervalMinutes,
        scheduleStartUtc: schedule.startUtc, scheduleEndUtc: schedule.endUtc,
      }));
      output.push(...expandOccurrences(definitions, date, displayTz, metric));
      continue;
    }
    if (!['Daily', 'Weekly', 'Interval'].includes(item.scheduleType)) {
      throw new RangeError(`Unsupported schedule type ${item.scheduleType}: ${item.itemKey}`);
    }
    if (!IANAZone.isValidZone(item.timeZoneId)) {
      throw new RangeError(`Invalid IANA time zone: ${item.timeZoneId}`);
    }
    const durationMs = duration(item, metric) * 1000;
    const days = scheduleWeekdays(item);
    let times: number[] = [];
    if (item.scheduleType === 'Interval') {
      if (!Number.isInteger(item.intervalMinutes) || (item.intervalMinutes ?? 0) <= 0) {
        throw new RangeError(`Interval must be a positive integer in minutes: ${item.itemKey}`);
      }
    } else {
      const slots = item.scheduleTimes?.split(',') ?? [];
      if (slots.length === 0 || slots.length > 100) {
        throw new RangeError(`Schedule must have 1 to 100 time slots: ${item.itemKey}`);
      }
      times = [...new Set(slots.map((slot) => parseClock(slot.trim())))];
    }

    // Include earlier source-calendar days for runs that carry into the display day.
    const first = localDate(date, displayTz)
      .minus({ milliseconds: durationMs }).setZone(item.timeZoneId).startOf('day');
    for (let day = first; day.toMillis() < window.endMs; day = day.plus({ days: 1 })) {
      if (days && !days.has(day.weekday)) continue;
      const starts: number[] = [];
      if (item.scheduleType === 'Interval') {
        const stepMs = (item.intervalMinutes ?? 0) * MINUTE_MS;
        const endOfDay = day.plus({ days: 1 }).toMillis();
        const anchor = item.scheduleStartUtc ? Date.parse(item.scheduleStartUtc) : day.toMillis();
        const firstStart = anchor + Math.max(0, Math.ceil((day.toMillis() - anchor) / stepMs)) * stepMs;
        for (let start = firstStart; start < endOfDay; start += stepMs) {
          starts.push(start);
        }
      } else {
        for (const time of times) {
          const start = wallClock(day, time);
          if (start !== undefined) starts.push(start);
        }
      }
      for (const startMs of starts) {
        if ((item.scheduleStartUtc && startMs < Date.parse(item.scheduleStartUtc))
          || (item.scheduleEndUtc && startMs > Date.parse(item.scheduleEndUtc))) continue;
        const endMs = startMs + durationMs;
        if (startMs >= window.endMs
          || (durationMs === 0 ? startMs < window.startMs : endMs <= window.startMs)) continue;
        output.push({
          id: `${item.itemKey}:${startMs}`,
          itemKey: item.itemKey,
          itemName: item.itemName,
          itemType: item.itemType,
          kind: 'projected',
          startMs,
          endMs,
          noHistory: item.avgDurationSec == null && item.medianDurationSec == null,
        });
      }
    }
  }
  return [...new Map(output.map((row) => [row.id, row])).values()]
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}
