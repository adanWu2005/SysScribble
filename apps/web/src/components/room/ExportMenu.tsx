'use client';

import { Download, FileCode, FileImage, FileText, Loader2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { ApiClientError, apiFetch } from '@/lib/fetcher';
import { prepareBoardExport, svgToPng } from '@/lib/export/board';
import { downloadBlob, exportFileName } from '@/lib/export/files';
import { notesToMarkdown } from '@/lib/export/markdown';
import { shapeLink } from '@/lib/notes/shapeRef';
import { readNotesTitle } from '@/lib/notes/title';
import { readShapes } from '@/lib/whiteboard/model';

type Kind = 'png' | 'svg' | 'md';

const ITEMS: readonly { kind: Kind; label: string; hint: string; Icon: LucideIcon }[] = [
  { kind: 'png', label: 'Whiteboard as PNG', hint: 'High-resolution image', Icon: FileImage },
  { kind: 'svg', label: 'Whiteboard as SVG', hint: 'Scalable vector file', Icon: FileCode },
  { kind: 'md', label: 'Notes as Markdown', hint: 'A .md text file', Icon: FileText },
];

interface ExportMenuProps {
  roomId: string;
  /** The workspace name, used in file names when the notes have no title. */
  title: string;
  doc: Y.Doc | null;
  /** The notes as editor JSON, or null while the editor is not ready. */
  getNotesJson: () => unknown;
  onNotice: (message: string) => void;
}

/**
 * Exports. They only read the local copy of the document, so every role can use them. Nothing is
 * sent to the server except the request for an image's download link, which any member may make.
 */
export function ExportMenu({ roomId, title, doc, getNotesJson, onNotice }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'ArrowDown') {
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      items[(index - 1 + items.length) % items.length]?.focus();
    } else {
      return;
    }
    event.preventDefault();
  }

  async function run(kind: Kind) {
    if (!doc || busy) return;
    setOpen(false);
    setBusy(kind);
    try {
      if (kind === 'md') {
        const markdown = notesToMarkdown(getNotesJson(), {
          title: readNotesTitle(doc) || title,
          linkForShape: (shapeId) => shapeLink(window.location.origin, roomId, shapeId),
        });
        downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), exportFileName(title, 'notes', 'md'));
        onNotice('Notes exported as Markdown.');
        return;
      }

      const prepared = await prepareBoardExport(readShapes(doc), async (assetId) => {
        const { url } = await apiFetch<{ url: string }>(`/api/rooms/${roomId}/assets/${assetId}`);
        return url;
      });
      if (!prepared) {
        onNotice('The whiteboard is empty, so there is nothing to export.');
        return;
      }

      if (kind === 'svg') {
        downloadBlob(new Blob([prepared.svg], { type: 'image/svg+xml;charset=utf-8' }), exportFileName(title, 'whiteboard', 'svg'));
      } else {
        const png = await svgToPng(prepared.svg, prepared.width, prepared.height, 2);
        downloadBlob(png, exportFileName(title, 'whiteboard', 'png'));
      }
      const label = kind === 'svg' ? 'SVG' : 'PNG';
      onNotice(
        prepared.missingImages > 0
          ? `Whiteboard exported as ${label}. ${prepared.missingImages} image${prepared.missingImages === 1 ? '' : 's'} could not be included.`
          : `Whiteboard exported as ${label}.`,
      );
    } catch (error) {
      onNotice(error instanceof ApiClientError || error instanceof Error ? error.message : 'The export failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={doc === null || busy !== null}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 px-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
        <span className="hidden lg:inline">{busy ? 'Exporting…' : 'Export'}</span>
        <span className="sr-only lg:hidden">Export</span>
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label="Export"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        >
          {ITEMS.map(({ kind, label, hint, Icon }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => void run(kind)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none dark:hover:bg-neutral-700 dark:focus-visible:bg-neutral-700"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
                <Icon size={16} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
