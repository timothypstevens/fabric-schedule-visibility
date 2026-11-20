export function formatDuration(seconds?: number | null): string {
  return seconds == null ? 'No history' : `${(seconds / 60).toFixed(1)}m`;
}
