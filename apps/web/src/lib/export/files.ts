/** Naming and saving the files an export produces. */

/** A safe file name stem: letters, digits, spaces, dashes and underscores only. */
export function fileStem(value: string, fallback = 'workspace'): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned === '' ? fallback : cleaned;
}

export function exportFileName(title: string, suffix: string, extension: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `${fileStem(title)}-${suffix}-${date}.${extension}`;
}

/** Saves a blob through a temporary link. Browser only. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the time the task after the click runs.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
