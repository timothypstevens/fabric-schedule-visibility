import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSampleData } from '../sample/data';
import { pollLiveRunning, syncLiveSource } from './live-source';

const mocks = vi.hoisted(() => ({ sync: vi.fn(), running: vi.fn() }));
vi.mock('../lib/rayfin-client', () => ({
  getRayfinClient: async () => ({ functions: {
    syncFabricSchedules: { invoke: mocks.sync }, getRunningNow: { invoke: mocks.running },
  } }),
}));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('live orchestration', () => {
  it('finishes every workspace continuation before moving to the next workspace and reports partial results', async () => {
    mocks.sync.mockResolvedValueOnce({ id: 'one', status: 'Running', itemsSynced: 2, runsSynced: 3, cursor: 'next' })
      .mockResolvedValueOnce({ id: 'one', status: 'Succeeded', itemsSynced: 3, runsSynced: 4, cursor: '', message: 'one done' })
      .mockResolvedValueOnce({ id: 'two', status: 'Partial', itemsSynced: 0, runsSynced: 0, cursor: '', message: 'unsupported' });
    const result = await syncLiveSource(['one', 'two']);
    expect(mocks.sync.mock.calls.map(([args]) => args)).toEqual([
      { workspaceIds: ['one'], cursor: '' }, { workspaceIds: ['one'], cursor: 'next' }, { workspaceIds: ['two'], cursor: '' },
    ]);
    expect(result).toMatchObject({ status: 'Partial', itemsSynced: 3, runsSynced: 4 });
    expect(result.message).toContain('unsupported');
  });

  it('rejects stuck sync continuation rather than reporting completion', async () => {
    mocks.sync.mockResolvedValue({ id: 'one', status: 'Running', cursor: 'same' });
    await expect(syncLiveSource(['one'])).rejects.toThrow('did not advance');
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it('polls only projected candidates or previously running items and renders verified actuals without fabricated slots', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const item = { ...generateSampleData().items[0], source: 'live' as const, itemType: 'Notebook' as const,
      enabled: false, lastStatus: 'InProgress' as const, avgDurationSec: 60 };
    const idle = { ...item, itemKey: 'idle', lastStatus: 'Completed' as const };
    mocks.running.mockResolvedValue([{ itemKey: item.itemKey, runId: 'active', startUtc: '2026-11-18T11:58:00Z', status: 'InProgress' }]);
    const runs = await pollLiveRunning([item, idle]);
    expect(mocks.running.mock.calls[0][0]).toEqual({ itemKeys: [item.itemKey] });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ overrun: true, scheduledStartMs: undefined, kind: 'actual' });
    expect(runs[0].endMs).toBe(Date.now());
    mocks.running.mockClear();
    expect(await pollLiveRunning([idle])).toEqual([]);
    expect(mocks.running).not.toHaveBeenCalled();
  });
});
