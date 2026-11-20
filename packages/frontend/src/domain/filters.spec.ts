import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterItems, filterOccurrences, parseFilters } from './filters';
import { generateSampleData, SAMPLE_DATE } from '../sample/data';
import { expandOccurrences } from './schedule';

describe('shared filters', () => {
  it('combines type, workspace, owner, status, executive and clock/day filters', () => {
    const data = generateSampleData();
    const item = data.items[1];
    const filters = {
      ...EMPTY_FILTERS, types: ['SemanticModel'], workspace: [item.workspaceId], owner: [item.owner!],
      status: [item.lastStatus!], criticality: ['Executive'], weekday: ['1'], start: '05:55', end: '06:05',
    };
    const items = filterItems(data.items, new Map(data.annotations.map((row) => [row.itemKey, row])), filters);
    expect(items.map((row) => row.id)).toEqual([item.id]);
    expect(filterOccurrences(expandOccurrences(items, SAMPLE_DATE), filters, 'America/New_York')).toHaveLength(1);
    expect(filterOccurrences(expandOccurrences(items, SAMPLE_DATE), { ...filters, weekday: ['2'] }, 'America/New_York')).toEqual([]);
  });

  it('round-trips saved views and rejects unsupported formats', () => {
    expect(parseFilters(JSON.stringify(EMPTY_FILTERS))).toEqual(EMPTY_FILTERS);
    expect(() => parseFilters('{}')).toThrow();
    expect(() => parseFilters(JSON.stringify({ ...EMPTY_FILTERS, start: '25:00' }))).toThrow();
    expect(() => parseFilters(JSON.stringify({ ...EMPTY_FILTERS, types: ['NotAType'] }))).toThrow();
    expect(() => parseFilters(JSON.stringify({ ...EMPTY_FILTERS, weekday: ['8'] }))).toThrow();
    expect(() => parseFilters(JSON.stringify({ ...EMPTY_FILTERS, criticality: ['Urgent'] }))).toThrow();
  });

  it('migrates existing single-select saved views without changing their meaning', () => {
    expect(parseFilters(JSON.stringify({
      types: ['Notebook'], workspace: 'sample-workspace-7', owner: 'writer01@example.org',
      status: 'Failed', weekday: '2', start: '03:00', end: '07:00', criticalOnly: true,
    }))).toEqual({
      ...EMPTY_FILTERS, types: ['Notebook'], workspace: ['sample-workspace-7'], owner: ['writer01@example.org'],
      status: ['Failed'], weekday: ['2'], start: '03:00', end: '07:00', criticality: ['Executive'],
    });
  });

  it('matches any selection per field, combines fields and partitions the sample capacities', () => {
    const data = generateSampleData();
    const annotations = new Map(data.annotations.map((row) => [row.itemKey, row]));
    const filters = {
      ...EMPTY_FILTERS, capacity: 'sample-capacity-b', types: ['Notebook', 'CopyJob'],
      workspace: ['sample-workspace-7', 'sample-workspace-0'],
      criticality: ['Executive', 'Standard'], status: ['Failed', 'Completed'],
    };
    const selected = filterItems(data.items, annotations, filters);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((item) => item.workspaceId === 'sample-workspace-7'
      && ['Notebook', 'CopyJob'].includes(item.itemType))).toBe(true);
    const a = filterItems(data.items, annotations, { ...EMPTY_FILTERS, capacity: 'sample-capacity-a' });
    const b = filterItems(data.items, annotations, { ...EMPTY_FILTERS, capacity: 'sample-capacity-b' });
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.length + b.length).toBe(data.items.length);
    expect(a.some((item) => b.includes(item))).toBe(false);
    const standard = filterItems(data.items, new Map(), { ...EMPTY_FILTERS, criticality: ['Standard'] });
    expect(standard).toHaveLength(data.items.length);
    const days = filterOccurrences(expandOccurrences(data.items, SAMPLE_DATE), { ...EMPTY_FILTERS, weekday: ['1', '2'] }, 'America/New_York');
    expect(days.length).toBeGreaterThan(0);
  });
});
