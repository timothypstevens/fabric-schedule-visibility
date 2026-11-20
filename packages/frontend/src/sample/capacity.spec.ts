import { describe, expect, it } from 'vitest';
import { capacityReference } from './capacity';

describe('capacity defaults', () => {
  const capacities = [
    { id: 'a', sku: 'F4' }, { id: 'b', sku: 'F4' }, { id: 'trial', sku: 'Trial' },
  ];

  it('uses the selected current SKU and sums individual limits rather than the summed SKU limit', () => {
    expect(capacityReference(capacities, 'a')).toEqual({ label: 'F4', limit: 2 });
    expect(capacityReference(capacities, '')).toEqual({ label: '8 CUs (total)', limit: 4 });
    expect(capacityReference([{ id: 'a', sku: 'F64' }], 'a')).toEqual({ label: 'F64', limit: 40 });
  });

  it('excludes unknown sizes and never invents a reference for an unknown selection', () => {
    for (const id of ['trial', 'missing']) expect(capacityReference(capacities, id)).toEqual({ label: 'Unavailable', limit: null });
    expect(capacityReference([], '')).toEqual({ label: 'Unavailable', limit: null });
  });
});
