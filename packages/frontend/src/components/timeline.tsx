import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, CustomChart, LineChart } from 'echarts/charts';
import type { CustomSeriesRenderItem } from 'echarts';
import { DataZoomComponent, GraphicComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { DateTime } from 'luxon';
import { itemTypes, type ItemAnnotationRecord, type ScheduledItemRecord } from '@rayfin-app/shared';
import { computeConcurrency, type ConcurrencySlice, type Occurrence, type TimeWindow } from '../domain';
import { useTheme } from '../hooks/theme.context';
import { Button, Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Info } from 'lucide-react';
import { isSampleCapacitySku, semanticModelLimits, type CapacityReference, type SampleCapacitySku } from '../sample/capacity';
import { itemTypeColorTokens } from './item-type-colors';

echarts.use([BarChart, CustomChart, LineChart, DataZoomComponent, GraphicComponent, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

export function Timeline({ occurrences, allOccurrences, actual, window, zone, nowMs, items, annotations, slice, onSlice, onSelect, capacitySku, automaticReference, onCapacityChange }: {
  occurrences: readonly Occurrence[]; allOccurrences: readonly Occurrence[]; actual: readonly Occurrence[];
  window: TimeWindow; zone: string; nowMs: number;
  items: ReadonlyMap<string, ScheduledItemRecord>; annotations: ReadonlyMap<string, ItemAnnotationRecord>;
  slice: number | null;
  onSlice: (start: number | null) => void; onSelect: (key: string) => void;
  capacitySku?: SampleCapacitySku; onCapacityChange: (sku: SampleCapacitySku) => void;
  automaticReference?: CapacityReference;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const gantt = useRef<HTMLDivElement>(null);
  const { isDark } = useTheme();
  const [zoom, setZoom] = useState(24);
  const limit = automaticReference ? automaticReference.limit : capacitySku ? semanticModelLimits[capacitySku] : null;
  const slices = useMemo(() => computeConcurrency([...allOccurrences, ...actual], 5, window), [allOccurrences, actual, window]);
  const semantic = useMemo(() => computeConcurrency(
    allOccurrences.filter((item) => item.itemType === 'SemanticModel'), 5, window,
  ), [allOccurrences, window]);
  const bars = useMemo(() => [...occurrences].filter((item) => item.kind === 'projected')
    .sort((a, b) => a.startMs - b.startMs || a.itemName.localeCompare(b.itemName)), [occurrences]);
  const keys = useMemo(() => [...new Set(bars.map((item) => item.itemKey))], [bars]);

  useEffect(() => {
    if (!strip.current || !gantt.current) return;
    const style = getComputedStyle(document.documentElement);
    const colors = itemTypes.map((type) => style.getPropertyValue(itemTypeColorTokens[type]).trim());
    const foreground = style.getPropertyValue('--color-foreground').trim();
    const background = style.getPropertyValue('--color-card').trim();
    const red = style.getPropertyValue('--color-destructive').trim();
    const accent = style.getPropertyValue('--color-primary').trim();
    const border = style.getPropertyValue('--color-border').trim();
    const muted = style.getPropertyValue('--color-muted').trim();
    const concurrency = echarts.init(strip.current);
    const chart = echarts.init(gantt.current);
    const format = (time: number) => DateTime.fromMillis(time, { zone }).toFormat('HH:mm');
    const axis = {
      type: 'time' as const, min: window.startMs, max: window.endMs,
      axisLabel: { formatter: (time: number) => format(time), color: foreground },
    };
    const origin = slice ?? window.startMs + 5 * 3600_000;
    const startValue = zoom === 24 ? window.startMs : Math.max(window.startMs, origin - 30 * 60_000);
    const endValue = zoom === 24 ? window.endMs : Math.min(window.endMs, startValue + zoom * 3600_000);
    const timeZoom = { type: 'slider' as const, xAxisIndex: 0, startValue, endValue, filterMode: 'none' as const };
    const values = (select: (entry: ConcurrencySlice, index: number) => number) =>
      slices.map((entry, index) => [entry.startMs, select(entry, index)]);
    concurrency.setOption({
      animation: false, backgroundColor: background,
      tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value} concurrent` },
      grid: { left: 60, right: 35, top: 30, bottom: 60 },
      xAxis: axis, yAxis: {
        type: 'value', min: 0, max: ({ max }: { max: number }) => Math.max(max, limit ?? 1) * 1.1,
        axisLabel: { color: foreground, showMaxLabel: false }, splitLine: { showMaxLine: false },
      },
      dataZoom: [timeZoom],
      series: [
        ...itemTypes.map((type, index) => ({
          type: 'bar', name: type, stack: 'projected', barWidth: '95%', itemStyle: { color: colors[index] },
          data: values((entry) => entry.projected.byType[type] ?? 0),
        })),
        {
          type: 'line', name: 'Semantic model peak', showSymbol: false,
          data: values((_, index) => semantic[index].projected.total), lineStyle: { color: colors[0], width: 2 },
          markLine: { silent: true, symbol: 'none', data: limit == null ? [] : [{ yAxis: limit, name: 'Semantic limit' }], lineStyle: { color: red },
            label: { position: 'insideEndTop', formatter: 'Semantic limit', color: foreground, backgroundColor: background, padding: 4 } },
        },
        { type: 'line', name: 'Actual', showSymbol: false, data: values((entry) => entry.actual.total), lineStyle: { color: accent, type: 'dashed' } },
      ],
    });
    const renderItem: CustomSeriesRenderItem = (params, api) => {
      if (params.coordSys?.type !== 'cartesian2d') return;
      const row = Number(api.value(0));
      const start = api.coord([api.value(1), row]);
      const end = api.coord([api.value(2), row]);
      const coordinate = params.coordSys;
      if (!('x' in coordinate) || typeof coordinate.x !== 'number'
        || !('y' in coordinate) || typeof coordinate.y !== 'number'
        || !('width' in coordinate) || typeof coordinate.width !== 'number'
        || !('height' in coordinate) || typeof coordinate.height !== 'number') {
        throw new Error('Gantt chart requires Cartesian coordinate bounds.');
      }
      const left = Math.max(start[0], coordinate.x);
      const right = Math.min(end[0], coordinate.x + coordinate.width);
      if (end[0] < coordinate.x || start[0] > coordinate.x + coordinate.width
        || start[1] - 12 < coordinate.y || start[1] + 12 > coordinate.y + coordinate.height) return;
      const occurrence = bars[params.dataIndex];
      const width = Math.min(Math.max(3, right - left), coordinate.x + coordinate.width - left);
      const height = 14;
      const y = start[1] - height / 2;
      const duration = `${((occurrence.endMs - occurrence.startMs) / 60_000).toFixed(1)}m`;
      return {
        type: 'group',
        children: [{
          type: 'rect',
          shape: { x: left, y, width, height, r: 2 },
          style: {
            fill: colors[itemTypes.indexOf(occurrence.itemType)],
          },
        }, ...(width >= 64 ? [{
          type: 'text' as const,
          z2: 3,
          silent: true,
          style: {
            x: left + width / 2, y: y + height / 2, text: duration, fill: foreground,
            backgroundColor: background, padding: [0, 2], fontSize: 10,
            align: 'center' as const, verticalAlign: 'middle' as const,
          },
        }] : [])],
      };
    };
    chart.setOption({
      animation: false, backgroundColor: background,
      grid: { left: 275, right: 50, top: 40, bottom: 100 },
      graphic: [{
        type: 'text', left: 16, top: 12,
        style: { text: 'SCHEDULED ITEM / TYPE', fill: foreground, fontSize: 11, fontWeight: 600 },
      }],
      xAxis: {
        ...axis, name: `Start time · ${zone}`, nameLocation: 'middle', nameGap: 35,
        nameTextStyle: { color: foreground, fontSize: 11 },
        axisLine: { show: true, lineStyle: { color: border } },
        axisTick: { show: true, lineStyle: { color: border } },
        axisLabel: { ...axis.axisLabel, hideOverlap: true, margin: 12 },
        splitLine: { show: true, lineStyle: { color: border, type: 'dashed' } },
        axisPointer: { show: true, label: { formatter: ({ value }: { value: number }) => format(value) } },
      },
      yAxis: {
        type: 'category', inverse: true, data: keys,
        axisLabel: {
          show: true, interval: 0, color: foreground, width: 245, overflow: 'truncate', lineHeight: 15, margin: 16,
          formatter: (key: string) => {
            const item = items.get(key);
            const criticality = annotations.get(key)?.criticality;
            return `${item?.itemName ?? key}\n${item?.itemType ?? 'Other'}${criticality === 'Executive' ? ' · Executive' : ''}`;
          },
        },
        axisTick: { show: false }, axisLine: { show: true, lineStyle: { color: border } },
        splitArea: { show: true, areaStyle: { color: [background, muted] } },
        splitLine: { show: true, lineStyle: { color: border } },
      },
      dataZoom: [
        { ...timeZoom, bottom: 12, height: 22, labelFormatter: (value: number) => format(value) },
        {
          type: 'slider', yAxisIndex: 0, filterMode: 'none', startValue: 0,
          endValue: Math.min(13, Math.max(0, keys.length - 1)), right: 6, top: 40, bottom: 100,
          width: 16, showDetail: false, zoomLock: true,
        },
      ],
      tooltip: {
        trigger: 'item', renderMode: 'richText', confine: true,
        formatter: (value: unknown) => {
          if (!value || typeof value !== 'object' || !('dataIndex' in value)) return '';
          const item = bars[Number(value.dataIndex)];
          if (!item) return '';
          const record = items.get(item.itemKey);
          return [
            item.itemName, `${item.itemType} · ${annotations.get(item.itemKey)?.criticality ?? 'Standard'}`,
            `Projected ${DateTime.fromMillis(item.startMs, { zone }).toFormat('ccc LLL dd HH:mm')} - ${DateTime.fromMillis(item.endMs, { zone }).toFormat('ccc LLL dd HH:mm')}`,
            `${record?.workspaceName ?? ''}\n${record?.owner ?? 'Unassigned'}`,
            `Shown duration ${((item.endMs - item.startMs) / 60_000).toFixed(1)}m`,
            item.noHistory ? 'No history · default 5 minutes' : `Average ${((record?.avgDurationSec ?? 0) / 60).toFixed(1)}m`,
            'Click to open details and annotations.',
          ].join('\n');
        },
      },
      series: [{
        type: 'custom', renderItem, encode: { x: [1, 2], y: 0 },
        data: bars.map((item) => [keys.indexOf(item.itemKey), item.startMs, item.endMs]),
        markLine: {
          silent: true, symbol: 'none',
          data: nowMs >= window.startMs && nowMs < window.endMs ? [{ xAxis: nowMs }] : [],
          lineStyle: { color: red, type: 'dashed', width: 2 },
          label: { formatter: 'Now', position: 'insideEndTop', color: foreground, backgroundColor: background, padding: 4 },
        },
      }],
    });
    const syncTimeZoom = (source: typeof chart, target: typeof chart) => {
      const option = source.getOption();
      const zooms = option.dataZoom;
      if (!Array.isArray(zooms)) throw new Error('Timeline time slider is missing.');
      const time = zooms[0];
      if (typeof time?.start !== 'number' || typeof time?.end !== 'number') {
        throw new Error('Timeline time slider has an invalid range.');
      }
      target.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: time.start, end: time.end }, { silent: true });
    };
    concurrency.on('datazoom', () => syncTimeZoom(concurrency, chart));
    chart.on('datazoom', () => syncTimeZoom(chart, concurrency));
    concurrency.on('click', (value) => {
      if (typeof value.dataIndex === 'number' && slices[value.dataIndex]) onSlice(slices[value.dataIndex].startMs);
    });
    chart.on('click', (value) => {
      if (typeof value.dataIndex === 'number' && bars[value.dataIndex]) onSelect(bars[value.dataIndex].itemKey);
    });
    const resize = new ResizeObserver(() => { concurrency.resize(); chart.resize(); });
    resize.observe(strip.current); resize.observe(gantt.current);
    return () => { resize.disconnect(); concurrency.dispose(); chart.dispose(); };
  }, [bars, keys, items, annotations, slices, semantic, window, zone, nowMs, limit, capacitySku, zoom, slice, onSlice, onSelect, isDark]);

  return <section aria-label="Timeline">
    <div className="timeline-header">
      <div className="timeline-heading">
        <h2>Projected concurrency &amp; actual overlay</h2>
        <p className="secondary-text">Hover a Gantt bar for item details.</p>
      </div>
      <div className="timeline-controls">
      <div className="timeline-zoom" role="group" aria-label="Zoom">
        <div className="zoom-buttons">{[24, 4, 1].map((hours) =>
          <Button key={hours} size="small" appearance={zoom === hours ? 'primary' : 'secondary'}
            aria-pressed={zoom === hours} onClick={() => setZoom(hours)}>{hours}h</Button>)}</div>
      </div>
      <label>Capacity size<select value={automaticReference ? '' : capacitySku} onChange={(event) => {
        const sku = event.target.value;
        if (!isSampleCapacitySku(sku)) throw new Error(`Unsupported capacity size: ${sku}`);
        onCapacityChange(sku);
      }}>{automaticReference && <option value="" disabled>{automaticReference.label}</option>}
        {Object.keys(semanticModelLimits).map((sku) => <option key={sku}>{sku}</option>)}</select></label>
      <div className="timeline-limit"><span className="metric-heading">Semantic model limit
        <Popover positioning="below-end">
          <PopoverTrigger disableButtonEnhancement><Button size="small" appearance="subtle" icon={<Info size={15} />} aria-label="About semantic model limit" /></PopoverTrigger>
          <PopoverSurface className="schedule-info" aria-label="Semantic model limit explanation">
            <h3>Semantic model limit</h3>
            <p>Capacity model refresh parallelism reference. Defaults to the selected capacity's current size, or summed known capacity units and individual refresh limits for all capacities. Unknown sizes are excluded. Capacities are not pooled; an individual capacity can reach its limit below the combined total.</p>
            <p>This reference is not measured utilization or a guarantee of available refresh capacity. CPU, memory, and other workload constraints still apply.</p>
            <p>This selection changes the reference limit; it does not resize or discover a Fabric capacity.</p>
          </PopoverSurface>
        </Popover>
      </span><strong>{limit ?? '—'}</strong></div>
      </div>
    </div>
    <div className="concurrency-chart" ref={strip} role="img" aria-label="Stacked five-minute concurrency chart" />
    <section className="gantt-panel" aria-label="Projected scheduled workload">
    <div className="gantt-heading">
      <div><h3>Projected scheduled workload</h3><p className="secondary-text">{DateTime.fromMillis(window.startMs, { zone }).toFormat('cccc, LLLL dd, yyyy')} · {zone} · {keys.length} items</p></div>
      <label>Concurrency slice<select aria-label="Concurrency slice" value={slice ?? ''} onChange={(event) => onSlice(event.target.value ? Number(event.target.value) : null)}>
        <option value="">All occurrences</option>
        {slices.map((entry, index) => <option key={entry.startMs} value={entry.startMs}>
          {DateTime.fromMillis(entry.startMs, { zone }).toFormat('HH:mm ZZ')} · {semantic[index].projected.total} semantic / {entry.projected.total} total
        </option>)}
      </select></label>
    </div>
    <div className="gantt-scroll"><div className="gantt-chart" ref={gantt} role="img" aria-label="Scheduled start and duration Gantt timeline" /></div>
    {bars.length === 0 && <p className="empty-message">No occurrences match this slice or these filters.</p>}
    </section>
  </section>;
}
