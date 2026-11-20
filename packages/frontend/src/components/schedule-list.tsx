import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { ChevronDown, ChevronRight, CircleAlert, Info } from 'lucide-react';
import { DateTime } from 'luxon';
import type { ItemAnnotationRecord, ScheduledItemRecord } from '@rayfin-app/shared';
import type { Occurrence } from '../domain';
import { formatDuration } from '../domain/format';
import { ItemTypeStripe } from './item-type-stripe';

const columnHelp = [
  { label: 'Item / Type', paragraphs: ['The scheduled item name and Fabric workload type, such as SemanticModel, DataflowGen2, or Notebook. Each row is one scheduled occurrence; an item can appear more than once. Open a row for details, recent runs, and annotations.'] },
  { label: 'Workspace / Owner', paragraphs: ['The workspace containing the item and its recorded owner. Unassigned means no owner is recorded.'] },
  { label: 'Scheduled', paragraphs: ['The projected start in the selected display time zone, converted from the item schedule. Date/hour headings group these starts. This is not an observed run start. No history · 5m means the projected duration defaults to five minutes.'] },
  { label: 'Avg / Median', paragraphs: ['Average and median run durations, in minutes (m). Average is the arithmetic mean; median is the middle duration and is less affected by unusually long runs. No history means that statistic is unavailable. The Duration selector chooses which statistic projects end times; both statistics remain visible here.'] },
  { label: 'Last status', paragraphs: ['The most recently recorded run outcome for this item, not the outcome of this future occurrence. Failed highlights the entire row red. Completed means the latest recorded run succeeded, even if earlier runs failed. InProgress means that recorded run was still running; Unknown means no known status.'] },
  { label: '7d failures', paragraphs: [
    'Failed runs / total runs for this item in its stored seven-day history. For example, 3 / 20 means 3 of 20 runs failed (15%).',
    'Nonzero failures use red text unless the last status is Failed, when the red row background provides the emphasis instead. 0 / 0 means no recorded runs, not a 0% failure rate. The selected schedule date does not change this history window.',
  ] },
  { label: 'Criticality', paragraphs: [
    'An app annotation describing business priority, not run health or a Fabric capacity setting.',
    'Executive: high-priority reporting. Standard: normal priority, also the default when no annotation exists. Flexible: a candidate for discussing a less congested time.',
    'Open an item to edit its criticality and notes. This never changes its Fabric schedule.',
  ] },
];

export function ScheduleList({ occurrences, items, annotations, zone, onSelect }: {
  occurrences: readonly Occurrence[];
  items: ReadonlyMap<string, ScheduledItemRecord>;
  annotations: ReadonlyMap<string, ItemAnnotationRecord>;
  zone: string;
  onSelect: (key: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => {
    const groups = new Map<string, { label: string; occurrences: Occurrence[] }>();
    for (const occurrence of occurrences) {
      const time = DateTime.fromMillis(occurrence.startMs, { zone });
      const key = `${zone}:${time.startOf('hour').toMillis()}`;
      const group = groups.get(key) ?? { label: time.toFormat('ccc, LLL dd · HH:00'), occurrences: [] };
      group.occurrences.push(occurrence); groups.set(key, group);
    }
    return [...groups].flatMap(([key, group]) => [
      { kind: 'hour' as const, key, label: group.label, count: group.occurrences.length },
      ...(collapsed.has(key) ? [] : group.occurrences.map((occurrence) => ({ kind: 'item' as const, key: occurrence.id, occurrence }))),
    ]);
  }, [occurrences, zone, collapsed]);
  const hourKeys = rows.filter((row) => row.kind === 'hour').map((row) => row.key);
  const allCollapsed = hourKeys.length > 0 && hourKeys.every((key) => collapsed.has(key));
  // React Virtual owns scrolling state; do not memoize its returned instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 50,
    getItemKey: (index) => rows[index].key, overscan: 10,
  });
  return (
    <div className="schedule-table">
      <div className="view-toolbar schedule-toolbar">
        <p className="schedule-help">Select a date/hour heading to collapse or expand its items.</p>
        <Button size="small" disabled={hourKeys.length === 0} onClick={() => setCollapsed((previous) => {
          const next = new Set(previous);
          for (const key of hourKeys) {
            if (allCollapsed) next.delete(key); else next.add(key);
          }
          return next;
        })}>{allCollapsed ? 'Expand all' : 'Collapse all'}</Button>
      </div>
      <p className="schedule-help">Busy-hour shading uses a fixed demo threshold of 100+ scheduled starts per hour after filters. It flags clustered starts, not necessarily concurrent runs, capacity utilization, or a capacity breach. It does not adjust to capacity size. Use Timeline for projected overlap and the semantic-model reference limit.</p>
      <div className="schedule-columns table-head" role="row">
        {columnHelp.map(({ label, paragraphs }) => <span key={label} role="columnheader" className="metric-heading">{label}
          <Popover positioning="below-end">
            <PopoverTrigger disableButtonEnhancement><Button size="small" appearance="subtle" icon={<Info size={15} />} aria-label={`About ${label}`} /></PopoverTrigger>
            <PopoverSurface className="schedule-info" aria-label={`${label} explanation`}>
              <h3>{label}</h3>
              {paragraphs.map((text) => <p key={text}>{text}</p>)}
            </PopoverSurface>
          </Popover>
        </span>)}
      </div>
      <div className="schedule-scroll" ref={scroll} role="table" aria-label="Scheduled occurrences">
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((row) => {
            const data = rows[row.index];
            return <div key={row.key} className="virtual-row" style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
              {data.kind === 'hour'
                ? <button type="button" className={`hour-group ${data.count >= 100 ? 'hour-hot' : ''}`}
                  aria-expanded={!collapsed.has(data.key)} onClick={() => setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(data.key)) next.delete(data.key); else next.add(data.key);
                    return next;
                  })}>
                  {collapsed.has(data.key) ? <ChevronRight size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                  <strong>{data.label}</strong><span>{data.count >= 100 ? 'Busy hour · ' : ''}{data.count} scheduled starts</span>
                </button>
                : (() => {
                  const occurrence = data.occurrence;
                  const item = items.get(occurrence.itemKey)!;
                  return <button className={`schedule-columns item-row${item.lastStatus === 'Failed' ? ' item-row-failed' : ''}`} onClick={() => onSelect(item.itemKey)}>
                    <ItemTypeStripe type={item.itemType} />
                    <span><strong>{item.itemName}</strong><small>{item.itemType}</small></span>
                    <span>{item.workspaceName}<small>{item.owner ?? 'Unassigned'}</small></span>
                    <span>{DateTime.fromMillis(occurrence.startMs, { zone }).toFormat('HH:mm')}<small>{occurrence.noHistory ? 'No history · 5m' : zone}</small></span>
                    <span>{formatDuration(item.avgDurationSec)} / {formatDuration(item.medianDurationSec)}</span>
                    <span>{item.lastStatus ?? 'Unknown'}</span>
                    <span><span className={item.failures7d > 0 ? `failure-metric${item.lastStatus === 'Failed' ? ' failure-metric-neutral' : ''}` : 'failure-zero'}
                      aria-label={`${item.failures7d} failed runs out of ${item.runs7d} total runs in the stored history week`}>
                      {item.failures7d > 0 && <CircleAlert size={14} aria-hidden />}{item.failures7d} / {item.runs7d}
                    </span></span>
                    <span>{annotations.get(item.itemKey)?.criticality ?? 'Standard'}</span>
                  </button>;
                })()}
            </div>;
          })}
        </div>
        {rows.length === 0 && <p className="empty-message">No occurrences match these filters.</p>}
      </div>
    </div>
  );
}
