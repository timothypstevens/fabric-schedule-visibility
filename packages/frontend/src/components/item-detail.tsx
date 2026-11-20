import { useState } from 'react';
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogActions } from '@fluentui/react-components';
import { DateTime } from 'luxon';
import { criticalities, type Criticality, type ItemAnnotationRecord, type RunInstanceRecord, type ScheduledItemRecord } from '@rayfin-app/shared';
import { saveAnnotation } from '../services/schedule-data';
import { formatDuration } from '../domain/format';

export function ItemDetail({ item, annotation, runs, zone, onClose, onSaved }: {
  item: ScheduledItemRecord; annotation?: ItemAnnotationRecord;
  runs: readonly RunInstanceRecord[]; zone: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [criticality, setCriticality] = useState<Criticality>(annotation?.criticality ?? 'Standard');
  const [note, setNote] = useState(annotation?.note ?? '');
  const [owner, setOwner] = useState(annotation?.businessOwner ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const history = runs.filter((run) => run.itemKey === item.itemKey)
    .sort((a, b) => b.startUtc.getTime() - a.startUtc.getTime()).slice(0, 5);
  async function save() {
    setBusy(true); setError('');
    try {
      await saveAnnotation(item.itemKey, { criticality, note, businessOwner: owner }, annotation?.id);
      await onSaved(); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}>
    <DialogSurface className="detail-dialog"><DialogBody>
      <DialogTitle>{item.itemName}</DialogTitle>
      <DialogContent>
        <p>{item.itemType} · {item.workspaceName}</p>
        <p className="secondary-text">{item.owner} · {item.scheduleTimes ?? `Every ${item.intervalMinutes}m`} ({item.timeZoneId})</p>
        <p>Average {formatDuration(item.avgDurationSec)} · Median {formatDuration(item.medianDurationSec)} · P90 {formatDuration(item.p90DurationSec)}</p>
        <p>{item.failures7d} failures / {item.runs7d} runs in the stored history week</p>
        <h3>Last 5 runs</h3>
        {history.length ? <ul className="run-history">{history.map((run) => <li key={run.id}>
          <strong>{DateTime.fromJSDate(run.startUtc, { zone }).toFormat('LLL dd HH:mm')}</strong> · {run.status}
          <span>{run.endUtc ? formatDuration((run.endUtc.getTime() - run.startUtc.getTime()) / 1000) : 'In progress'}</span>
          {run.failureReason && <small className="failure-text">{run.source === 'sample' ? run.failureReason.replace(/^Simulated /i, '') : run.failureReason}</small>}
        </li>)}</ul> : <p>No run history.</p>}
        <h3>Annotation</h3>
        <p className="secondary-text">Edits change this app’s metadata only. They never alter Fabric schedules.</p>
        <label>Criticality<select value={criticality} onChange={(event) => {
          const value = criticalities.find((level) => level === event.target.value);
          if (value) setCriticality(value);
        }}>{criticalities.map((level) => <option key={level}>{level}</option>)}</select></label>
        <label>Business owner<input maxLength={120} value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
        <label>Notes<textarea rows={4} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {error && <p role="alert" className="error-banner">{error}</p>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={onClose}>Cancel</Button><Button appearance="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save annotation'}</Button></DialogActions>
    </DialogBody></DialogSurface>
  </Dialog>;
}
