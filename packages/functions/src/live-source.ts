export interface LiveWorkspace {
  id: string;
  displayName: string;
  capacityId?: string;
}

export interface LiveCapacity { id: string; displayName: string; sku: string }
export interface FabricItem { id: string; displayName: string; type: string }

export function validateWorkspaceIds(ids: readonly string[]): void {
  if (!Array.isArray(ids) || ids.length !== 1 || !isGuid(ids[0])) {
    throw new Error('Sync one valid workspace per batch. Choose from the discovered sources.');
  }
}

export const isGuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

export class FabricReadError extends UserThrownError {
  constructor(message: string) { super(message); this.name = 'FabricReadError'; }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FabricReadError('Fabric returned an invalid response. Retry the sync or contact the app administrator.');
  }
  return value as Record<string, unknown>;
}

export class FabricReader {
  private readonly deadline: number;
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly clock: () => number = Date.now,
  ) { this.deadline = clock() + 60_000; }

  private async get(path: string): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remaining = this.deadline - this.clock();
      if (remaining <= 0) throw new FabricReadError('Fabric read deadline exceeded. Retry the sync.');
      let response: Response;
      try {
        response = await this.request(`https://api.fabric.microsoft.com/v1/${path}`, {
          method: 'GET', headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(Math.min(remaining, 15_000)), redirect: 'error',
        });
      } catch {
        throw new FabricReadError('Fabric could not be reached within the read deadline. Retry the sync.');
      }
      if (response.status === 429) {
        const header = response.headers.get('Retry-After');
        const delay = header && /^\d+$/.test(header)
          ? Number(header) * 1000 : header ? Date.parse(header) - this.clock() : 1000;
        if (!Number.isFinite(delay) || delay < 0 || delay >= this.deadline - this.clock() || attempt === 3) {
          throw new FabricReadError('Fabric is throttling requests. Wait before retrying the sync.');
        }
        await this.sleep(delay);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new FabricReadError('The app owner cannot read this Fabric resource. Check workspace access, capacity permissions, and delegated scopes.');
      }
      if (!response.ok) throw new FabricReadError(`Fabric inventory read failed (HTTP ${response.status}). Retry or check workspace access.`);
      try { return object(await response.json()); }
      catch (error) {
        if (error instanceof FabricReadError) throw error;
        throw new FabricReadError('Fabric returned invalid JSON. Retry the sync.');
      }
    }
    throw new FabricReadError('Fabric read retries were exhausted.');
  }

  private workspaceRow(row: Record<string, unknown>): LiveWorkspace {
    if (!isGuid(row.id) || typeof row.displayName !== 'string'
      || (row.capacityId != null && typeof row.capacityId !== 'string')) {
      throw new FabricReadError('Fabric returned invalid workspace metadata.');
    }
    return { id: row.id, displayName: row.displayName, capacityId: typeof row.capacityId === 'string' ? row.capacityId : undefined };
  }

  async list(path: string): Promise<Record<string, unknown>[]> {
    let token: string | undefined;
    const seen = new Set<string>();
    const output: Record<string, unknown>[] = [];
    for (let page = 0; page < 100; page++) {
      const row = await this.get(`${path}${token ? `?continuationToken=${encodeURIComponent(token)}` : ''}`);
      if (!Array.isArray(row.value)) throw new FabricReadError('Fabric returned an invalid result list.');
      output.push(...row.value.map(object));
      if (output.length > 20_000) throw new FabricReadError('Fabric results exceed the bounded batch size.');
      if (row.continuationToken == null || row.continuationToken === '') return output;
      if (typeof row.continuationToken !== 'string' || seen.has(row.continuationToken)) {
        throw new FabricReadError('Fabric inventory pagination did not advance.');
      }
      token = row.continuationToken; seen.add(token);
    }
    throw new FabricReadError('Fabric inventory exceeds this sync batch. Narrow the source scope.');
  }

  async workspaces(): Promise<LiveWorkspace[]> {
    return (await this.list('workspaces')).map((row) => this.workspaceRow(row));
  }

  async capacities(): Promise<LiveCapacity[]> {
    return (await this.list('capacities')).map((row) => {
      if (!isGuid(row.id) || typeof row.displayName !== 'string' || typeof row.sku !== 'string') {
        throw new FabricReadError('Fabric returned invalid capacity metadata.');
      }
      return { id: row.id, displayName: row.displayName, sku: row.sku };
    });
  }

  async workspace(id: string): Promise<LiveWorkspace> {
    validateWorkspaceIds([id]);
    const row = this.workspaceRow(await this.get(`workspaces/${id}`));
    if (row.id !== id) throw new FabricReadError('Fabric returned a different workspace.');
    return row;
  }

  async items(id: string): Promise<FabricItem[]> {
    validateWorkspaceIds([id]);
    return (await this.list(`workspaces/${id}/items`)).map((row) => {
      if (!isGuid(row.id) || typeof row.type !== 'string' || typeof row.displayName !== 'string') {
        throw new FabricReadError('Fabric returned invalid item metadata.');
      }
      return { id: row.id, type: row.type, displayName: row.displayName };
    });
  }
}
import { UserThrownError } from '@microsoft/fabric-user-data-functions';

