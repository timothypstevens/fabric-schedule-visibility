import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayDayWindow, expandOccurrences } from '../domain';
import { generateSampleData, SAMPLE_DATE } from '../sample/data';
import type { CapacityReference, SampleCapacitySku } from '../sample/capacity';
import { Timeline } from './timeline';

const charts = vi.hoisted(() => {
  const setOptions = vi.fn();
  return {
    setOptions,
    init: vi.fn(() => ({
      setOption: setOptions, on: vi.fn<(event: string, handler: () => void) => void>(), resize: vi.fn(), dispose: vi.fn(),
      getOption: vi.fn(() => ({ dataZoom: [{ start: 20, end: 40 }] })),
      dispatchAction: vi.fn(),
    })),
  };
});
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: charts.init,
}));

const items = generateSampleData().items.slice(0, 2);
const occurrences = expandOccurrences(items, SAMPLE_DATE);

function Fixture({ automaticReference }: { automaticReference?: CapacityReference } = {}) {
  const [capacitySku, onCapacityChange] = useState<SampleCapacitySku>('F256');
  return <Timeline occurrences={occurrences} allOccurrences={occurrences} actual={[]}
    window={displayDayWindow(SAMPLE_DATE)} zone="America/New_York" nowMs={Date.parse('2026-11-16T11:00:00Z')}
    items={new Map(items.map((item) => [item.itemKey, item]))} annotations={new Map()}
    slice={null} onSlice={() => {}} onSelect={() => {}} capacitySku={capacitySku} automaticReference={automaticReference} onCapacityChange={onCapacityChange} />;
}

beforeEach(() => {
  charts.setOptions.mockClear();
  charts.init.mockClear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('timeline presentation', () => {
  it('displays the combined automatic reference and removes the threshold when no size is known', () => {
    const { rerender } = render(<Fixture automaticReference={{ label: '8 CUs (total)', limit: 4 }} />);
    expect(screen.getByRole('combobox', { name: 'Capacity size' })).toHaveDisplayValue('8 CUs (total)');
    expect(charts.setOptions.mock.calls.at(-2)![0].series[8].markLine.data[0].yAxis).toBe(4);
    rerender(<Fixture automaticReference={{ label: 'Unavailable', limit: null }} />);
    expect(screen.getByRole('combobox', { name: 'Capacity size' })).toHaveDisplayValue('Unavailable');
    expect(charts.setOptions.mock.calls.at(-2)![0].series[8].markLine.data).toEqual([]);
  });

  it('switches chart zoom with three mutually exclusive buttons', () => {
    render(<Fixture />);
    expect(screen.queryByRole('combobox', { name: 'Zoom' })).toBeNull();
    expect(screen.queryByText('Zoom', { exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '4h' }));
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '4h' })).toHaveAttribute('aria-pressed', 'true');
    let options = charts.setOptions.mock.lastCall![0];
    expect(options.dataZoom[0].endValue - options.dataZoom[0].startValue).toBe(4 * 3600_000);
    expect(charts.setOptions.mock.calls.at(-2)![0].dataZoom[0]).toMatchObject({
      startValue: options.dataZoom[0].startValue, endValue: options.dataZoom[0].endValue,
    });
    fireEvent.click(screen.getByRole('button', { name: '1h' }));
    options = charts.setOptions.mock.lastCall![0];
    expect(options.dataZoom[0].endValue - options.dataZoom[0].startValue).toBe(3600_000);
    expect(charts.setOptions.mock.calls.at(-2)![0].dataZoom[0]).toMatchObject({
      startValue: options.dataZoom[0].startValue, endValue: options.dataZoom[0].endValue,
    });
  });

  it('derives the reference line from the selected SKU and keeps its label inside the plot', () => {
    render(<Fixture />);
    expect(screen.getByText('160', { exact: true })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Capacity size' }), { target: { value: 'F64' } });
    expect(screen.getByText('40', { exact: true })).toBeVisible();
    let options = charts.setOptions.mock.calls.at(-2)![0];
    expect(options.series[8].markLine.data[0].yAxis).toBe(40);
    expect(options.series[8].markLine.label).toMatchObject({ position: 'insideEndTop', formatter: 'Semantic limit' });
    expect(options.yAxis.axisLabel.showMaxLabel).toBe(false);
    expect(options.yAxis.splitLine.showMaxLine).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Capacity size' }), { target: { value: 'F4096' } });
    options = charts.setOptions.mock.calls.at(-2)![0];
    expect(options.series[8].markLine.data[0].yAxis).toBe(1280);
    expect(options.yAxis.max({ max: 180 })).toBeGreaterThan(1280);
    expect(screen.queryByRole('spinbutton', { name: 'Semantic model limit' })).toBeNull();
    expect(screen.queryByText(/Capacity model refresh parallelism reference/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'About semantic model limit' }));
    expect(screen.getByText(/Capacity model refresh parallelism reference/)).toBeVisible();
  });

  it('renders labeled Gantt axes, readable rows and duration details without changing the upper chart', () => {
    render(<Fixture />);
    const options = charts.setOptions.mock.lastCall![0];
    expect(options.yAxis.axisLabel.show).toBe(true);
    expect(options.yAxis.axisLabel.formatter(items[0].itemKey)).toContain(`${items[0].itemName}\nSemanticModel`);
    expect(options.yAxis.splitArea.show).toBe(true);
    expect(options.xAxis.name).toBe('Start time · America/New_York');
    expect(options.dataZoom[1]).toMatchObject({ startValue: 0, endValue: 1, zoomLock: true });
    expect(options.tooltip.formatter({ dataIndex: 0 })).toContain(items[0].itemName);
    expect(options.tooltip.formatter({ dataIndex: 0 })).toContain('Shown duration 5.0m');
    expect(options.series[0].markLine.data).toHaveLength(1);
    const upper = charts.setOptions.mock.calls.at(-2)![0];
    expect(upper.grid).toEqual({ left: 60, right: 35, top: 30, bottom: 60 });
    expect(upper.series[8].markLine.label.formatter).toBe('Semantic limit');
    expect(screen.getByRole('heading', { name: 'Projected scheduled workload' })).toBeVisible();
    expect(screen.getByText(/Hover a Gantt bar for item details/)).toBeVisible();
  });

  it('shows only schedules colored by concurrency item type, without actual durations or outcomes', () => {
    document.documentElement.style.setProperty('--color-type-semantic-model', '#345678');
    render(<Timeline occurrences={occurrences} allOccurrences={occurrences} actual={[{
      ...occurrences[0], id: 'actual-test', kind: 'actual', endMs: occurrences[0].endMs + 3600_000,
    }]} window={displayDayWindow(SAMPLE_DATE)} zone="America/New_York" nowMs={Date.parse('2026-11-17T17:00:00Z')}
      items={new Map(items.map((item) => [item.itemKey, item]))} annotations={new Map()}
      slice={null} onSlice={() => {}} onSelect={() => {}} capacitySku="F256" onCapacityChange={() => {}} />);
    const options = charts.setOptions.mock.lastCall![0];
    expect(options.series[0].markLine.data).toEqual([]);
    expect(options.series[0].data).toHaveLength(occurrences.length);
    expect(options.tooltip.formatter({ dataIndex: 0 })).not.toMatch(/Outcome|Actual|Failed|Last 5 runs|Overrun/);
    expect(screen.queryByLabelText('Gantt bar key')).toBeNull();
    const renderBar = (dataIndex: number, scale = 50) => options.series[0].renderItem({
      dataIndex, coordSys: { type: 'cartesian2d', x: 0, y: 0, width: 500, height: 500 },
    }, { value: (index: number) => index, coord: ([value]: number[]) => [value * scale, 100] });
    const projected = renderBar(0).children[0].shape;
    expect(projected.height).toBe(14);
    expect(renderBar(0).children[0].style.fill).toBe('#345678');
    expect(renderBar(0).children[0].style.fill).toBe(charts.setOptions.mock.calls.at(-2)![0].series[0].itemStyle.color);
    expect(renderBar(0).children).toHaveLength(1);
    expect(renderBar(0, 100).children[1]).toMatchObject({
      type: 'text', style: { x: 150, align: 'center' },
    });
    document.documentElement.style.removeProperty('--color-type-semantic-model');
  });

  it('synchronizes horizontal sliders in either direction without forwarding the vertical item range', () => {
    render(<Fixture />);
    const upper: ReturnType<typeof charts.init> = charts.init.mock.results[0].value;
    const lower: ReturnType<typeof charts.init> = charts.init.mock.results[1].value;
    upper.on.mock.calls.find(([event]) => event === 'datazoom')![1]();
    expect(lower.dispatchAction).toHaveBeenCalledWith(
      { type: 'dataZoom', dataZoomIndex: 0, start: 20, end: 40 }, { silent: true },
    );
    lower.getOption.mockReturnValue({ dataZoom: [{ start: 35, end: 55 }, { start: 70, end: 90 }] });
    lower.on.mock.calls.find(([event]) => event === 'datazoom')![1]();
    expect(upper.dispatchAction).toHaveBeenCalledWith(
      { type: 'dataZoom', dataZoomIndex: 0, start: 35, end: 55 }, { silent: true },
    );
  });
});
