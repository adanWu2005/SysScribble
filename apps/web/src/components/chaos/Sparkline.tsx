'use client';

import { sparklinePoints } from '@/lib/telemetry/rates';

interface SparklineProps {
  /** One line per entry, drawn on a shared scale. */
  lines: readonly { label: string; values: readonly number[]; className: string }[];
  width?: number;
  height?: number;
  /** Describes the chart for people who cannot see it. */
  summary: string;
}

/** A tiny chart made of SVG polylines. No chart library, and nothing here is HTML. */
export function Sparkline({ lines, width = 280, height = 44, summary }: SparklineProps) {
  const ceiling = Math.max(1, ...lines.flatMap((line) => line.values));
  return (
    <svg
      role="img"
      aria-label={summary}
      viewBox={`0 0 ${width} ${height}`}
      className="h-11 w-full overflow-visible rounded bg-neutral-50 dark:bg-neutral-800"
      preserveAspectRatio="none"
    >
      <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="1" />
      {lines.map((line) => (
        <polyline
          key={line.label}
          points={sparklinePoints(line.values, width, height - 2, ceiling)}
          fill="none"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className={line.className}
        />
      ))}
    </svg>
  );
}
