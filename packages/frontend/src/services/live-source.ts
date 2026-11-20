import { getRayfinClient } from '../lib/rayfin-client';
import { DateTime } from 'luxon';
import type { ScheduledItemRecord } from '@rayfin-app/shared';
import { expandOccurrences, type Occurrence } from '../domain';

export async function listLiveWorkspaces() {
  return (await getRayfinClient()).functions.getLiveWorkspaces.invoke();
}
export type LiveCatalog = Awaited<ReturnType<typeof listLiveWorkspaces>>;

export async function syncLiveSource(workspaceIds: string[]) {
  if (!workspaceIds.length) throw new Error('Choose at least one source workspace.');
  const client = await getRayfinClient();
  let itemsSynced = 0; let runsSynced = 0; let status = 'Succeeded'; let id = '';
  const messages: string[] = [];
  for (const workspaceId of new Set(workspaceIds)) {
    let cursor = '';
    const seen = new Set<string>();
    for (let batch = 0; ; batch++) {
      if (batch >= 10000) throw new Error('Sync reached its batch limit. Review recent syncs before retrying.');
      const result = await client.functions.syncFabricSchedules.invoke({ workspaceIds: [workspaceId], cursor }, { timeoutMs: 90_000 });
      if (result.cursor && (result.status !== 'Running' || seen.has(result.cursor))) throw new Error('Sync continuation did not advance.');
      if (!result.cursor) {
        id = result.id; itemsSynced += result.itemsSynced; runsSynced += result.runsSynced;
        if (result.status !== 'Succeeded') status = 'Partial';
        messages.push(result.message);
        break;
      }
      seen.add(result.cursor); cursor = result.cursor;
    }
  }
  return { id, status, itemsSynced, runsSynced, message: messages.join('\n') };
}

export async function verifyLiveRunning(itemKeys: string[]) {
  return (await getRayfinClient()).functions.getRunningNow.invoke({ itemKeys }, { timeoutMs: 90_000 });
}

export interface LiveRunningOccurrence extends Occurrence {
  scheduledStartMs?: number;
  expectedDurationSec: number;
  overrun: boolean;
}

export async function pollLiveRunning(items: readonly ScheduledItemRecord[]): Promise<LiveRunningOccurrence[]> {
  const before = Date.now();
  const date = DateTime.fromMillis(before, { zone: 'UTC' }).startOf('day');
  const projected = [-1, 0, 1].flatMap((offset) => expandOccurrences(items, date.plus({ days: offset }).toISODate()!, 'UTC'));
  const keys = new Set(projected.filter((run) => run.startMs < before + 15 * 60_000 && run.endMs > before - 15 * 60_000)
    .map((run) => run.itemKey));
  for (const item of items) if (item.lastStatus === 'InProgress') keys.add(item.itemKey);
  const pending = [...keys];
  const rows: Awaited<ReturnType<typeof verifyLiveRunning>> = [];
  for (let offset = 0; offset < pending.length; offset += 20) rows.push(...await verifyLiveRunning(pending.slice(offset, offset + 20)));
  const now = Date.now();
  const byKey = new Map(items.map((item) => [item.itemKey, item]));
  return rows.filter((row) => row.status === 'InProgress').map((row) => {
    const item = byKey.get(row.itemKey);
    const startMs = Date.parse(row.startUtc);
    if (!item || !Number.isFinite(startMs) || startMs > now) throw new Error('Fabric returned an invalid running instance.');
    const expectedDurationSec = item.avgDurationSec ?? item.medianDurationSec ?? 300;
    const scheduled = projected.filter((run) => run.itemKey === row.itemKey && run.startMs <= startMs && run.endMs >= startMs)
      .sort((a, b) => b.startMs - a.startMs)[0];
    return {
      id: `live:${row.runId}`, itemKey: item.itemKey, itemName: item.itemName, itemType: item.itemType,
      kind: 'actual', startMs, endMs: now, scheduledStartMs: scheduled?.startMs, expectedDurationSec,
      noHistory: item.avgDurationSec == null && item.medianDurationSec == null,
      overrun: (now - startMs) / 1000 > 1.5 * expectedDurationSec,
    };
  });
}

export async function readLiveSyncRuns() {
  const c = await getRayfinClient();
  const rows = await c.data.SyncRun.select([
    'id', 'status', 'startedAt', 'finishedAt', 'itemsSynced', 'runsSynced', 'message',
  ]).where({ source: { eq: 'live' } }).orderBy({ startedAt: 'desc' }).first(20).execute();
  return rows.map((row) => ({
    ...row, startedAt: new Date(row.startedAt),
    finishedAt: row.finishedAt ? new Date(row.finishedAt) : undefined,
  }));
}
