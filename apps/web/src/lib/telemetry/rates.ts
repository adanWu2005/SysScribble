/** Arithmetic behind the Chaos Lab's live numbers. Pure, so it is tested without a browser. */

export const HISTORY_LENGTH = 60;

/** Events per second between two cumulative counts. Never negative, never NaN. */
export function rate(previous: number, next: number, seconds: number): number {
  if (!Number.isFinite(previous) || !Number.isFinite(next) || !(seconds > 0)) return 0;
  return Math.max(0, Math.round(((next - previous) / seconds) * 10) / 10);
}

/** Appends a value and keeps only the newest `max`. Returns a new array. */
export function pushHistory(history: readonly number[], value: number, max = HISTORY_LENGTH): number[] {
  const next = [...history, Number.isFinite(value) ? value : 0];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Points for an SVG polyline that draws `values` left to right inside a box. The y axis is flipped
 * so larger values are higher. `ceiling` lets two lines share one scale.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number, ceiling?: number): string {
  if (values.length === 0 || width <= 0 || height <= 0) return '';
  const top = Math.max(1, ceiling ?? Math.max(...values));
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const clamped = Math.min(top, Math.max(0, value));
      const x = values.length > 1 ? index * step : width;
      const y = height - (clamped / top) * height;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}

/** "3.2 s ago", "2 min ago". Null means there has been none yet. */
export function formatAge(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return 'Not yet';
  const ms = Math.max(0, milliseconds);
  if (ms < 1000) return 'Just now';
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} s ago`;
  if (seconds < 60) return `${Math.round(seconds)} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/** Bytes per second as a short string. */
export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '';
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
}
