import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expandOccurrences } from '../domain';
import { generateSampleData, SAMPLE_DATE } from '../sample/data';
import { ScheduleList } from './schedule-list';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => string }) => ({
    getTotalSize: () => count * 50,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index, key: getItemKey(index), size: 50, start: index * 50,
    })),
  }),
}));

function setup(busy = false) {
  const sample = generateSampleData();
  const items = busy ? sample.items.slice(0, 130) : [
    { ...sample.items[0], itemName: 'Failed refresh', failures7d: 3, runs7d: 20, lastStatus: 'Failed' as const },
    { ...sample.items[1], itemName: 'Recovered refresh', failures7d: 1, runs7d: 5, lastStatus: 'Completed' as const, scheduleTimes: '07:00' },
  ];
  const onSelect = vi.fn();
  render(<ScheduleList occurrences={expandOccurrences(items, SAMPLE_DATE)}
    items={new Map(items.map((item) => [item.itemKey, item]))} annotations={new Map()}
    zone="America/New_York" onSelect={onSelect} />);
  return { onSelect, items };
}

describe('schedule list', () => {
  it('shows the shared item-type legend on stripe hover without opening the failed item', async () => {
    const { onSelect } = setup();
    const stripe = screen.getAllByRole('img', { name: 'SemanticModel color stripe; item type legend' })[0];
    expect(stripe).toHaveStyle({ backgroundColor: 'var(--color-type-semantic-model)' });
    fireEvent.pointerEnter(stripe, { pointerType: 'mouse' });
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('SemanticModel (this row)');
    expect(tooltip).toHaveTextContent('CopyJob');
    fireEvent.click(stripe);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Failed refresh/ })).toHaveClass('item-row-failed');
  });

  it('collapses only the selected hour and restores item selection when expanded', () => {
    const { onSelect, items } = setup();
    const hour = screen.getByRole('button', { name: /Mon, Nov 16 · 06:00/ });
    expect(hour).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hour);
    expect(hour).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Failed refresh/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Recovered refresh/ })).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(hour);
    fireEvent.click(screen.getByRole('button', { name: /Failed refresh/ }));
    expect(onSelect).toHaveBeenCalledWith(items[0].itemKey);
  });

  it('explains history ratios and business priority in clickable info boxes', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'About 7d failures' }));
    expect(screen.getByText(/3 of 20 runs failed \(15%\)/)).toBeVisible();
    expect(screen.getByText(/0 \/ 0 means no recorded runs/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'About Criticality' }));
    expect(screen.getByText(/business priority, not run health/)).toBeVisible();
    expect(screen.getByText(/Executive: high-priority reporting/)).toBeVisible();
  });

  it('emphasizes historical failures and highlights failed rows without boxing the status', () => {
    setup();
    expect(screen.getByLabelText('3 failed runs out of 20 total runs in the stored history week')).toHaveClass('failure-metric');
    expect(screen.getByLabelText('3 failed runs out of 20 total runs in the stored history week')).toHaveClass('failure-metric-neutral');
    expect(screen.getByLabelText('1 failed runs out of 5 total runs in the stored history week')).toHaveClass('failure-metric');
    expect(screen.getByLabelText('1 failed runs out of 5 total runs in the stored history week')).not.toHaveClass('failure-metric-neutral');
    expect(screen.getByText('Failed', { exact: true })).not.toHaveClass('failure-badge');
    expect(screen.getByRole('button', { name: /Failed refresh/ })).toHaveClass('item-row-failed');
    expect(screen.getByRole('button', { name: /Recovered refresh/ })).not.toHaveClass('item-row-failed');
  });

  it('collapses all groups from a partially collapsed state and expands them all again', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Mon, Nov 16 · 06:00/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('button', { name: /Failed refresh|Recovered refresh/ })).toBeNull();
    for (const hour of screen.getAllByRole('button', { name: /Mon, Nov 16/ })) {
      expect(hour).toHaveAttribute('aria-expanded', 'false');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('button', { name: /Failed refresh|Recovered refresh/ })).toHaveLength(2);
    for (const hour of screen.getAllByRole('button', { name: /Mon, Nov 16/ })) {
      expect(hour).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it.each([
    ['Item / Type', /Each row is one scheduled occurrence/],
    ['Workspace / Owner', /Unassigned means no owner/],
    ['Scheduled', /This is not an observed run start/],
    ['Avg / Median', /less affected by unusually long runs/],
    ['Last status', /not the outcome of this future occurrence/],
  ])('explains the %s column', (label, explanation) => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: `About ${label}` }));
    expect(screen.getByText(explanation)).toBeVisible();
  });

  it('identifies busy-hour shading as scheduled starts rather than concurrent runs', () => {
    setup(true);
    const hour = screen.getByRole('button', { name: /Mon, Nov 16 · 06:00/ });
    expect(hour).toHaveClass('hour-hot');
    expect(hour).toHaveTextContent('Busy hour · 130 scheduled starts');
    expect(screen.getByText(/not necessarily concurrent runs/)).toBeVisible();
    expect(screen.getByText(/It does not adjust to capacity size/)).toBeVisible();
  });
});
