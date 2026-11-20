/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  helloWorld: {
    input: { firstName: string; lastName: string };
    output: string;
  };
  getLiveWorkspaces: {
    input: Record<string, never>;
    output: { workspaces: { id: string; displayName: string; capacityId?: undefined | string }[]; capacities: { id: string; displayName: string; sku: string }[] };
  };
  syncFabricSchedules: {
    input: { workspaceIds: string[]; cursor: string };
    output: { id: string; status: string; itemsSynced: number; runsSynced: number; message: string; cursor: string };
  };
  getRunningNow: {
    input: { itemKeys: string[] };
    output: { itemKey: string; runId: string; startUtc: string; status: string }[];
  };
};
