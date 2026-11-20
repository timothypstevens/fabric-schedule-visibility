import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { generateSampleData, SAMPLE_DATE } from '../sample/data';
import { SlotFinder } from './slot-finder';

describe('recurring slot finder', () => {
  it('defaults to all weekday checkboxes and expands and collapses the peak jobs', () => {
    const item = { ...generateSampleData().items[380], intervalMinutes: 5, avgDurationSec: 300 };
    render(<SlotFinder items={[item]} date={SAMPLE_DATE} zone="America/New_York" />);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(screen.getByRole('checkbox', { name: day })).toBeChecked();
    }
    const option = screen.getByText('Option 1').closest('article')!;
    const toggle = within(option).getByRole('button', { name: '1 concurrent jobs at peak' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(option).getAllByText(new RegExp(item.itemName))).toHaveLength(7);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(option).queryByText(new RegExp(item.itemName))).toBeNull();
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    expect(screen.getByText('Select at least one weekday.')).toBeVisible();
    expect(screen.queryByText('Option 1')).toBeNull();
  });
});
