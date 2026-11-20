import { DateTime } from 'luxon';
import type { ItemAnnotationRecord, ItemType, RunInstanceRecord, ScheduledItemRecord } from '@rayfin-app/shared';
import { expandOccurrences, type Occurrence } from '../domain';

export const SAMPLE_DATE = '2026-11-16';
const zone = 'America/New_York';
const workspaces = [
  'Clarity - Cardiology', 'Clarity - Radiology', 'Caboodle - Finance', 'Caboodle - Quality',
  'Executive Dashboards', 'Research Analytics', 'Revenue Cycle', 'Lakehouse ETL',
  'Clinical Operations', 'Population Health', 'Supply Chain', 'Quality Improvement',
];

export function seededRandom(seed = 317): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function uuid(index: number, group: number): string {
  return `5a6d0000-0000-4000-8000-${group.toString(16).padStart(4, '0')}${index.toString(16).padStart(8, '0')}`;
}

export interface SampleData {
  items: ScheduledItemRecord[];
  runs: RunInstanceRecord[];
  annotations: ItemAnnotationRecord[];
}

export function generateSampleData(): SampleData {
  const random = seededRandom();
  const stamp = DateTime.fromISO(`${SAMPLE_DATE}T00:00`, { zone }).toJSDate();
  const items: ScheduledItemRecord[] = [];
  const annotations: ItemAnnotationRecord[] = [];
  const types: ItemType[] = [
    ...Array<ItemType>(300).fill('SemanticModel'), ...Array<ItemType>(40).fill('DataflowGen2'),
    ...Array<ItemType>(25).fill('DataPipeline'), ...Array<ItemType>(15).fill('Notebook'),
    ...Array<ItemType>(5).fill('CopyJob'),
  ];
  types.forEach((itemType, i) => {
    const workspace = i >= 300 ? 7 : i < 20 ? 4 : i >= 220 && i < 240 ? 5 : i % 12;
    const id = uuid(i, 1);
    const model = itemType === 'SemanticModel';
    const normal = Math.sqrt(-2 * Math.log(Math.max(random(), 0.00001))) * Math.cos(2 * Math.PI * random());
    const avg = Math.round(Math.max(60, Math.min(480, Math.exp(Math.log(200) + normal * 0.55))));
    const minute = String(Math.floor(random() * 60)).padStart(2, '0');
    let scheduleTimes = `${String(model ? 10 + i % 10 : 5 + i % 3).padStart(2, '0')}:${minute}`;
    let scheduleDays = 'Mon,Tue,Wed,Thu,Fri';
    if (i < 180) scheduleTimes = '06:00';
    if (i >= 130 && i < 180) scheduleDays = 'Mon';
    if (i >= 180 && i < 220) scheduleTimes = '08:50';
    if (i >= 220 && i < 240) { scheduleTimes = '14:00'; scheduleDays = 'Fri'; }
    if (i >= 240 && model) scheduleDays = 'Mon,Tue,Wed,Thu,Fri,Sat,Sun';
    const hourly = i >= 380;
    const itemKey = `sample:workspace-${workspace}:item-${i}`;
    items.push({
      id, itemKey, workspaceId: `sample-workspace-${workspace}`, workspaceName: workspaces[workspace],
      fabricItemId: `sample-item-${i}`, itemName: `${workspaces[workspace]} - ${model ? 'Refresh' : itemType} ${String(i + 1).padStart(3, '0')}`,
      itemType, owner: `writer${String(i % 36 + 1).padStart(2, '0')}@example.org`,
      scheduleType: hourly ? 'Interval' : 'Weekly', scheduleDays, scheduleTimes,
      ...(hourly ? { intervalMinutes: 60, scheduleDays: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' } : {}),
      timeZoneId: zone, enabled: true,
      ...(i % 79 === 0 ? {} : {
        avgDurationSec: model ? avg : 1800 + Math.floor(random() * 1800),
        medianDurationSec: model ? Math.round(avg * 0.85) : 1800,
        p90DurationSec: model ? Math.round(avg * 1.8) : 3600,
      }),
      runs7d: 0, failures7d: 0, source: 'sample', syncedAt: stamp,
    });
    annotations.push({
      id: uuid(i, 2), itemKey,
      criticality: i < 20 ? 'Executive' : workspace === 5 ? 'Flexible' : 'Standard',
      businessOwner: workspace === 4 ? 'Executive reporting' : 'Analytics team',
      note: i >= 180 && i < 220 ? 'Shared source collision at 08:50. Review an alternative slot.' : '',
      updatedBy: 'sample-generator', updatedAt: stamp,
    });
  });
  // Place both named departments in the deliberate 08:50 collision.
  items.slice(180, 220).forEach((item, index) => {
    const workspace = index % 2;
    item.workspaceId = `sample-workspace-${workspace}`;
    item.workspaceName = workspaces[workspace];
    item.itemName = `${workspaces[workspace]} - Source refresh ${index + 1}`;
  });
  const runs: RunInstanceRecord[] = [];
  for (let day = 7; day >= 1; day--) {
    const date = DateTime.fromISO(SAMPLE_DATE, { zone }).minus({ days: day });
    const occurrences = expandOccurrences(items, date.toISODate()!, zone)
      .filter((run) => DateTime.fromMillis(run.startMs, { zone }).toISODate() === date.toISODate());
    const failures = Math.round(occurrences.length * (date.weekday === 1 ? 0.05 : date.weekday >= 6 ? 0.02 : 0.03));
    const failedIds = new Set([...occurrences].sort((a, b) => a.id.localeCompare(b.id))
      .filter((_, index) => index % Math.max(1, Math.floor(occurrences.length / Math.max(1, failures))) === 0)
      .slice(0, failures).map((run) => run.id));
    for (const run of occurrences) {
      const failed = failedIds.has(run.id);
      runs.push({
        id: uuid(runs.length, 3), itemKey: run.itemKey, runId: `sample-run-${runs.length}`,
        status: failed ? 'Failed' : 'Completed', invokeType: 'Scheduled',
        startUtc: new Date(run.startMs),
        endUtc: new Date(run.startMs + Math.round((run.endMs - run.startMs) * (0.8 + random() * 0.4))),
        ...(failed ? { failureReason: 'Source timeout or gateway memory pressure.' } : {}),
        source: 'sample',
      });
    }
  }
  const history = new Map<string, RunInstanceRecord[]>();
  for (const run of runs) {
    const group = history.get(run.itemKey) ?? [];
    group.push(run); history.set(run.itemKey, group);
  }
  for (const item of items) {
    const group = history.get(item.itemKey) ?? [];
    const last = group.at(-1);
    item.runs7d = group.length;
    item.failures7d = group.filter((run) => run.status === 'Failed').length;
    item.lastStatus = last?.status;
    item.lastStartUtc = last?.startUtc;
    item.lastEndUtc = last?.endUtc;
  }
  return { items, runs, annotations };
}

export interface RunningOccurrence extends Occurrence {
  scheduledStartMs: number;
  expectedDurationSec: number;
  overrun: boolean;
}

export function simulateRunningNow(
  items: readonly ScheduledItemRecord[], nowMs: number, refreshSequence = 0,
): RunningOccurrence[] {
  const day = DateTime.fromMillis(nowMs, { zone });
  const date = day.toISODate()!;
  const occurrences = expandOccurrences(items, date, zone);
  const random = seededRandom(911 + refreshSequence);
  const active = occurrences.filter((item) => item.startMs <= nowMs && item.endMs > nowMs);
  const intervalItems = items.filter((item) => item.scheduleType === 'Interval');
  const priorOccurrences = [
    ...expandOccurrences(intervalItems, day.minus({ days: 1 }).toISODate()!, zone),
    ...occurrences.filter((run) => intervalItems.some((item) => item.itemKey === run.itemKey)),
  ].sort((a, b) => b.startMs - a.startMs || a.itemName.localeCompare(b.itemName));
  const overruns = new Map<string, Occurrence>();
  for (const item of intervalItems) {
    const occurrence = priorOccurrences.find((run) => {
      const duration = run.endMs - run.startMs;
      const elapsed = nowMs - run.startMs;
      return run.itemKey === item.itemKey && duration > 0
        && elapsed >= duration * 1.7 && elapsed <= Math.max(duration * 3, 2 * 3600_000);
    });
    if (occurrence) overruns.set(item.itemKey, occurrence);
    if (overruns.size === 2) break;
  }
  // Use genuine earlier schedule slots, never an execution before its planned start.
  const candidates = [...overruns.values(), ...active.filter((run) => !overruns.has(run.itemKey))];
  return candidates.map((item) => {
    const expectedDurationSec = Math.max(1, (item.endMs - item.startMs) / 1000);
    const startMs = Math.min(nowMs, item.startMs + random() * Math.min(30_000, expectedDurationSec * 100));
    return {
      ...item, id: `actual:${item.id}`, kind: 'actual', scheduledStartMs: item.startMs,
      startMs, endMs: nowMs + 1,
      expectedDurationSec, overrun: (nowMs - startMs) / 1000 > expectedDurationSec * 1.5,
    };
  });
}
