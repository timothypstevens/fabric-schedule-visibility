import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { ScheduledItemRecord } from '@rayfin-app/shared';
import { expandOccurrences, findRecurringSlots } from '../domain';

export function SlotFinder({ items, date, zone }: {
  items: readonly ScheduledItemRecord[]; date: string; zone: string;
}) {
  const [duration, setDuration] = useState(10);
  const [start, setStart] = useState('05:00');
  const [end, setEnd] = useState('10:00');
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const result = useMemo(() => {
    try {
      const week = DateTime.fromISO(date, { zone }).startOf('week');
      const days = [...weekdays].sort((a, b) => a - b).map((weekday) => week.plus({ days: weekday - 1 }).toISODate()!);
      const coveredDays = [...new Set(days.flatMap((day) => [
        day, DateTime.fromISO(day, { zone }).plus({ days: 1 }).toISODate()!,
      ]))];
      const occurrences = [...new Map(coveredDays.flatMap((day) => expandOccurrences(items, day, zone))
        .map((row) => [row.id, row])).values()];
      return { slots: findRecurringSlots(occurrences, duration, start, end, days, zone), error: '' };
    } catch (failure) { return { slots: [], error: failure instanceof Error ? failure.message : String(failure) }; }
  }, [items, date, zone, duration, start, end, weekdays]);
  const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return <section>
    <div className="view-toolbar"><h2>Find a quieter window</h2><span className="badge">Suggestions only · never changes a schedule</span></div>
    <p className="secondary-text">Find one recurring time across all checked weekdays. Best options first: lowest peak on the busiest checked weekday, then lowest average daily peak, then earliest time. Counts exclude the proposed job.</p>
    <p className="secondary-text">Uses the selected schedule date's week, starting {DateTime.fromISO(date, { zone }).startOf('week').toFormat('LLL dd, yyyy')} ({zone}). Item filters apply; shared day/time filters do not. This is a projection for that week, not a guarantee for future weeks. Alternative options may overlap.</p>
    <div className="slot-controls">
      <label>Duration (minutes)<input type="number" min={1} max={1440} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
      <label>Window starts<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>Window ends<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    </div>
    <fieldset className="day-picker"><legend>Repeat on ({zone})</legend>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((name, index) => {
      const weekday = index + 1;
      return <label className="check-label" key={name}><input type="checkbox" checked={weekdays.includes(weekday)} onChange={(event) =>
        setWeekdays(event.target.checked ? [...weekdays, weekday] : weekdays.filter((value) => value !== weekday))} />{name}</label>;
    })}</fieldset>
    {result.error && <p className="error-banner" role="alert">{result.error}</p>}
    <div className="slot-results">{result.slots.map((slot, index) => <article className="slot-card" key={slot.minute}>
      <span className="eyebrow">Option {index + 1}</span><h3>{clock(slot.minute)}{slot.minute >= 1440 ? ' (next day)' : ''}</h3>
      <p>For {duration} minutes · Every checked weekday</p>
      <button className="slot-peak-toggle" aria-expanded={expanded.has(slot.minute)} aria-controls={`slot-jobs-${slot.minute}`}
        onClick={() => setExpanded((previous) => {
          const next = new Set(previous);
          if (next.has(slot.minute)) next.delete(slot.minute); else next.add(slot.minute);
          return next;
        })}>{slot.peakConcurrency} concurrent jobs at peak</button>
      <p>Peak on the busiest checked weekday</p>
      <p>Average daily peak: {slot.averagePeak.toFixed(1)}</p>
      {expanded.has(slot.minute) && <div id={`slot-jobs-${slot.minute}`} className="slot-peak-jobs">
        <p>Jobs at each day’s first peak within this window:</p>
        {slot.days.map((day) => <section key={day.date}>
          <h4>{DateTime.fromISO(day.date, { zone }).toFormat('cccc')} · {day.peakConcurrency} at peak</h4>
          {day.peakJobs.length === 0 ? <p>No concurrent jobs.</p> : <ul>{day.peakJobs.map((job) =>
            <li key={job.id}>{job.itemName} · {job.itemType}<small>{DateTime.fromMillis(job.startMs, { zone }).toFormat('ccc HH:mm')}–{DateTime.fromMillis(job.endMs, { zone }).toFormat('ccc HH:mm')}</small></li>)}</ul>}
        </section>)}
      </div>}
    </article>)}</div>
    {!result.error && result.slots.length === 0 && <p className="empty-message">{weekdays.length === 0 ? 'Select at least one weekday.' : 'No common full-duration slots across all selected weekdays in this window.'}</p>}
  </section>;
}
