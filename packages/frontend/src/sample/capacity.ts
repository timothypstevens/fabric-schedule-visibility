// Microsoft Learn: Semantic model SKU limitation, Model refresh parallelism.
// https://learn.microsoft.com/en-us/fabric/enterprise/powerbi/service-premium-what-is#semantic-model-sku-limitation
export const semanticModelLimits = {
  F2: 1, F4: 2, F8: 5, F16: 10, F32: 20, F64: 40, F128: 80,
  F256: 160, F512: 320, F1024: 640, F2048: 1280, F4096: 1280, F8192: 1280,
} as const;

export type SampleCapacitySku = keyof typeof semanticModelLimits;

export function isSampleCapacitySku(value: string): value is SampleCapacitySku {
  return Object.hasOwn(semanticModelLimits, value);
}

export interface CapacityReference { label: string; limit: number | null }

export function capacityReference(capacities: readonly { id: string; sku: string }[], selectedId: string): CapacityReference {
  const selected = capacities.filter((capacity) => !selectedId || capacity.id === selectedId);
  const known = selected.filter((capacity): capacity is { id: string; sku: SampleCapacitySku } => isSampleCapacitySku(capacity.sku));
  if (!known.length) return { label: 'Unavailable', limit: null };
  if (selectedId) return { label: known[0].sku, limit: semanticModelLimits[known[0].sku] };
  return {
    label: `${known.reduce((sum, capacity) => sum + Number(capacity.sku.slice(1)), 0)} CUs (total)`,
    limit: known.reduce((sum, capacity) => sum + semanticModelLimits[capacity.sku], 0),
  };
}
