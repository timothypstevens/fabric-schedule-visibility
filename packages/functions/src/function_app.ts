import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { AppSchema } from '@rayfin-app/shared';
import { FabricReader } from './live-source.js';
import { requireOwner } from './access.js';
import { collectBatch, type SyncResult } from './collector.js';
import { jobs, normalizeRuns, stableId } from './normalize.js';

const udf = new UserDataFunctions();

udf.func(
  'helloWorld',
  (firstName: string, lastName: string): string =>
    `Hello ${firstName} ${lastName}!`,
  []
);

udf.func('getLiveWorkspaces', async (ctx: RayfinContext<AppSchema, AudienceType.Fabric>): Promise<{
  workspaces: { id: string; displayName: string; capacityId?: string }[];
  capacities: { id: string; displayName: string; sku: string }[];
}> => {
  requireOwner(ctx.accessToken);
  const reader = new FabricReader(ctx.Tokens.Fabric);
  const workspaces = await reader.workspaces();
  const capacities = await reader.capacities();
  return { workspaces, capacities };
}, []);

udf.func('syncFabricSchedules', async (
  workspaceIds: string[], cursor: string, ctx: RayfinContext<AppSchema, AudienceType.Fabric>,
): Promise<SyncResult> => {
  requireOwner(ctx.accessToken);
  return collectBatch(workspaceIds, cursor, ctx);
}, []);

udf.func('getRunningNow', async (
  itemKeys: string[], ctx: RayfinContext<AppSchema, AudienceType.Fabric>,
): Promise<{ itemKey: string; runId: string; startUtc: string; status: string }[]> => {
  requireOwner(ctx.accessToken);
  if (!Array.isArray(itemKeys) || itemKeys.length > 20 || itemKeys.some((key) => typeof key !== 'string' || key.length > 200)) {
    throw new Error('Request at most 20 imported live items per running-status batch.');
  }
  const reader = new FabricReader(ctx.Tokens.Fabric);
  const data = ctx.getDataClient();
  const output: { itemKey: string; runId: string; startUtc: string; status: string }[] = [];
  for (const itemKey of new Set(itemKeys)) {
    const [item] = await data.ScheduledItem.select(['workspaceId', 'fabricItemId', 'jobType', 'source', 'itemType'])
      .where({ id: { eq: stableId(`live:${itemKey}`) }, itemKey: { eq: itemKey } }).first(1).execute();
    if (!item || item.source !== 'live' || !item.jobType || !jobs[item.itemType]) throw new Error('A requested item is not an imported supported live workload.');
    const rows = normalizeRuns(await reader.list(`workspaces/${item.workspaceId}/items/${item.fabricItemId}/jobs/instances`), itemKey, item.jobType, Date.now());
    output.push(...rows.filter((run) => run.status === 'InProgress').map((run) => ({
      itemKey, runId: run.runId, startUtc: run.startUtc.toISOString(), status: run.status,
    })));
  }
  return output;
}, []);
