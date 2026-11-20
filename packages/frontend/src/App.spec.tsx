import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import App from './App';
import { readScheduleData } from './services/schedule-data';
import { generateSampleData } from './sample/data';
import type { Occurrence, TimeWindow } from './domain';
import { listLiveWorkspaces, readLiveSyncRuns, syncLiveSource, pollLiveRunning } from './services/live-source';

vi.mock('./services/schedule-data', () => ({
  readScheduleData: vi.fn(async () => ({ items: [], runs: [], annotations: [], views: [] })),
}));
vi.mock('./services/live-source', () => ({
  listLiveWorkspaces: vi.fn(async () => ({ workspaces: [{ id: 'approved-workspace', displayName: 'POC-Scheduler' }], capacities: [] })),
  readLiveSyncRuns: vi.fn(async () => []),
  syncLiveSource: vi.fn(async () => ({ id: 'sync', status: 'Succeeded', message: 'No schedules or runs imported.', itemsSynced: 0, runsSynced: 0 })),
  pollLiveRunning: vi.fn(async () => []),
}));
vi.mock('./components/timeline', () => ({
  Timeline: ({ actual, window, onSlice, onCapacityChange }: {
    actual: Occurrence[]; window: TimeWindow; onSlice: (start: number) => void;
    onCapacityChange: (sku: 'F64') => void;
  }) => <div><span data-testid="actual-count">{actual.length}</span>
    <button onClick={() => onCapacityChange('F64')}>Use F64</button>
    <button onClick={() => onSlice(window.startMs)}>Select midnight slice</button></div>,
}));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('schedule application', () => {
  it('defaults the reference from the capacity filter and clears manual overrides when the capacity changes', async () => {
    vi.mocked(readScheduleData).mockResolvedValueOnce({
      items: generateSampleData().items, runs: [], annotations: [], views: [],
    });
    render(<App />);
    await screen.findByText('385 items after filters');
    expect(screen.getByText('Projected · 320 CUs (total) reference')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: 'sample-capacity-a' } });
    expect(screen.getByText('Projected · F256 reference')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use F64' }));
    expect(screen.getByText('Projected · F64 reference')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: 'sample-capacity-b' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: 'sample-capacity-a' } });
    expect(screen.getByText('Projected · F256 reference')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '' } });
    expect(screen.getByText('Projected · 320 CUs (total) reference')).toBeVisible();
  });

  it('uses discovered live SKUs instead of retaining the demo reference', async () => {
    vi.mocked(listLiveWorkspaces).mockResolvedValueOnce({
      workspaces: [{ id: 'approved-workspace', displayName: 'POC-Scheduler', capacityId: 'live-a' }],
      capacities: [{ id: 'live-a', displayName: 'Actual capacity', sku: 'F32' },
        { id: 'live-b', displayName: 'Other capacity', sku: 'F64' }],
    });
    render(<App />);
    await screen.findByText('No schedules loaded');
    fireEvent.click(screen.getByRole('tab', { name: 'Admin' }));
    fireEvent.change(screen.getByLabelText('Data source'), { target: { value: 'live' } });
    await screen.findByText('Projected · 96 CUs (total) reference');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: 'live-a' } });
    expect(screen.getByText('Projected · F32 reference')).toBeVisible();
    const card = screen.getByRole('button', { name: 'About Semantic model peak' }).closest('article')!;
    expect(card).toHaveTextContent('/ 20');
  });

  it('keeps the approved empty Live source separate from demo rows and offers explicit sync controls', async () => {
    vi.mocked(readScheduleData).mockResolvedValue({
      items: generateSampleData().items, runs: [], annotations: [], views: [],
    });
    render(<App />);
    await screen.findByText('385 items after filters');
    fireEvent.click(screen.getByRole('tab', { name: 'Admin' }));
    fireEvent.change(screen.getByLabelText('Data source'), { target: { value: 'live' } });
    await waitFor(() => expect(pollLiveRunning).toHaveBeenCalledWith([]));
    await screen.findByText('0 capacities · 1 accessible workspaces');
    expect(screen.getByText('Live', { selector: '.badge' })).toBeVisible();
    expect(screen.getByText('0 items after filters')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load demo data' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Capacity A' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(syncLiveSource).toHaveBeenCalledWith(['approved-workspace']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled());
    fireEvent.click(screen.getByRole('tab', { name: 'Running now' }));
    expect(screen.getByText('No schedules loaded')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Running items' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Admin' }));
    fireEvent.change(screen.getByLabelText('Data source'), { target: { value: 'sample' } });
    await screen.findByText('385 items after filters');
    expect(screen.getByRole('button', { name: 'Load demo data' })).toBeVisible();
    vi.mocked(readScheduleData).mockResolvedValue({ items: [], runs: [], annotations: [], views: [] });
  });

  it('surfaces a failed live sync and reloads its persisted history', async () => {
    vi.mocked(syncLiveSource).mockResolvedValueOnce({
      id: 'failed-sync', status: 'Failed', message: 'Grant workspace Viewer access.', itemsSynced: 0, runsSynced: 0,
    });
    render(<App />);
    await screen.findByText('No schedules loaded');
    fireEvent.click(screen.getByRole('tab', { name: 'Admin' }));
    fireEvent.change(screen.getByLabelText('Data source'), { target: { value: 'live' } });
    await screen.findByText('0 capacities · 1 accessible workspaces');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Grant workspace Viewer access.');
    expect(listLiveWorkspaces).toHaveBeenCalled();
    expect(readLiveSyncRuns).toHaveBeenCalled();
  });

  it('explains all four summary cards without repetitive data-source labels', async () => {
    render(<App />);
    await screen.findByText('No schedules loaded');
    const help = [
      ['Scheduled occurrences', /repeating item can contribute multiple occurrences/],
      ['Semantic model peak', /not measured capacity utilization or available slots/],
      ['Running now', /independent of the selected schedule date/],
      ['7-day failures', /counts failed runs, not distinct items/],
    ] as const;
    for (const [label, explanation] of help) {
      const button = screen.getByRole('button', { name: `About ${label}` });
      expect(button.closest('article')).not.toHaveTextContent(/sample|simulated/i);
      fireEvent.click(button);
      const popover = await screen.findByLabelText(`${label} explanation`);
      expect(within(popover).getByText(explanation)).toBeVisible();
      fireEvent.click(button);
      await waitFor(() => expect(screen.queryByLabelText(`${label} explanation`)).toBeNull());
    }
    expect(screen.getByText('No recorded history')).toBeVisible();
  });

  it('derives history dates and capacity references from data and selections', async () => {
    const data = generateSampleData();
    vi.mocked(readScheduleData).mockResolvedValueOnce({
      items: data.items, annotations: [], views: [],
      runs: [{ ...data.runs[0], startUtc: new Date('2027-02-02T18:00:00Z') }],
    });
    render(<App />);
    await screen.findByText('Feb 2, 2027 – Feb 2, 2027');
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use F64' }));
    expect(screen.getByText('Projected · F64 reference')).toBeVisible();
    expect(screen.queryByText(/F256 reference/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Schedule date'), { target: { value: '2028-04-04' } });
    expect(screen.getByText('Feb 2, 2027 – Feb 2, 2027')).toBeVisible();
    const workspaceId = data.items.find((item) => item.itemKey === data.runs[0].itemKey)!.workspaceId;
    fireEvent.change(screen.getByLabelText('Capacity'), { target: {
      value: Number(workspaceId.split('-').at(-1)) < 6 ? 'sample-capacity-b' : 'sample-capacity-a',
    } });
    expect(screen.getByText('No recorded history')).toBeVisible();
    for (const tab of ['Schedule', 'Running now', 'Slot finder', 'Admin']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      const sourceLabels = document.body.textContent!.match(/sample|simulat\w*/gi);
      expect(sourceLabels).toEqual(['Sample']);
    }
  });

  it('hides and restores the left filter drawer without clearing selections', async () => {
    render(<App />);
    await screen.findByText('No schedules loaded');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: 'sample-capacity-a' } });
    const hide = screen.getByRole('button', { name: 'Hide filters' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hide);
    expect(screen.queryByRole('complementary', { name: 'Shared filters' })).toBeNull();
    expect(screen.getByLabelText('Schedule date')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show filters' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }));
    expect(screen.getByRole('complementary', { name: 'Shared filters' })).toBeVisible();
    expect(screen.getByLabelText('Capacity')).toHaveValue('sample-capacity-a');
  });

  it('selects a display time zone and uses it for Today', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-18T02:00:00Z'));
    render(<App />);
    await screen.findByText('No schedules loaded');
    const zone = screen.getByRole('combobox', { name: 'Display time zone' });
    expect(zone).toHaveValue('America/New_York');
    expect(screen.getByRole('option', { name: 'Eastern Time (US & Canada)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'America/New_York' })).toBeNull();
    fireEvent.change(zone, { target: { value: 'America/Chicago' } });
    expect(zone).toHaveValue('America/Chicago');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByLabelText('Schedule date')).toHaveValue('2026-11-17');
    fireEvent.change(zone, { target: { value: 'UTC' } });
    expect(zone).toHaveValue('UTC');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByLabelText('Schedule date')).toHaveValue('2026-11-18');
    expect(screen.queryByRole('button', { name: 'Monday demo' })).toBeNull();
    expect(zone).toHaveValue('UTC');
  });

  it('shows an honest empty state and opens authenticated Admin instead of inventing data', async () => {
    render(<App />);
    expect(await screen.findByText('No schedules loaded')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Admin' }));
    expect(screen.getByRole('button', { name: 'Load demo data' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear demo data' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Confirm demo-only deletion'));
    expect(screen.getByRole('button', { name: 'Clear demo data' })).toBeEnabled();
  });

  it('surfaces read failures and retries without substituting sample rows', async () => {
    vi.mocked(readScheduleData).mockRejectedValueOnce(new Error('Permission denied'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('No schedules loaded')).toBeVisible();
  });

  it('refreshes at 60 seconds only while auto-refresh is enabled', async () => {
    render(<App />);
    await screen.findByText('No schedules loaded');
    vi.mocked(readScheduleData).mockClear();
    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText('Auto-refresh (60s)'));
    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(readScheduleData).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(readScheduleData).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Auto-refresh (60s)'));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(readScheduleData).toHaveBeenCalledTimes(1);
  });

  it('keeps the full-day actual concurrency context when a Gantt slice is selected', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-17T17:00:00Z'));
    vi.mocked(readScheduleData).mockResolvedValueOnce({
      items: generateSampleData().items, runs: [], annotations: [], views: [],
    });
    render(<App />);
    await screen.findByText('385 items after filters');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    const count = await screen.findByTestId('actual-count');
    const before = count.textContent;
    expect(Number(before)).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Select midnight slice' }));
    expect(count.textContent).toBe(before);
  });

  it('explains running items with aligned column headers and info popovers', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-17T17:00:00Z'));
    vi.mocked(readScheduleData).mockResolvedValueOnce({
      items: generateSampleData().items, runs: [], annotations: [], views: [],
    });
    render(<App />);
    await screen.findByText('385 items after filters');
    fireEvent.click(screen.getByRole('tab', { name: 'Running now' }));
    expect(screen.getByRole('table', { name: 'Running items' })).toBeVisible();
    const stripe = screen.getAllByRole('img', { name: 'CopyJob color stripe; item type legend' })[0];
    fireEvent.focus(stripe);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('CopyJob (this row)');
    fireEvent.click(stripe);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.blur(stripe);
    const help = [
      ['Item / Workspace', /Select the item for details and annotations/],
      ['Started / Scheduled', /not the selected schedule date/],
      ['Elapsed / Expected', /12m \/ 6m means/],
      ['Duration status', /not a failure or proof of capacity pressure/],
    ] as const;
    for (const [label, explanation] of help) {
      expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: `About ${label}` }));
      expect(await screen.findByText(explanation)).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: `About ${label}` }));
    }
    expect(screen.getAllByText('Running longer than expected').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: generateSampleData().items[380].itemName }));
    expect(await screen.findByRole('dialog')).toBeVisible();
  });
});
