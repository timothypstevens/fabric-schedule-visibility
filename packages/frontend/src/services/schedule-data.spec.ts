import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSampleData } from '../sample/data';
import { clearSampleData, collectPages, loadSampleData, readScheduleData, runBounded } from './schedule-data';

type StoredRow = { id: string; [field: string]: unknown };
interface MockQuery {
  select: () => MockQuery;
  orderBy: () => MockQuery;
  first: () => MockQuery;
  after: () => MockQuery;
  executePaginated: () => Promise<{ items: StoredRow[]; hasNextPage: boolean }>;
}

const database = vi.hoisted(() => {
  function table() {
    const rows = new Map<string, StoredRow>();
    const query: MockQuery = {
      select: () => query, orderBy: () => query, first: () => query, after: () => query,
      executePaginated: async () => ({ items: [...rows.values()], hasNextPage: false }),
    };
    return {
      rows, select: query.select,
      create: vi.fn(async (row: StoredRow) => {
        if (rows.has(row.id)) throw new Error('Duplicate id');
        rows.set(row.id, row);
      }),
      delete: vi.fn(async ({ id }: { id: string }) => { rows.delete(id); }),
    };
  }
  return { ScheduledItem: table(), RunInstance: table(), ItemAnnotation: table(), SavedView: table() };
});

vi.mock('../lib/rayfin-client', () => ({ getRayfinClient: async () => ({ data: database }) }));

beforeEach(() => {
  for (const table of Object.values(database)) table.rows.clear();
  vi.clearAllMocks();
});

describe('metadata pagination and bounded writes', () => {
  it('collects multiple pages and rejects a stuck cursor instead of silently truncating', async () => {
    const cursors: (string | undefined)[] = [];
    expect(await collectPages(async (cursor) => {
      cursors.push(cursor);
      return cursor ? { items: [2], hasNextPage: false } : { items: [1], hasNextPage: true, endCursor: 'next' };
    })).toEqual([1, 2]);
    expect(cursors).toEqual([undefined, 'next']);
    await expect(collectPages(async () => ({ items: [], hasNextPage: true, endCursor: 'same' })))
      .rejects.toThrow('did not advance');
  });

  it('caps concurrent requests at ten and reports completion', async () => {
    let active = 0; let max = 0; let done = 0;
    await runBounded(Array.from({ length: 31 }, () => async () => {
      active++; max = Math.max(active, max);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    }), (completed) => { done = completed; });
    expect(max).toBe(10); expect(done).toBe(31); expect(active).toBe(0);
  });

  it('awaits in-flight writes but stops scheduling on failure and surfaces it', async () => {
    let completed = 0;
    await expect(runBounded([
      async () => { throw new Error('Write denied'); },
      async () => { await new Promise((resolve) => setTimeout(resolve, 5)); completed++; },
      async () => { completed += 100; },
    ], () => {}, 2)).rejects.toThrow('Write denied');
    expect(completed).toBe(1);
  });

  it('does not report success when a write rejects without an error value', async () => {
    const later = vi.fn(async () => {});
    await expect(runBounded([() => Promise.reject(), later], () => {}, 1)).rejects.toBeUndefined();
    expect(later).not.toHaveBeenCalled();
  });
});

describe('sample metadata lifecycle', () => {
  it('resumes loading missing rows without overwriting existing items, runs or annotations', async () => {
    const sample = generateSampleData();
    const item = { ...sample.items[0], itemName: 'Existing sample title' };
    const annotation = { ...sample.annotations[0], note: 'Keep my annotation' };
    const run = { ...sample.runs[0] };
    database.ScheduledItem.rows.set(item.id, item);
    database.ItemAnnotation.rows.set(annotation.id, annotation);
    database.RunInstance.rows.set(run.id, run);
    await loadSampleData(() => {});
    await loadSampleData(() => {});
    const stored = await readScheduleData();
    expect(stored.items).toHaveLength(sample.items.length);
    expect(stored.runs).toHaveLength(sample.runs.length);
    expect(stored.items.find((row) => row.id === item.id)?.itemName).toBe('Existing sample title');
    expect(stored.annotations.find((row) => row.id === annotation.id)?.note).toBe('Keep my annotation');
    expect(database.ScheduledItem.create).toHaveBeenCalledTimes(sample.items.length - 1);
    expect(database.RunInstance.create).toHaveBeenCalledTimes(sample.runs.length - 1);
    expect(database.ItemAnnotation.create).toHaveBeenCalledTimes(sample.annotations.length - 1);
  });

  it('clears only sample items, sample runs and their annotations, preserving live metadata and saved views', async () => {
    const sample = generateSampleData();
    const liveItem = { ...sample.items[0], id: 'live-fixture', itemKey: 'live-fixture-key', source: 'live' };
    const liveRun = { ...sample.runs[0], id: 'live-run-fixture', itemKey: liveItem.itemKey, source: 'live' };
    const liveAnnotation = { ...sample.annotations[0], id: 'live-note-fixture', itemKey: liveItem.itemKey };
    const view = { id: 'view-fixture', user_id: 'test-subject', name: 'Keep this view', filtersJson: '{}', createdAt: new Date() };
    await loadSampleData(() => {});
    database.ScheduledItem.rows.set(liveItem.id, liveItem);
    database.RunInstance.rows.set(liveRun.id, liveRun);
    database.ItemAnnotation.rows.set(liveAnnotation.id, liveAnnotation);
    database.SavedView.rows.set(view.id, view);
    await clearSampleData(() => {});
    const stored = await readScheduleData();
    expect(stored.items.map((row) => row.id)).toEqual([liveItem.id]);
    expect(stored.runs.map((row) => row.id)).toEqual([liveRun.id]);
    expect(stored.annotations.map((row) => row.id)).toEqual([liveAnnotation.id]);
    expect(stored.views.map((row) => row.id)).toEqual([view.id]);
    expect(database.SavedView.delete).not.toHaveBeenCalled();
  });

  it('retains parent items after a dependent deletion fails so clearing can safely resume', async () => {
    await loadSampleData(() => {});
    database.ItemAnnotation.delete.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('Delete denied');
    });
    await expect(clearSampleData(() => {})).rejects.toThrow('Delete denied');
    expect(database.ScheduledItem.delete).not.toHaveBeenCalled();
    await clearSampleData(() => {});
    expect(database.ScheduledItem.rows.size).toBe(0);
    expect(database.ItemAnnotation.rows.size).toBe(0);
    expect(database.RunInstance.rows.size).toBe(0);
  });
});
