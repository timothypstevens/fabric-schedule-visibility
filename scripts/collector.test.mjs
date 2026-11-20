import { it } from 'node:test';
import assert from 'node:assert/strict';
import { collectBatch } from '../packages/functions/dist/collector.js';

const workspaceId = '11111111-1111-4111-a111-111111111111';
const itemIds = [2, 3, 4].map((n) => `${n}${'0'.repeat(7)}-1111-4111-a111-111111111111`);
const runId = '55555555-1111-4111-a111-111111111111';

function table() {
  const rows = new Map();
  return {
    rows,
    create: async (row) => { assert.ok(!rows.has(row.id), 'must not duplicate persisted rows'); rows.set(row.id, { ...row }); },
    update: async ({ id }, patch) => { assert.ok(rows.has(id)); rows.set(id, { ...rows.get(id), ...patch }); },
    select() {
      let where = {};
      const selected = () => [...rows.values()].filter((row) => Object.entries(where).every(([key, condition]) => row[key] === condition.eq));
      const query = {
        where(value) { where = value; return query; }, first() { return query; }, orderBy() { return query; },
        execute: async () => selected(), executePaginated: async () => ({ items: selected(), hasNextPage: false }),
      };
      return query;
    },
  };
}

it('resumes bounded workspace batches, upserts idempotently and records explicit unsupported-item results', async () => {
  const original = globalThis.fetch;
  const data = { ScheduledItem: table(), RunInstance: table(), SyncRun: table() };
  const ctx = { Tokens: { Fabric: 'test-token' }, getDataClient: () => data };
  const now = new Date();
  let unsupported = false;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    const path = new URL(url).pathname;
    let response;
    if (path.endsWith(`/workspaces/${workspaceId}`)) response = { id: workspaceId, displayName: 'Real fixture shape' };
    else if (path.endsWith('/items')) response = { value: itemIds.map((id) => ({ id, displayName: id, type: 'Notebook' })) };
    else if (path.endsWith('/schedules')) response = { value: [{
      enabled: true, configuration: {
        type: unsupported ? 'Monthly' : 'Daily', times: ['06:00'], localTimeZoneId: 'UTC',
        startDateTime: '2026-01-01T00:00:00Z', endDateTime: '2030-01-01T00:00:00Z',
      },
    }] };
    else if (path.endsWith('/instances')) response = { value: [{
      id: runId, jobType: 'RunNotebook', status: 'Completed', invokeType: 'Scheduled',
      startTimeUtc: new Date(now.getTime() - 120000).toISOString(), endTimeUtc: now.toISOString(),
    }] };
    else throw new Error(`Unexpected external path: ${path}`);
    return new Response(JSON.stringify(response), { status: 200 });
  };
  try {
    let result = await collectBatch([workspaceId], '', ctx);
    assert.equal(result.status, 'Running');
    assert.equal(result.itemsSynced, 2);
    assert.ok(result.cursor);
    result = await collectBatch([workspaceId], result.cursor, ctx);
    assert.equal(result.status, 'Succeeded');
    assert.equal(result.itemsSynced, 3);
    assert.equal(result.runsSynced, 3);
    assert.equal(data.SyncRun.rows.get(result.id).status, 'Succeeded');
    assert.ok(data.SyncRun.rows.get(result.id).finishedAt);
    assert.ok([...data.ScheduledItem.rows.values()].every((row) => row.avgDurationSec === 120));
    let repeated = await collectBatch([workspaceId], '', ctx);
    repeated = await collectBatch([workspaceId], repeated.cursor, ctx);
    assert.equal(repeated.status, 'Succeeded');
    assert.equal(data.ScheduledItem.rows.size, 3);
    assert.equal(data.RunInstance.rows.size, 3);
    unsupported = true;
    let partial = await collectBatch([workspaceId], '', ctx);
    partial = await collectBatch([workspaceId], partial.cursor, ctx);
    assert.equal(partial.status, 'Partial');
    assert.match(partial.message, /monthly/);
    assert.ok([...data.ScheduledItem.rows.values()].every((row) => row.enabled === false));
    assert.ok(calls.every((call) => call.method === 'GET' && call.url.startsWith('https://api.fabric.microsoft.com/v1/')));
  } finally { globalThis.fetch = original; }
});

it('identifies an inaccessible source workspace in the persisted failure without exposing provider bodies', async () => {
  const original = globalThis.fetch;
  const data = { ScheduledItem: table(), RunInstance: table(), SyncRun: table() };
  const ctx = { Tokens: { Fabric: 'test-token' }, getDataClient: () => data };
  globalThis.fetch = async () => new Response('private provider details', { status: 403 });
  try {
    const result = await collectBatch([workspaceId], '', ctx);
    assert.equal(result.status, 'Failed');
    assert.match(result.message, new RegExp(workspaceId));
    assert.match(result.message, /cannot read/);
    assert.ok(!result.message.includes('private provider details'));
    assert.equal(data.SyncRun.rows.get(result.id).message, result.message);
    assert.equal(data.ScheduledItem.rows.size, 0);
    assert.equal(data.RunInstance.rows.size, 0);
  } finally { globalThis.fetch = original; }
});
