import type { ItemAnnotationRecord, RunInstanceRecord, SavedViewRecord, ScheduledItemRecord } from '@rayfin-app/shared';
import { getRayfinClient } from '../lib/rayfin-client';
import { generateSampleData } from '../sample/data';

export interface ScheduleSnapshot {
  items: ScheduledItemRecord[];
  runs: RunInstanceRecord[];
  annotations: ItemAnnotationRecord[];
  views: SavedViewRecord[];
}

interface Page<T> { items: T[]; hasNextPage: boolean; endCursor?: string | null }

function wireBoolean(value: unknown): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('Invalid enabled flag returned by the data API.');
}

export async function collectPages<T>(read: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (;;) {
    const page = await read(cursor);
    rows.push(...page.items);
    if (!page.hasNextPage) return rows;
    if (!page.endCursor || cursors.has(page.endCursor)) throw new Error('Data pagination did not advance.');
    cursor = page.endCursor; cursors.add(cursor);
  }
}

export async function runBounded(
  tasks: readonly (() => Promise<unknown>)[], progress: (done: number, total: number) => void,
  limit = 10,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError('Concurrency must be 1-10.');
  let next = 0; let done = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length && !failed) {
      const task = tasks[next++];
      try { await task(); done++; progress(done, tasks.length); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
}

export async function readScheduleData(): Promise<ScheduleSnapshot> {
  const c = await getRayfinClient();
  const [items, runs, annotations, views] = await Promise.all([
    collectPages((cursor) => {
      let q = c.data.ScheduledItem.select([
        'id', 'itemKey', 'workspaceId', 'workspaceName', 'capacityId', 'liveSchedulesJson', 'fabricItemId', 'itemName', 'itemType',
        'jobType', 'owner', 'scheduleType', 'scheduleDays', 'scheduleTimes', 'intervalMinutes',
        'timeZoneId', 'enabled', 'avgDurationSec', 'medianDurationSec', 'p90DurationSec', 'runs7d',
        'failures7d', 'lastStatus', 'lastStartUtc', 'lastEndUtc', 'source', 'syncedAt',
      ]).orderBy({ id: 'asc' }).first(500);
      if (cursor) q = q.after(cursor);
      return q.executePaginated();
    }),
    collectPages((cursor) => {
      let q = c.data.RunInstance.select([
        'id', 'itemKey', 'runId', 'status', 'invokeType', 'startUtc', 'endUtc', 'failureReason', 'source',
      ]).orderBy({ id: 'asc' }).first(500);
      if (cursor) q = q.after(cursor);
      return q.executePaginated();
    }),
    collectPages((cursor) => {
      let q = c.data.ItemAnnotation.select([
        'id', 'itemKey', 'criticality', 'businessOwner', 'note', 'updatedBy', 'updatedAt',
      ]).orderBy({ id: 'asc' }).first(500);
      if (cursor) q = q.after(cursor);
      return q.executePaginated();
    }),
    collectPages((cursor) => {
      let q = c.data.SavedView.select(['id', 'user_id', 'name', 'filtersJson', 'createdAt'])
        .orderBy({ id: 'asc' }).first(100);
      if (cursor) q = q.after(cursor);
      return q.executePaginated();
    }),
  ]);
  return {
    items: items.map((item) => ({
      ...item, enabled: wireBoolean(item.enabled),
      syncedAt: new Date(item.syncedAt),
      lastStartUtc: item.lastStartUtc ? new Date(item.lastStartUtc) : undefined,
      lastEndUtc: item.lastEndUtc ? new Date(item.lastEndUtc) : undefined,
    })),
    runs: runs.map((run) => ({
      ...run, startUtc: new Date(run.startUtc), endUtc: run.endUtc ? new Date(run.endUtc) : undefined,
    })),
    annotations: annotations.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) })),
    views: views.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
  };
}

export async function loadSampleData(progress: (done: number, total: number) => void): Promise<void> {
  const c = await getRayfinClient();
  const existing = await readScheduleData();
  const data = generateSampleData();
  const itemKeys = new Set(existing.items.map((row) => row.itemKey));
  const annotationKeys = new Set(existing.annotations.map((row) => row.itemKey));
  const runIds = new Set(existing.runs.map((row) => row.id));
  const tasks: (() => Promise<unknown>)[] = [
    ...data.items.filter((row) => !itemKeys.has(row.itemKey)).map((row) => () => c.data.ScheduledItem.create(row)),
    ...data.annotations.filter((row) => !annotationKeys.has(row.itemKey)).map((row) => () => c.data.ItemAnnotation.create(row)),
    ...data.runs.filter((row) => !runIds.has(row.id)).map((row) => () => c.data.RunInstance.create(row)),
  ];
  progress(0, tasks.length);
  await runBounded(tasks, progress);
}

export async function clearSampleData(progress: (done: number, total: number) => void): Promise<void> {
  const c = await getRayfinClient();
  const snapshot = await readScheduleData();
  const keys = new Set(snapshot.items.filter((row) => row.source === 'sample').map((row) => row.itemKey));
  const dependents: (() => Promise<unknown>)[] = [
    ...snapshot.runs.filter((row) => row.source === 'sample').map(({ id }) => () => c.data.RunInstance.delete({ id })),
    ...snapshot.annotations.filter((row) => keys.has(row.itemKey)).map(({ id }) => () => c.data.ItemAnnotation.delete({ id })),
  ];
  const items = snapshot.items.filter((row) => row.source === 'sample')
    .map(({ id }) => () => c.data.ScheduledItem.delete({ id }));
  const total = dependents.length + items.length;
  progress(0, total);
  await runBounded(dependents, (done) => progress(done, total));
  await runBounded(items, (done) => progress(dependents.length + done, total));
}

async function subject(): Promise<string> {
  const c = await getRayfinClient();
  const session = c.auth.getSession();
  if (!session.isAuthenticated || !session.user?.id) throw new Error('An authenticated user is required.');
  return session.user.id;
}

export async function saveAnnotation(
  itemKey: string, values: Pick<ItemAnnotationRecord, 'criticality' | 'note' | 'businessOwner'>, id?: string,
): Promise<void> {
  const c = await getRayfinClient();
  const row = { ...values, itemKey, updatedBy: await subject(), updatedAt: new Date() };
  if (id) await c.data.ItemAnnotation.update({ id }, row);
  else await c.data.ItemAnnotation.create(row);
}

export async function saveView(name: string, filtersJson: string): Promise<void> {
  const c = await getRayfinClient();
  await c.data.SavedView.create({ user_id: await subject(), name, filtersJson, createdAt: new Date() });
}

export async function deleteView(id: string): Promise<void> {
  const c = await getRayfinClient();
  await c.data.SavedView.delete({ id });
}
