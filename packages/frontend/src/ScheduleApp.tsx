import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Popover, PopoverSurface, PopoverTrigger, ProgressBar, Tab, TabList } from '@fluentui/react-components';
import { DateTime } from 'luxon';
import { Activity, CalendarClock, Info, PanelLeftOpen, RefreshCw, ShieldCheck } from 'lucide-react';
import { computeConcurrency, displayDayWindow, expandOccurrences, overlapping, type DurationMetric } from './domain';
import { EMPTY_FILTERS, filterItems, filterOccurrences } from './domain/filters';
import { FilterPane } from './components/filter-pane';
import { ItemDetail } from './components/item-detail';
import { ScheduleList } from './components/schedule-list';
import { ItemTypeStripe } from './components/item-type-stripe';
import { formatDuration } from './domain/format';
import { SlotFinder } from './components/slot-finder';
import { clearSampleData, loadSampleData, readScheduleData, type ScheduleSnapshot } from './services/schedule-data';
import { SAMPLE_DATE, simulateRunningNow } from './sample/data';
import { capacityReference, semanticModelLimits, type SampleCapacitySku } from './sample/capacity';
import { sampleCapacities } from './sample/capacities';
import { useTheme } from './hooks/theme.context';
import type { DataSource } from '@rayfin-app/shared';
import { LiveAdmin } from './components/live-admin';
import { listLiveWorkspaces, pollLiveRunning, type LiveCatalog, type LiveRunningOccurrence } from './services/live-source';

const Timeline = lazy(() => import('./components/timeline').then((module) => ({ default: module.Timeline })));
const tabs = ['Schedule', 'Timeline', 'Running now', 'Slot finder', 'Admin'];
const initialData: ScheduleSnapshot = { items: [], runs: [], annotations: [], views: [] };
const displayTimeZones = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)' },
  { value: 'America/Phoenix', label: 'Arizona Time (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (no DST)' },
  { value: 'America/Halifax', label: 'Atlantic Time (Canada)' },
  { value: 'America/St_Johns', label: 'Newfoundland Time' },
  { value: 'Europe/London', label: 'UK Time' },
  { value: 'Europe/Paris', label: 'Central European Time' },
  { value: 'Europe/Helsinki', label: 'Eastern European Time (EU)' },
  { value: 'Asia/Kolkata', label: 'India Standard Time' },
  { value: 'Asia/Shanghai', label: 'China Standard Time' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time' },
  { value: 'Australia/Perth', label: 'Australian Western Time' },
  { value: 'Australia/Brisbane', label: 'Queensland Time (no DST)' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time (with DST)' },
  { value: 'Pacific/Auckland', label: 'New Zealand Time' },
];
const runningColumnHelp = [
  { label: 'Item / Workspace', text: 'The item currently executing, its Fabric workload type, and its workspace. Select the item for details and annotations.' },
  { label: 'Started / Scheduled', text: 'Started is the execution start; Scheduled is the planned start. Times use the selected display time zone. This tab uses the current-time snapshot shown under As of, not the selected schedule date. Shared day/time filters apply to execution starts.' },
  { label: 'Elapsed / Expected', text: 'Elapsed is time spent running as of the snapshot. Expected is the item’s average duration, falling back to its median or five minutes when history is unavailable. For example, 12m / 6m means the run has taken twice its expected duration. Refresh updates the snapshot; auto-refresh repeats every 60 seconds.' },
  { label: 'Duration status', text: 'Running longer than expected means elapsed time exceeds 150% of the expected duration. At exactly 150%, it is not flagged. This is an investigation signal, not a failure or proof of capacity pressure. In progress means the threshold has not been exceeded.' },
];

function SummaryHeading({ label, help }: { label: string; help: string }) {
  return <span className="metric-heading">{label}<Popover positioning="below-end">
    <PopoverTrigger disableButtonEnhancement><Button size="small" appearance="subtle" icon={<Info size={15} />} aria-label={`About ${label}`} /></PopoverTrigger>
    <PopoverSurface className="schedule-info" aria-label={`${label} explanation`}><h3>{label}</h3><p>{help}</p></PopoverSurface>
  </Popover></span>;
}

export function ScheduleApp() {
  const { isDark, toggleTheme } = useTheme();
  const [data, setData] = useState(initialData);
  const [date, setDate] = useState(SAMPLE_DATE);
  const [zone, setZone] = useState('America/New_York');
  const [tab, setTab] = useState('Schedule');
  const [source, setSource] = useState<DataSource>('sample');
  const [liveCatalog, setLiveCatalog] = useState<LiveCatalog>({ workspaces: [], capacities: [] });
  const [liveRunning, setLiveRunning] = useState<LiveRunningOccurrence[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [metric, setMetric] = useState<DurationMetric>('average');
  const capacities = source === 'live' ? liveCatalog.capacities : sampleCapacities;
  const capacityScope = JSON.stringify([source, filters.capacity, capacities]);
  const [capacityOverride, setCapacityOverride] = useState<{ scope: string; sku: SampleCapacitySku } | null>(null);
  const capacitySku = capacityOverride?.scope === capacityScope ? capacityOverride.sku : undefined;
  const reference = capacitySku ? { label: capacitySku, limit: semanticModelLimits[capacitySku] }
    : capacityReference(capacities, filters.capacity);
  const semanticLimit = reference.limit;
  const [slice, setSlice] = useState<number | null>(null);
  const [selected, setSelected] = useState('');
  const [auto, setAuto] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now);
  const [sequence, setSequence] = useState(0);
  const [updated, setUpdated] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const snapshot = await readScheduleData();
    if (source === 'live') {
      const catalog = await listLiveWorkspaces();
      const accessible = new Set(catalog.workspaces.map((workspace) => workspace.id));
      const runs = await pollLiveRunning(snapshot.items.filter((item) => item.source === 'live' && accessible.has(item.workspaceId)));
      if (!mounted.current) return;
      setLiveCatalog(catalog); setLiveRunning(runs);
    }
    if (!mounted.current) return;
    setData(snapshot); setNowMs(Date.now()); setSequence((value) => value + 1); setUpdated(Date.now());
  }, [source]);
  const performRefresh = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await refresh(); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setLoading(false); } }
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    void performRefresh();
    return () => { mounted.current = false; };
  }, [performRefresh]);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void performRefresh(), 60_000);
    return () => clearInterval(timer);
  }, [auto, performRefresh]);

  const sourceItems = useMemo(() => data.items.filter((item) => item.source === source
    && (source !== 'live' || liveCatalog.workspaces.some((workspace) => workspace.id === item.workspaceId))), [data.items, source, liveCatalog]);
  const liveCapacities = useMemo(() => {
    const capacities = new Map(liveCatalog.capacities.map((capacity) => [capacity.id, { id: capacity.id, name: capacity.displayName }]));
    for (const workspace of liveCatalog.workspaces) if (workspace.capacityId && !capacities.has(workspace.capacityId)) {
      capacities.set(workspace.capacityId, { id: workspace.capacityId, name: `${workspace.capacityId} (capacity metadata unavailable)` });
    }
    return [...capacities.values()];
  }, [liveCatalog]);
  const itemMap = useMemo(() => new Map(sourceItems.map((item) => [item.itemKey, item])), [sourceItems]);
  const annotationMap = useMemo(() => new Map(data.annotations.map((row) => [row.itemKey, row])), [data.annotations]);
  const items = useMemo(() => filterItems(sourceItems, annotationMap, filters), [sourceItems, annotationMap, filters]);
  const historyRange = useMemo(() => {
    const keys = new Set(items.map((item) => item.itemKey));
    const starts = data.runs.filter((run) => run.source === source && keys.has(run.itemKey))
      .map((run) => run.startUtc.getTime());
    if (!starts.length) return 'No recorded history';
    const format = (time: number) => DateTime.fromMillis(time, { zone }).toFormat('LLL d, yyyy');
    return `${format(Math.min(...starts))} – ${format(Math.max(...starts))}`;
  }, [items, data.runs, zone, source]);
  const window = useMemo(() => displayDayWindow(date, zone), [date, zone]);
  const expanded = useMemo(() => {
    try { return { occurrences: expandOccurrences(sourceItems, date, zone, metric), error: '' }; }
    catch (failure) { return { occurrences: [], error: failure instanceof Error ? failure.message : String(failure) }; }
  }, [sourceItems, date, zone, metric]);
  const occurrences = useMemo(() => {
    const keys = new Set(items.map((item) => item.itemKey));
    return filterOccurrences(expanded.occurrences.filter((item) => keys.has(item.itemKey)), filters, zone);
  }, [items, expanded, filters, zone]);
  const visible = useMemo(() => slice == null ? occurrences : overlapping(occurrences, slice, slice + 300_000), [occurrences, slice]);
  const simulated = useMemo(() => {
    try { return { runs: source === 'sample' ? simulateRunningNow(sourceItems, nowMs, sequence) : liveRunning, error: '' }; }
    catch (failure) { return { runs: [], error: failure instanceof Error ? failure.message : String(failure) }; }
  }, [sourceItems, source, nowMs, sequence, liveRunning]);
  const running = useMemo(() => {
    const keys = new Set(items.map((item) => item.itemKey));
    return filterOccurrences(simulated.runs.filter((run) => keys.has(run.itemKey)), filters, zone);
  }, [simulated, items, filters, zone]);
  const overlay = useMemo(() => overlapping(running, window.startMs, window.endMs), [running, window]);
  const modelPeak = useMemo(() => Math.max(0, ...computeConcurrency(
    occurrences.filter((item) => item.itemType === 'SemanticModel'), 5, window,
  ).map((entry) => entry.projected.total)), [occurrences, window]);
  const changeFilters = useCallback((value: typeof filters) => {
    if (value.capacity !== filters.capacity) setCapacityOverride(null);
    setFilters(value); setSlice(null);
  }, [filters.capacity]);
  const selectItem = useCallback((key: string) => setSelected(key), []);
  const selectedItem = itemMap.get(selected);
  async function manageSample(clear: boolean) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const report = (done: number, total: number) => setProgress({ done, total });
      if (clear) await clearSampleData(report); else await loadSampleData(report);
      await refresh(); setConfirmClear(false);
      setNotice(clear ? 'Demo data cleared. Saved views and other metadata were preserved.' : 'Demo data loaded and persisted. Open Schedule or Timeline to explore.');
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : String(failure)} Partial work may have completed. Refresh to inspect; loading again safely resumes missing rows.`);
    } finally { locked.current = false; setBusy(false); setProgress(null); }
  }
  return <main className="scheduler-app">
    <header className="app-header">
      <div className="app-brand"><CalendarClock aria-hidden className="brand-icon" /><div>
        <p className="eyebrow">FABRIC / CAPACITY OPERATIONS</p><h1>Fabric Schedule Visibility</h1>
      </div></div>
      <div className="header-actions"><span className="badge sample-badge">{source === 'sample' ? 'Sample' : 'Live'}</span>
        <Button onClick={toggleTheme}>{isDark ? 'Use light theme' : 'Use dark theme'}</Button></div>
    </header>
    <div className={`workspace-layout${filtersOpen ? '' : ' filters-collapsed'}`}>
      <div id="shared-filter-drawer" className="filter-drawer" hidden={!filtersOpen}>
        <FilterPane key={source} filters={filters} onChange={changeFilters} items={sourceItems} views={data.views}
          capacities={source === 'live' ? liveCapacities : undefined}
          onSaved={refresh} onError={setError} disabled={busy || loading} onClose={() => setFiltersOpen(false)} />
      </div>
      {!filtersOpen && <div className="filter-rail">
        <Button appearance="subtle" icon={<PanelLeftOpen size={20} />} aria-label="Show filters"
          title="Show filters" aria-expanded={false} aria-controls="shared-filter-drawer" onClick={() => setFiltersOpen(true)} />
      </div>}
    <div className="command-bar">
      <label>Schedule date<input aria-label="Schedule date" type="date" value={date} onChange={(event) => {
        if (event.target.value) { setDate(event.target.value); setSlice(null); }
      }} /></label>
      <Button onClick={() => { setDate(DateTime.now().setZone(zone).toISODate()!); setSlice(null); }}>Today</Button>
      <label>Display time zone<select aria-label="Display time zone" value={zone} onChange={(event) => {
        setZone(event.target.value); setSlice(null);
      }}>{displayTimeZones.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button disabled={busy} onClick={() => void performRefresh()} icon={<RefreshCw size={16} />}>Refresh</Button>
      <label className="check-label"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />Auto-refresh (60s)</label>
      <span className="last-updated">Last updated {updated ? DateTime.fromMillis(updated, { zone }).toFormat('HH:mm:ss') : '—'}</span>
    </div>
      <div className="main-panel">
        <div className="safety-note"><ShieldCheck size={16} /><span>Read-only toward Fabric workloads. Only app-owned metadata can be edited. No patient data.</span></div>
        {(error || expanded.error || simulated.error) && <div role="alert" className="error-banner">{error || expanded.error || simulated.error}<Button size="small" onClick={() => void performRefresh()}>Retry</Button></div>}
        {notice && <p role="status" className="success-banner">{notice}</p>}
        <div className="metrics-strip">
          <article><SummaryHeading label="Scheduled occurrences" help="Planned schedule starts on the selected date in the display time zone, after shared filters. A repeating item can contribute multiple occurrences. The item count includes all items matching the item filters, even if they have no start on this date." /><strong>{occurrences.length}</strong><small>{items.length} items after filters</small></article>
          <article className={semanticLimit != null && modelPeak > semanticLimit ? 'metric-warning' : ''}><SummaryHeading label="Semantic model peak" help={`The highest number of semantic model refreshes projected to run simultaneously on the selected date, after shared filters. Durations use the selected average or median. The denominator follows the selected capacity's published refresh parallelism limit, or the sum of known limits for all capacities, unless overridden on Timeline. Capacities are not pooled; an individual capacity can reach its limit below the combined total. Exceeding the reference highlights this card; it is a reference limit, not measured capacity utilization or available slots.`} /><strong>{modelPeak}<small> / {semanticLimit ?? '—'}</small></strong><small>Projected · {reference.label} reference</small></article>
          <article><SummaryHeading label="Running now" help="Executions active at the latest refresh, independent of the selected schedule date. Shared filters apply to the items and their execution start times. An overrun means elapsed time exceeds 1.5 times the expected duration; it does not mean the job has failed." /><strong>{running.length}</strong><small>{running.filter((run) => run.overrun).length} overruns</small></article>
          <article><SummaryHeading label="7-day failures" help={`Total failed runs in the stored seven-day history for items matching the item filters. Recorded history: ${historyRange}. It does not move with the selected schedule date. Shared weekday and time-of-day filters do not filter these historical totals. This counts failed runs, not distinct items.`} /><strong>{items.reduce((sum, item) => sum + item.failures7d, 0)}</strong><small>{historyRange}</small></article>
        </div>
        <div className="tabs-toolbar"><TabList selectedValue={tab} onTabSelect={(_, value) => setTab(String(value.value))}>
          {tabs.map((name) => <Tab key={name} value={name}>{name}</Tab>)}
        </TabList>
          {['Schedule', 'Timeline'].includes(tab) && <label>Duration<select value={metric} onChange={(event) => setMetric(event.target.value === 'median' ? 'median' : 'average')}>
            <option value="average">Average</option><option value="median">Median</option>
          </select></label>}
        </div>
        <div className="view-panel" role="tabpanel" aria-label={tab}>
          {loading && <p role="status" className="empty-message">Loading authenticated metadata…</p>}
          {!loading && sourceItems.length === 0 && tab !== 'Admin' && <div className="empty-state"><Activity size={40} /><h2>No schedules loaded</h2><p>{source === 'sample' ? 'Load demo data in Admin to explore schedules, concurrency, and running jobs.' : 'No live schedules have been imported from accessible workspaces. Open Admin to sync sources and review skipped items or errors.'}</p><Button appearance="primary" onClick={() => setTab('Admin')}>Open Admin</Button></div>}
          {tab === 'Admin' ? <section>
            <h2>Data administration</h2>
            <LiveAdmin key={source} source={source} onChange={(value) => {
              setSource(value); setFilters({ ...EMPTY_FILTERS }); setCapacityOverride(null); setSlice(null); setSelected('');
              setLiveRunning([]);
              if (value === 'live') setDate(DateTime.now().setZone(zone).toISODate()!);
              setNotice(''); setError(''); setLoading(true);
            }} onSynced={refresh} onSyncing={(value) => { locked.current = value; setBusy(value); }}
              disabled={busy || loading} zone={zone} catalog={liveCatalog} />
            {source === 'sample' && <>
            <p>{sourceItems.length} items across {new Set(sourceItems.map((item) => item.workspaceId)).size} workspaces loaded.</p>
            <p className="secondary-text">Loading uses signed-in client.data calls with at most 10 concurrent writes. Reload resumes without overwriting annotations.</p>
            <div className="admin-actions"><Button appearance="primary" disabled={busy || loading} onClick={() => void manageSample(false)}>Load demo data</Button>
              <label className="check-label"><input type="checkbox" checked={confirmClear} disabled={busy} onChange={(event) => setConfirmClear(event.target.checked)} />Confirm demo-only deletion</label>
              <Button disabled={busy || loading || !confirmClear} onClick={() => void manageSample(true)}>Clear demo data</Button></div>
            {progress && <div className="load-progress" role="status"><p>{progress.done} / {progress.total} rows completed</p><ProgressBar value={progress.total ? progress.done / progress.total : 0} /></div>}
            <div className="admin-status">
              <p>{sourceItems.length} items · {data.runs.filter((run) => run.source === 'sample').length} runs stored.</p>
              <p>Refresh updates the Running now snapshot. Execution starts are at or after their planned schedule times.</p></div>
            </>}
          </section> : sourceItems.length > 0 && !loading && <>
            {tab === 'Schedule' && <ScheduleList occurrences={occurrences} items={itemMap} annotations={annotationMap} zone={zone} onSelect={selectItem} />}
            {tab === 'Timeline' && <Suspense fallback={<p role="status">Loading timeline…</p>}><Timeline
              occurrences={visible} allOccurrences={occurrences} actual={overlay} window={window} zone={zone} nowMs={nowMs}
              items={itemMap} annotations={annotationMap} slice={slice} onSlice={setSlice} onSelect={selectItem}
              capacitySku={capacitySku} automaticReference={capacitySku ? undefined : reference}
              onCapacityChange={(sku) => setCapacityOverride({ scope: capacityScope, sku })}
            /></Suspense>}
            {tab === 'Running now' && <section>
              <div className="view-toolbar"><h2>Running now</h2><span>As of {DateTime.fromMillis(nowMs, { zone }).toFormat('ccc LLL dd HH:mm:ss')}</span></div>
              <p className="secondary-text">Current-time snapshot, independent of the schedule date. Shared filters apply to execution starts. Running longer than expected means elapsed &gt; 1.5× expected duration.</p>
              <div className="running-list"><table className="running-table" aria-label="Running items">
                <thead><tr>{runningColumnHelp.map(({ label, text }) => <th key={label} scope="col">
                  <span className="metric-heading">{label}<Popover positioning="below-end">
                    <PopoverTrigger disableButtonEnhancement><Button size="small" appearance="subtle" icon={<Info size={15} />} aria-label={`About ${label}`} /></PopoverTrigger>
                    <PopoverSurface className="schedule-info" aria-label={`${label} explanation`}><h3>{label}</h3><p>{text}</p></PopoverSurface>
                  </Popover></span>
                </th>)}</tr></thead>
                <tbody>{running.map((run) => <tr className="running-row" key={run.id} onClick={() => selectItem(run.itemKey)}>
                  <td><ItemTypeStripe type={run.itemType} /><button className="running-item-button"><strong>{run.itemName}</strong></button><small>{run.itemType} · {itemMap.get(run.itemKey)?.workspaceName}</small></td>
                  <td>Started {DateTime.fromMillis(run.startMs, { zone }).toFormat('LLL dd HH:mm:ss')}<small>Scheduled {run.scheduledStartMs == null ? 'Not matched to a projected slot' : DateTime.fromMillis(run.scheduledStartMs, { zone }).toFormat('LLL dd HH:mm:ss')}</small></td>
                  <td>{formatDuration((nowMs - run.startMs) / 1000)} / {formatDuration(run.expectedDurationSec)}<small>Elapsed / expected</small></td>
                  <td className={run.overrun ? 'failure-text' : ''}>{run.overrun ? 'Running longer than expected' : 'In progress'}</td>
                </tr>)}</tbody>
              </table></div>
              {running.length === 0 && <p className="empty-message">No running items match these filters.</p>}
            </section>}
            {tab === 'Slot finder' && <SlotFinder items={items} date={date} zone={zone} />}
          </>}
        </div>
        <footer className="app-footer">{reference.label} reference · 5-minute concurrency slices · {zone}</footer>
      </div>
    </div>
    {selectedItem && <ItemDetail key={selectedItem.id} item={selectedItem} annotation={annotationMap.get(selectedItem.itemKey)}
      runs={data.runs} zone={zone} onClose={() => setSelected('')} onSaved={refresh} />}
  </main>;
}
