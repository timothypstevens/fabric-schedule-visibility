import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { FilterPane } from './filter-pane';
import { EMPTY_FILTERS } from '../domain/filters';
import { generateSampleData } from '../sample/data';

vi.mock('../services/schedule-data', () => ({ saveView: vi.fn(), deleteView: vi.fn() }));

function Fixture() {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  return <FluentProvider theme={webLightTheme}>
    <FilterPane filters={filters} onChange={setFilters} items={generateSampleData().items}
      views={[]} onSaved={async () => {}} onError={vi.fn()} disabled={false} />
    <output data-testid="filters">{JSON.stringify(filters)}</output>
  </FluentProvider>;
}

describe('filter pane', () => {
  it('supports multiple types and criticalities, clearing selections and reset', async () => {
    render(<Fixture />);
    expect(screen.queryByRole('checkbox', { name: 'Executive only' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Item types' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'SemanticModel' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Notebook' }));
    expect(JSON.parse(screen.getByTestId('filters').textContent!).types).toEqual(['SemanticModel', 'Notebook']);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Item types' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Criticality' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Executive' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Flexible' }));
    expect(JSON.parse(screen.getByTestId('filters').textContent!).criticality).toEqual(['Executive', 'Flexible']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Criticality' }));
    expect(JSON.parse(screen.getByTestId('filters').textContent!).criticality).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(JSON.parse(screen.getByTestId('filters').textContent!)).toEqual(EMPTY_FILTERS);
  });

  it('keeps capacity single-select and clears dependent workspace and owner selections', async () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Workspace' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Lakehouse ETL' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Workspace' }), { key: 'Escape' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Capacity' }), { target: { value: 'sample-capacity-a' } });
    const filters = JSON.parse(screen.getByTestId('filters').textContent!);
    expect(filters.capacity).toBe('sample-capacity-a');
    expect(filters.workspace).toEqual([]);
    expect(filters.owner).toEqual([]);
    fireEvent.click(screen.getByRole('combobox', { name: 'Workspace' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Lakehouse ETL' })).toBeNull();
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Executive Dashboards' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Choose a view' })).not.toHaveAttribute('multiple');
  });
});
