const PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#4f46e5'] as const;

/** A stable color for a user id, so a person is the same color on the canvas, the roster and the huddle. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? PALETTE[0];
}
