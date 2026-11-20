import type { LiveSchedule } from './index.js';

export function parseLiveSchedules(json: string): LiveSchedule[] {
  const rows: unknown = JSON.parse(json);
  if (!Array.isArray(rows) || rows.length > 100) throw new Error('Stored live schedules are invalid. Sync this workspace again.');
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Stored live schedule is invalid.');
    const value = row as Record<string, unknown>;
    if (typeof value.enabled !== 'boolean' || typeof value.timeZoneId !== 'string'
      || typeof value.startUtc !== 'string' || typeof value.endUtc !== 'string'
      || !Number.isFinite(Date.parse(value.startUtc)) || !Number.isFinite(Date.parse(value.endUtc))
      || Date.parse(value.endUtc) <= Date.parse(value.startUtc)
      || (value.type !== 'Daily' && value.type !== 'Weekly' && value.type !== 'Interval')
      || (value.times != null && typeof value.times !== 'string')
      || (value.days != null && typeof value.days !== 'string')
      || (value.intervalMinutes != null && typeof value.intervalMinutes !== 'number')) {
      throw new Error('Stored live schedule is invalid. Sync this workspace again.');
    }
    return {
      enabled: value.enabled, type: value.type, timeZoneId: value.timeZoneId,
      startUtc: value.startUtc, endUtc: value.endUtc,
      times: typeof value.times === 'string' ? value.times : undefined,
      days: typeof value.days === 'string' ? value.days : undefined,
      intervalMinutes: typeof value.intervalMinutes === 'number' ? value.intervalMinutes : undefined,
    };
  });
}
