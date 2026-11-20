import { DateTime } from 'luxon';
import { criticalities, itemTypes, runStatuses, type ItemAnnotationRecord, type ScheduledItemRecord } from '@rayfin-app/shared';
import { sampleWorkspaceCapacity } from '../sample/capacities';
import type { Occurrence } from './schedule';

export interface ScheduleFilters {
  types: string[];
  capacity: string;
  workspace: string[];
  owner: string[];
  status: string[];
  weekday: string[];
  start: string;
  end: string;
  criticality: string[];
}

export const EMPTY_FILTERS: ScheduleFilters = {
  capacity: '', types: [], workspace: [], owner: [], status: [], weekday: [],
  start: '00:00', end: '23:59', criticality: [],
};

export function parseFilters(json: string): ScheduleFilters {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved view.');
  const row = value as Record<string, unknown>;
  const legacy = typeof row.workspace === 'string';
  const values = (key: string): string[] => {
    const entry = row[key];
    if (legacy && typeof entry === 'string') return entry ? [entry] : [];
    if (Array.isArray(entry) && entry.every((part) => typeof part === 'string')) return entry;
    throw new Error('This saved view has an unsupported filter format.');
  };
  const workspace = values('workspace');
  const owner = values('owner');
  const status = values('status');
  const weekday = values('weekday');
  const criticality = legacy
    ? (row.criticalOnly === true ? ['Executive'] : [])
    : values('criticality');
  if (!Array.isArray(row.types) || !row.types.every((t) => itemTypes.some((type) => type === t))
    || (legacy ? typeof row.criticalOnly !== 'boolean' : typeof row.capacity !== 'string')
    || !status.every((entry) => runStatuses.some((status) => status === entry))
    || !weekday.every((entry) => /^[1-7]$/.test(entry))
    || !criticality.every((entry) => criticalities.some((criticality) => criticality === entry))
    || ![row.start, row.end].every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t)))) {
    throw new Error('This saved view has an unsupported filter format.');
  }
  return {
    capacity: legacy ? '' : String(row.capacity), types: row.types, workspace, owner,
    status, weekday, start: String(row.start), end: String(row.end), criticality,
  };
}

export function filterItems(
  items: readonly ScheduledItemRecord[], annotations: ReadonlyMap<string, ItemAnnotationRecord>,
  filters: ScheduleFilters,
): ScheduledItemRecord[] {
  return items.filter((item) =>
    (!filters.types.length || filters.types.includes(item.itemType))
    && (!filters.capacity || (item.source === 'sample' ? sampleWorkspaceCapacity(item.workspaceId) : item.capacityId) === filters.capacity)
    && (!filters.workspace.length || filters.workspace.includes(item.workspaceId))
    && (!filters.owner.length || (item.owner != null && filters.owner.includes(item.owner)))
    && (!filters.status.length || filters.status.includes(item.lastStatus ?? 'Unknown'))
    && (!filters.criticality.length || filters.criticality.includes(annotations.get(item.itemKey)?.criticality ?? 'Standard')));
}

export function filterOccurrences<T extends Occurrence>(
  occurrences: readonly T[], filters: ScheduleFilters, zone: string,
): T[] {
  return occurrences.filter((item) => {
    const time = DateTime.fromMillis(item.startMs, { zone });
    const clock = time.toFormat('HH:mm');
    const inWindow = filters.start <= filters.end
      ? clock >= filters.start && clock <= filters.end
      : clock >= filters.start || clock <= filters.end;
    return (!filters.weekday.length || filters.weekday.includes(String(time.weekday))) && inWindow;
  });
}
