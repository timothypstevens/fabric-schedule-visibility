import { createHash } from 'node:crypto';
import { DateTime, IANAZone } from 'luxon';
import zones from 'cldr-core/supplemental/windowsZones.json' with { type: 'json' };
import { runStatuses, type LiveSchedule, type RunInstanceRecord, type ScheduledItemRecord } from '@rayfin-app/shared';
import { FabricReadError, object, isGuid } from './live-source.js';

// Job types documented by each workload's REST guide; never probe guessed values.
export const jobs: Readonly<Record<string, { itemType: ScheduledItemRecord['itemType']; jobType: string }>> = {
  DataPipeline: { itemType: 'DataPipeline', jobType: 'Pipeline' },
  Notebook: { itemType: 'Notebook', jobType: 'RunNotebook' },
  SparkJobDefinition: { itemType: 'SparkJobDefinition', jobType: 'sparkjob' },
  Dataflow: { itemType: 'DataflowGen2', jobType: 'Refresh' },
  DataflowFabric: { itemType: 'DataflowGen2', jobType: 'Refresh' },
  DataflowGen2: { itemType: 'DataflowGen2', jobType: 'Refresh' },
  CopyJob: { itemType: 'CopyJob', jobType: 'execute' },
};

export function stableId(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function utc(value: unknown): Date {
  if (typeof value !== 'string') throw new FabricReadError('Fabric returned a missing timestamp.');
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  if (!parsed.isValid) throw new FabricReadError('Fabric returned an invalid timestamp.');
  return parsed.toJSDate();
}

function zone(value: unknown): string {
  if (typeof value !== 'string') throw new FabricReadError('Schedule time zone is missing.');
  if (IANAZone.isValidZone(value)) return value;
  const mapped = zones.supplemental.windowsZones.mapTimezones.find(({ mapZone }) =>
    mapZone._other === value && mapZone._territory === '001')?.mapZone._type;
  if (!mapped || !IANAZone.isValidZone(mapped)) throw new FabricReadError('Schedule time zone is not supported by this runtime.');
  return mapped;
}

export function normalizeSchedules(rows: Record<string, unknown>[]): LiveSchedule[] {
  return rows.map((row) => {
    if (typeof row.enabled !== 'boolean') throw new FabricReadError('Schedule enabled flag is invalid.');
    const config = object(row.configuration);
    const startUtc = utc(config.startDateTime).toISOString();
    const endUtc = utc(config.endDateTime).toISOString();
    if (endUtc <= startUtc) throw new FabricReadError('Schedule end must follow its start.');
    const base = { enabled: row.enabled, timeZoneId: zone(config.localTimeZoneId), startUtc, endUtc };
    if (config.type === 'Cron') {
      if (!Number.isInteger(config.interval) || Number(config.interval) < 1 || Number(config.interval) > 5270400) {
        throw new FabricReadError('Schedule interval is invalid.');
      }
      return { ...base, type: 'Interval', intervalMinutes: Number(config.interval) };
    }
    if (config.type !== 'Daily' && config.type !== 'Weekly') {
      throw new FabricReadError('A monthly or unrecognized schedule cannot yet be projected. This item was not imported.');
    }
    if (!Array.isArray(config.times) || !config.times.length || config.times.length > 100
      || !config.times.every((time) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      throw new FabricReadError('Schedule time slots are invalid.');
    }
    let days: string | undefined;
    if (config.type === 'Weekly') {
      const valid = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      if (!Array.isArray(config.weekdays) || !config.weekdays.length
        || !config.weekdays.every((day) => typeof day === 'string' && valid.includes(day))) {
        throw new FabricReadError('Schedule weekdays are invalid.');
      }
      days = config.weekdays.map((day: string) => day.slice(0, 3)).join(',');
    }
    return { ...base, type: config.type, times: [...new Set(config.times)].join(','), days };
  });
}

export function normalizeRuns(rows: Record<string, unknown>[], itemKey: string, jobType: string, now: number): RunInstanceRecord[] {
  return rows.filter((row) => typeof row.jobType === 'string' && row.jobType.toLowerCase() === jobType.toLowerCase()).map((row) => {
    if (!isGuid(row.id) || typeof row.status !== 'string') throw new FabricReadError('Job instance metadata is invalid.');
    const startUtc = utc(row.startTimeUtc);
    const endUtc = row.endTimeUtc ? utc(row.endTimeUtc) : undefined;
    if (endUtc && endUtc < startUtc) throw new FabricReadError('Job instance has a negative duration.');
    const status = runStatuses.find((status) => status === row.status) ?? 'Unknown';
    const invokeType: RunInstanceRecord['invokeType'] = row.invokeType === 'Scheduled' || row.invokeType === 'Manual'
      ? row.invokeType : row.invokeType === 'ViaApi' ? 'ViaApi' : 'Other';
    return {
      id: stableId(`live:${itemKey}:${row.id}`), itemKey, runId: row.id, status,
      invokeType, startUtc, endUtc, source: 'live' as const,
      // Do not persist provider error bodies, which may contain source credentials or data.
      failureReason: row.failureReason ? 'Fabric reported a job failure. Inspect its run details in Fabric.' : undefined,
    };
  }).filter((row) => row.startUtc.getTime() >= now - 7 * 86400_000 || row.status === 'InProgress')
    .sort((a, b) => b.startUtc.getTime() - a.startUtc.getTime());
}

export function statistics(runs: readonly RunInstanceRecord[], now = Date.now()) {
  const recent = runs.filter((run) => run.startUtc.getTime() >= now - 7 * 86400_000);
  const durations = recent.filter((run) => run.status === 'Completed' && run.endUtc)
    .map((run) => (run.endUtc!.getTime() - run.startUtc.getTime()) / 1000).sort((a, b) => a - b);
  const n = durations.length;
  return {
    avgDurationSec: n ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / n) : null,
    medianDurationSec: n ? Math.round((durations[Math.floor((n - 1) / 2)] + durations[Math.floor(n / 2)]) / 2) : null,
    p90DurationSec: n ? Math.round(durations[Math.ceil(n * 0.9) - 1]) : null,
    runs7d: recent.length, failures7d: recent.filter((run) => run.status === 'Failed').length,
    lastStatus: runs[0]?.status ?? null, lastStartUtc: runs[0]?.startUtc ?? null, lastEndUtc: runs[0]?.endUtc ?? null,
  };
}
