import { useId, useState } from 'react';
import { Button, Dropdown, Option } from '@fluentui/react-components';
import { PanelLeftClose } from 'lucide-react';
import { criticalities, itemTypes, runStatuses, type SavedViewRecord, type ScheduledItemRecord } from '@rayfin-app/shared';
import { EMPTY_FILTERS, parseFilters, type ScheduleFilters } from '../domain/filters';
import { deleteView, saveView } from '../services/schedule-data';
import { sampleCapacities, sampleWorkspaceCapacity } from '../sample/capacities';

export function MultiSelect({ label, selected, options, onChange, disabled = false }: {
  label: string; selected: string[]; options: readonly { value: string; label: string }[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return <div className="filter-field">
    <label id={id}>{label}</label>
    <Dropdown aria-labelledby={id} multiselect disabled={disabled} selectedOptions={selected} placeholder="All"
      value={selected.length ? selected.map((value) => options.find((option) => option.value === value)?.label ?? value).join(', ') : ''}
      onOptionSelect={(_, data) => onChange(data.selectedOptions)}>
      {options.map((option) => <Option key={option.value} value={option.value}>{option.label}</Option>)}
    </Dropdown>
    {selected.length > 0 && <Button size="small" appearance="subtle" className="filter-clear" aria-label={`Clear ${label}`} onClick={() => onChange([])}>Clear</Button>}
  </div>;
}

export function FilterPane({ filters, onChange, items, views, onSaved, onError, disabled, onClose, capacities = sampleCapacities }: {
  filters: ScheduleFilters; onChange: (filters: ScheduleFilters) => void;
  items: readonly ScheduledItemRecord[]; views: readonly SavedViewRecord[];
  onSaved: () => Promise<void>; onError: (message: string) => void; disabled: boolean;
  onClose?: () => void;
  capacities?: readonly { id: string; name: string }[];
}) {
  const [name, setName] = useState('');
  const [viewId, setViewId] = useState('');
  const [busy, setBusy] = useState(false);
  const patch = (value: Partial<ScheduleFilters>) => onChange({ ...filters, ...value });
  const capacityItems = items.filter((item) => !filters.capacity
    || (item.source === 'sample' ? sampleWorkspaceCapacity(item.workspaceId) : item.capacityId) === filters.capacity);
  const workspaces = [...new Map(capacityItems.map((item) => [item.workspaceId, item.workspaceName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const owners = [...new Set(capacityItems.flatMap((item) => item.owner ? [item.owner] : []))].sort();
  async function mutate(remove: boolean) {
    setBusy(true);
    try {
      if (remove) { await deleteView(viewId); setViewId(''); }
      else { await saveView(name.trim(), JSON.stringify(filters)); setName(''); }
      await onSaved();
    } catch (failure) { onError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <aside className="filter-pane" aria-label="Shared filters">
    <div className="section-heading"><h2>Filters</h2><div className="button-row">
      <Button size="small" appearance="subtle" onClick={() => { onChange({ ...EMPTY_FILTERS }); setViewId(''); }}>Reset</Button>
      {onClose && <Button size="small" appearance="subtle" icon={<PanelLeftClose size={18} />} aria-label="Hide filters"
        title="Hide filters" aria-expanded={true} aria-controls="shared-filter-drawer" onClick={onClose} />}
    </div></div>
    <p className="secondary-text">Shared across data views. Slot finder uses its own weekday and time controls.</p>
    <MultiSelect label="Item types" selected={filters.types} options={itemTypes.map((type) => ({ value: type, label: type }))} onChange={(types) => patch({ types })} />
    <label>Capacity<select value={filters.capacity} onChange={(event) => patch({ capacity: event.target.value, workspace: [], owner: [] })}>
      <option value="">All capacities</option>{capacities.map((capacity) => <option key={capacity.id} value={capacity.id}>{capacity.name}</option>)}
    </select></label>
    <MultiSelect label="Workspace" selected={filters.workspace} options={workspaces.map(([value, label]) => ({ value, label }))} onChange={(workspace) => patch({ workspace })} />
    <MultiSelect label="Owner" selected={filters.owner} options={owners.map((owner) => ({ value: owner, label: owner }))} onChange={(owner) => patch({ owner })} />
    <MultiSelect label="Last status" selected={filters.status} options={runStatuses.map((status) => ({ value: status, label: status }))} onChange={(status) => patch({ status })} />
    <MultiSelect label="Day of week" selected={filters.weekday} options={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, index) =>
      ({ value: String(index + 1), label }))} onChange={(weekday) => patch({ weekday })} />
    <div className="time-pair">
      <label>From<input type="time" value={filters.start} onChange={(event) => patch({ start: event.target.value || '00:00' })} /></label>
      <label>Through<input type="time" value={filters.end} onChange={(event) => patch({ end: event.target.value || '23:59' })} /></label>
    </div>
    <MultiSelect label="Criticality" selected={filters.criticality} options={criticalities.map((criticality) => ({ value: criticality, label: criticality }))} onChange={(criticality) => patch({ criticality })} />
    <div className="saved-views">
      <h3>Saved views</h3>
      <label>Choose a view<select value={viewId} disabled={disabled || busy} onChange={(event) => {
        setViewId(event.target.value);
        const view = views.find((row) => row.id === event.target.value);
        if (view) { try { onChange(parseFilters(view.filtersJson)); } catch (failure) { onError(String(failure)); } }
      }}><option value="">Select saved view</option>{views.map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select></label>
      <label>View name<input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Morning semantic models" /></label>
      <div className="button-row"><Button size="small" disabled={!name.trim() || busy || disabled} onClick={() => void mutate(false)}>Save view</Button>
        <Button size="small" disabled={!viewId || busy || disabled} onClick={() => void mutate(true)}>Delete view</Button></div>
    </div>
  </aside>;
}
