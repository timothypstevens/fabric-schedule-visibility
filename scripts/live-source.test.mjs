import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FabricReader } from '../packages/functions/dist/live-source.js';
import { normalizeSchedules, normalizeRuns, statistics } from '../packages/functions/dist/normalize.js';
import { requireOwner } from '../packages/functions/dist/access.js';
import { PILOT_OWNER_SUBJECT } from '@rayfin-app/shared';

const id = '11111111-1111-4111-a111-111111111111';
const second = '22222222-2222-4222-a222-222222222222';
const workspace = { id, displayName: 'Workspace one' };
const json = (value) => new Response(JSON.stringify(value), { status: 200 });

describe('owner-scoped Fabric source', () => {
  it('discovers all workspaces across pages without following untrusted URLs', async () => {
    const calls = [];
    const responses = [
      json({ value: [workspace], continuationToken: 'next&page', continuationUri: 'https://untrusted.example/' }),
      json({ value: [{ id: second, displayName: 'Workspace two' }] }),
      json({ value: [{ id, displayName: 'Capacity one', sku: 'F4' }] }),
    ];
    const reader = new FabricReader('private-token', async (url, options) => {
      calls.push({ url, method: options.method }); return responses.shift();
    });
    assert.deepEqual((await reader.workspaces()).map((row) => row.id), [id, second]);
    assert.equal((await reader.capacities())[0].sku, 'F4');
    assert.ok(calls.every((call) => call.method === 'GET' && call.url.startsWith('https://api.fabric.microsoft.com/v1/')));
    assert.ok(calls[1].url.endsWith('continuationToken=next%26page'));
  });

  it('rejects invalid workspace paths before outbound requests', async () => {
    let called = false;
    const reader = new FabricReader('private-token', async () => { called = true; return json({}); });
    await assert.rejects(reader.workspace('../other'), /valid workspace/);
    assert.equal(called, false);
  });

  it('honors Retry-After without returning provider data or tokens', async () => {
    const delays = [];
    const responses = [
      new Response('sensitive provider body', { status: 429, headers: { 'Retry-After': '2' } }),
      json(workspace),
    ];
    const reader = new FabricReader('private-token', async () => responses.shift(), async (ms) => { delays.push(ms); });
    assert.equal((await reader.workspace(id)).displayName, 'Workspace one');
    assert.deepEqual(delays, [2000]);
    const denied = new FabricReader('private-token', async () => new Response('sensitive provider body', { status: 403 }));
    await assert.rejects(denied.workspace(id), (error) => /app owner/.test(error.message)
      && !/private-token|sensitive provider/.test(error.message));
  });

  it('stops rather than waiting beyond the invocation budget', async () => {
    const reader = new FabricReader('private-token', async () =>
      new Response('', { status: 429, headers: { 'Retry-After': '600' } }));
    await assert.rejects(reader.workspace(id), /throttling/);
  });

  it('detects malformed responses and repeated pagination tokens', async () => {
    const responses = [json({ value: [], continuationToken: 'same' }), json({ value: [], continuationToken: 'same' })];
    const reader = new FabricReader('private-token', async () => responses.shift());
    await assert.rejects(reader.workspaces(), /pagination did not advance/);
    const malformed = new FabricReader('private-token', async () => json({ id, displayName: 123 }));
    await assert.rejects(malformed.workspace(id), /invalid workspace metadata/);
  });

  it('checks the gateway-authenticated invocation subject before source access', () => {
    const token = (sub) => `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`;
    assert.doesNotThrow(() => requireOwner(token(PILOT_OWNER_SUBJECT)));
    assert.doesNotThrow(() => requireOwner(token(`/tenants/test/apps/app/users/${PILOT_OWNER_SUBJECT}`)));
    assert.throws(() => requireOwner(token('another-user')), /restricted/);
    assert.throws(() => requireOwner(token(`/tenants/test/apps/app/users/${PILOT_OWNER_SUBJECT}-other`)), /restricted/);
    assert.throws(() => requireOwner(token(`/tenants/test/apps/app/users/${PILOT_OWNER_SUBJECT}/another-user`)), /restricted/);
    assert.throws(() => requireOwner(token(null)), /authorization/);
    assert.throws(() => requireOwner(token(42)), /authorization/);
    assert.throws(() => requireOwner('malformed'), /authorization/);
  });

  it('normalizes Windows zones, multiple schedules and anchored intervals without approximating unsupported shapes', () => {
    const configuration = {
      startDateTime: '2026-01-01T10:07:00', endDateTime: '2027-01-01T00:00:00Z',
      localTimeZoneId: 'Eastern Standard Time', type: 'Weekly', weekdays: ['Monday', 'Friday'], times: ['06:00', '08:50'],
    };
    const rows = normalizeSchedules([
      { enabled: true, configuration },
      { enabled: false, configuration: { ...configuration, type: 'Cron', interval: 70 } },
    ]);
    assert.equal(rows[0].timeZoneId, 'America/New_York');
    assert.equal(rows[0].days, 'Mon,Fri');
    assert.equal(rows[1].intervalMinutes, 70);
    assert.equal(rows[1].startUtc, '2026-01-01T10:07:00.000Z');
    assert.throws(() => normalizeSchedules([{ enabled: true, configuration: { ...configuration, type: 'Monthly' } }]), /monthly/);
    assert.throws(() => normalizeSchedules([{ enabled: true, configuration: { ...configuration, localTimeZoneId: 'Unknown zone' } }]), /time zone/);
  });

  it('calculates rolling history statistics, excludes other job types and redacts failure bodies', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    const rows = [
      { id, jobType: 'RunNotebook', status: 'Completed', invokeType: 'Manual', startTimeUtc: '2026-11-18T10:00:00', endTimeUtc: '2026-11-18T10:02:00' },
      { id: second, jobType: 'RunNotebook', status: 'Failed', startTimeUtc: '2026-11-18T09:00:00Z', failureReason: { message: 'sensitive source details' } },
      { id, jobType: 'Publish', status: 'Completed', startTimeUtc: '2026-11-18T08:00:00Z' },
      { id, jobType: 'RunNotebook', status: 'Completed', startTimeUtc: '2026-10-01T00:00:00Z', endTimeUtc: '2026-10-01T01:00:00Z' },
    ];
    const runs = normalizeRuns(rows, 'key', 'RunNotebook', now);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].startUtc.toISOString(), '2026-11-18T10:00:00.000Z');
    assert.ok(!JSON.stringify(runs).includes('sensitive source'));
    const stats = statistics(runs, now);
    assert.equal(stats.runs7d, 2);
    assert.equal(stats.failures7d, 1);
    assert.equal(stats.avgDurationSec, 120);
    assert.equal(stats.medianDurationSec, 120);
    assert.equal(stats.p90DurationSec, 120);
    assert.equal(statistics([], now).avgDurationSec, null);
    assert.equal(runs[0].id, normalizeRuns(rows, 'key', 'RunNotebook', now)[0].id);
  });
});
