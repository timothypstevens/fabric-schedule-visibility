export const sampleCapacities = [
  { id: 'sample-capacity-a', name: 'Capacity A', sku: 'F256' },
  { id: 'sample-capacity-b', name: 'Capacity B', sku: 'F64' },
] as const;

const workspaceCapacities = new Map(Array.from({ length: 12 }, (_, index) => [
  `sample-workspace-${index}`, sampleCapacities[index < 6 ? 0 : 1].id,
]));

export function sampleWorkspaceCapacity(workspaceId: string): string | undefined {
  return workspaceCapacities.get(workspaceId);
}
