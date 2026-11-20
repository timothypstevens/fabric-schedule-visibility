import type { RayfinContext, AudienceType } from '@microsoft/fabric-user-data-functions';
import type { AppSchema, ScheduledItemRecord } from '@rayfin-app/shared';
import { FabricReader, FabricReadError, isGuid, object, validateWorkspaceIds } from './live-source.js';
import { jobs, normalizeRuns, normalizeSchedules, stableId, statistics } from './normalize.js';

type Context = RayfinContext<AppSchema, AudienceType.Fabric>;
export interface SyncResult {
  id: string; status: string; itemsSynced: number; runsSynced: number; message: string; cursor: string;
}

function cursorState(cursor: string, workspaceId: string) {
  if (!cursor) return { after: '', id: crypto.randomUUID(), issues: 0 };
  if (cursor.length > 1000) throw new Error('Invalid sync continuation.');
  const row = object(JSON.parse(cursor));
  if (row.workspaceId !== workspaceId || !isGuid(row.id) || !isGuid(row.after)
    || !Number.isSafeInteger(row.issues) || Number(row.issues) < 0) throw new Error('Invalid sync continuation.');
  return { after: row.after, id: row.id, issues: Number(row.issues) };
}

export async function collectBatch(workspaceIds: string[], cursor: string, ctx: Context): Promise<SyncResult> {
  validateWorkspaceIds(workspaceIds);
  const workspaceId = workspaceIds[0];
  const state = cursorState(cursor, workspaceId);
  const data = ctx.getDataClient();
  let itemsSynced = 0; let runsSynced = 0;
  let priorNotes = '';
  if (cursor) {
    const [existing] = await data.SyncRun.select(['source', 'status', 'itemsSynced', 'runsSynced', 'message'])
      .where({ id: { eq: state.id } }).first(1).execute();
    if (!existing || existing.source !== 'live' || existing.status !== 'Running') throw new Error('This sync is no longer resumable. Start a new sync.');
    itemsSynced = existing.itemsSynced; runsSynced = existing.runsSynced;
    priorNotes = existing.message?.split('\n').slice(1).join('\n') ?? '';
  } else {
    await data.SyncRun.create({ id: state.id, source: 'live', status: 'Running', startedAt: new Date(), itemsSynced, runsSynced });
  }
  const notices: string[] = priorNotes ? [priorNotes] : [];
  let next = ''; let status = 'Succeeded';
  try {
    const reader = new FabricReader(ctx.Tokens.Fabric);
    const workspace = await reader.workspace(workspaceId);
    const inventory = (await reader.items(workspaceId)).sort((a, b) => a.id.localeCompare(b.id));
    const collectable = inventory.filter((item) => jobs[item.type]);
    const pending = collectable.filter((item) => item.id.localeCompare(state.after) > 0);
    const batch = pending.slice(0, 2);
    if (!cursor) {
      const skipped = inventory.filter((item) => ['SemanticModel', 'DataflowGen1'].includes(item.type)).length;
      if (skipped) { state.issues += skipped; notices.push(`${skipped} semantic model/Gen1 items skipped: Power BI audience requires the optional collector.`); }
    }
    for (const item of batch) {
      const spec = jobs[item.type];
      const itemKey = `${workspaceId}:${item.id}:${spec.jobType}`;
      const id = stableId(`live:${itemKey}`);
      try {
        const path = `workspaces/${workspaceId}/items/${item.id}`;
        const schedulesPath = item.type === 'CopyJob'
          ? `workspaces/${workspaceId}/copyJobs/${item.id}/jobs/execute/schedules`
          : `${path}/jobs/${encodeURIComponent(spec.jobType)}/schedules`;
        const schedules = normalizeSchedules(await reader.list(schedulesPath));
        const rawRuns = await reader.list(`${path}/jobs/instances`);
        const runs = normalizeRuns(rawRuns, itemKey, spec.jobType, Date.now());
        const json = JSON.stringify(schedules);
        if (json.length > 4000) throw new FabricReadError('Schedules exceed the 4000-character metadata limit; item not imported.');
        const first = schedules[0];
        const row: ScheduledItemRecord = {
          id, itemKey, workspaceId, workspaceName: workspace.displayName,
          capacityId: workspace.capacityId, liveSchedulesJson: json,
          fabricItemId: item.id, itemName: item.displayName, itemType: spec.itemType, jobType: spec.jobType,
          scheduleType: first?.type ?? 'Daily', scheduleDays: first?.days, scheduleTimes: first?.times,
          intervalMinutes: first?.intervalMinutes, timeZoneId: first?.timeZoneId ?? 'UTC',
          enabled: schedules.some((schedule) => schedule.enabled), ...statistics(runs),
          source: 'live', syncedAt: new Date(),
        };
        const [existing] = await data.ScheduledItem.select(['id']).where({ id: { eq: id } }).first(1).execute();
        if (existing) await data.ScheduledItem.update({ id }, row);
        else await data.ScheduledItem.create(row);
        itemsSynced++;
        // Bound app-owned writes as well as external reads.
        for (let offset = 0; offset < runs.length; offset += 5) {
          const writes = await Promise.allSettled(runs.slice(offset, offset + 5).map(async (run) => {
            const [existingRun] = await data.RunInstance.select(['id']).where({ id: { eq: run.id } }).first(1).execute();
            if (existingRun) await data.RunInstance.update({ id: run.id }, run);
            else await data.RunInstance.create(run);
            runsSynced++;
          }));
          const failure = writes.find((write) => write.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
        }
      } catch (error) {
        state.issues++;
        notices.push(`${item.displayName}: ${safeFailure(error)}`);
        const [existing] = await data.ScheduledItem.select(['id']).where({ id: { eq: id } }).first(1).execute();
        if (existing) await data.ScheduledItem.update({ id }, { enabled: false, syncedAt: new Date() });
      }
    }
    if (pending.length > batch.length && batch.length) {
      next = JSON.stringify({ workspaceId, id: state.id, after: batch[batch.length - 1].id, issues: state.issues });
      status = 'Running';
    } else {
      // Remove stale projections only after a complete inventory read; never mutate source workloads.
      const current = new Set(collectable.map((item) => `${workspaceId}:${item.id}:${jobs[item.type].jobType}`));
      let after: string | undefined;
      do {
        let query = data.ScheduledItem.select(['id', 'itemKey']).where({ source: { eq: 'live' }, workspaceId: { eq: workspaceId } })
          .orderBy({ id: 'asc' }).first(100);
        if (after) query = query.after(after);
        const page = await query.executePaginated();
        for (const row of page.items) if (!current.has(row.itemKey)) await data.ScheduledItem.update({ id: row.id }, {
          enabled: false, liveSchedulesJson: '[]', lastStatus: 'Unknown', syncedAt: new Date(),
        });
        if (page.hasNextPage && (!page.endCursor || page.endCursor === after)) throw new Error('Stored item pagination did not advance.');
        after = page.hasNextPage ? page.endCursor ?? undefined : undefined;
      } while (after);
      if (state.issues) status = 'Partial';
    }
    notices.unshift(`${workspace.displayName}: ${itemsSynced} items and ${runsSynced} runs imported. ${state.issues} skipped/failed items. History is limited to the job instances retained by Fabric.`);
  } catch (error) {
    status = itemsSynced || runsSynced ? 'Partial' : 'Failed';
    notices.push(`Workspace ${workspaceId}: ${safeFailure(error)}`);
  }
  const message = notices.join('\n').slice(0, 1000);
  await data.SyncRun.update({ id: state.id }, {
    status: status === 'Running' ? 'Running' : status === 'Succeeded' ? 'Succeeded' : status === 'Partial' ? 'Partial' : 'Failed',
    ...(next ? {} : { finishedAt: new Date() }), itemsSynced, runsSynced, message,
  });
  return { id: state.id, status, itemsSynced, runsSynced, message, cursor: next };
}

export function safeFailure(error: unknown): string {
  if (error instanceof FabricReadError) return error.message;
  console.error('Live collection failed. Check source access and app metadata permissions.');
  return 'Live collection failed. Check source access and app metadata permissions, then start a new sync.';
}
