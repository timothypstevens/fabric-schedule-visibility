import { useEffect, useState } from 'react';
import { Button } from '@fluentui/react-components';
import { DateTime } from 'luxon';
import type { DataSource } from '@rayfin-app/shared';
import { readLiveSyncRuns, syncLiveSource, type LiveCatalog } from '../services/live-source';
import { MultiSelect } from './filter-pane';

export function LiveAdmin({ source, onChange, onSynced, onSyncing, disabled, zone, catalog }: {
  source: DataSource; onChange: (source: DataSource) => void; onSynced: () => Promise<void>;
  disabled: boolean; zone: string;
  catalog: LiveCatalog;
  onSyncing: (syncing: boolean) => void;
}) {
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [capacityId, setCapacityId] = useState('');
  const workspaces = catalog.workspaces.filter((workspace) => !capacityId || workspace.capacityId === capacityId);
  const capacities = new Map(catalog.capacities.map((capacity) => [capacity.id, capacity.displayName]));
  for (const workspace of catalog.workspaces) if (workspace.capacityId && !capacities.has(workspace.capacityId)) {
    capacities.set(workspace.capacityId, `${workspace.capacityId} (metadata unavailable)`);
  }
  const [history, setHistory] = useState<Awaited<ReturnType<typeof readLiveSyncRuns>>>([]);
  const [loading, setLoading] = useState(source === 'live');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (source !== 'live') return;
    let active = true;
    void readLiveSyncRuns().then((runs) => {
      if (!active) return;
      setHistory(runs);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [source, attempt]);

  async function sync() {
    setSyncing(true); onSyncing(true); setError('');
    try {
      const chosen = workspaces.filter((workspace) => !workspaceIds.length || workspaceIds.includes(workspace.id));
      const result = await syncLiveSource(chosen.map((workspace) => workspace.id));
      if (result.status !== 'Succeeded') setError(result.message);
      setHistory(await readLiveSyncRuns());
      await onSynced();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setSyncing(false); onSyncing(false); }
  }

  return <section className="admin-status" aria-label="Source settings">
    <h3>Data source</h3>
    <label>Data source<select value={source} disabled={disabled || syncing} onChange={(event) => {
      if (event.target.value === 'sample' || event.target.value === 'live') onChange(event.target.value);
    }}><option value="sample">Demo</option><option value="live">Live</option></select></label>
    {source === 'live' && <>
      <p>Owner-only pilot. Sources use the app owner's access, not each viewer's access. All accessible workspaces are included by default, including those outside listed capacities. Semantic models and Gen1 dataflows require the optional collector. Monthly schedules are reported as unsupported.</p>
      {loading && <p role="status">Reading source workspace and sync history…</p>}
      <p>{catalog.capacities.length} capacities · {catalog.workspaces.length} accessible workspaces</p>
      <label>Source capacity<select value={capacityId} disabled={disabled || syncing} onChange={(event) => {
        setCapacityId(event.target.value); setWorkspaceIds([]);
      }}><option value="">All capacities</option>
        {[...capacities].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <MultiSelect label="Source workspaces" selected={workspaceIds}
        options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.displayName }))}
        onChange={setWorkspaceIds} disabled={disabled || loading || syncing} />
      <Button disabled={disabled || loading || syncing || !workspaces.length} onClick={() => void sync()}>{syncing ? 'Syncing…' : 'Sync now'}</Button>
      {error && <div role="alert" className="error-banner">{error}<Button size="small" onClick={() => {
        setLoading(true); setError(''); setAttempt((value) => value + 1);
      }}>Retry source lookup</Button></div>}
      <h3>Recent syncs</h3>
      {!history.length && !loading && <p>No syncs recorded.</p>}
      <ul className="run-history">{history.map((run) => <li key={run.id}>
        <strong>{run.status}</strong> · {DateTime.fromJSDate(run.startedAt, { zone }).toFormat('LLL dd, yyyy HH:mm:ss')}
        <p>{run.itemsSynced} items · {run.runsSynced} runs</p><p>{run.message}</p>
      </li>)}</ul>
    </>}
  </section>;
}
