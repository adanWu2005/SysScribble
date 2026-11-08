'use client';

import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterCommands, moveHighlight, type PaletteCommand } from '@/lib/palette/commands';
import type { ShapeHit } from '@/components/whiteboard/canvasApi';

const MIN_SHAPE_QUERY = 2;
const SHAPE_HITS = 6;

interface CommandPaletteProps {
  commands: readonly PaletteCommand[];
  /** Finds shapes on the board by their text. Absent when there is no board to search. */
  searchShapes?: (query: string, limit: number) => ShapeHit[];
  onPickShape?: (shapeId: string) => void;
  onClose: () => void;
}

/**
 * Cmd/Ctrl+K. A search box over every action, plus "go to shape" results. It is a modal dialog
 * with the combobox pattern: focus stays in the input and the arrow keys move a highlight.
 */
export function CommandPalette({ commands, searchShapes, onPickShape, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Focus goes back to wherever it was when the palette closes.
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const results = useMemo<PaletteCommand[]>(() => {
    const matched = filterCommands(query, commands);
    if (!searchShapes || !onPickShape || query.trim().length < MIN_SHAPE_QUERY) return matched;
    const shapes = searchShapes(query, SHAPE_HITS).map(
      (hit): PaletteCommand => ({
        id: `shape:${hit.id}`,
        title: hit.label,
        section: 'Go to shape',
        run: () => onPickShape(hit.id),
      }),
    );
    return [...matched, ...shapes];
  }, [query, commands, searchShapes, onPickShape]);

  const active = Math.min(highlight, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  function choose(command: PaletteCommand | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlight(moveHighlight(active, 1, results.length));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setHighlight(moveHighlight(active, -1, results.length));
        return;
      case 'Enter':
        event.preventDefault();
        choose(results[active]);
        return;
      case 'Escape':
        event.preventDefault();
        onClose();
        return;
      case 'Tab':
        // The input is the only stop, so Tab cannot walk out into the page behind.
        event.preventDefault();
        return;
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-700">
          <Search size={16} aria-hidden className="text-neutral-400" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
            aria-label="Search commands"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value.slice(0, 80));
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command, or the text of a shape…"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
          />
        </div>
        <ul ref={list} id={listId} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-1">
          {results.map((command, index) => (
            <li
              key={command.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setHighlight(index)}
              onMouseDown={(event) => {
                // Keeps focus in the input so the click does not blur it first.
                event.preventDefault();
                choose(command);
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${
                index === active ? 'bg-blue-600 text-white' : 'text-neutral-800 dark:text-neutral-100'
              }`}
            >
              <span className="min-w-0 truncate">{command.title}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                <span className={index === active ? 'text-blue-100' : 'text-neutral-400'}>{command.section}</span>
                {command.shortcut ? (
                  <kbd
                    className={`rounded border px-1.5 py-0.5 font-sans ${
                      index === active ? 'border-blue-300 text-blue-50' : 'border-neutral-300 text-neutral-500 dark:border-neutral-600'
                    }`}
                  >
                    {command.shortcut}
                  </kbd>
                ) : null}
              </span>
            </li>
          ))}
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-neutral-500">
              Nothing matches “{query}”.
            </li>
          ) : null}
        </ul>
        <p className="border-t border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700">
          ↑↓ to move · Enter to run · Esc to close
        </p>
      </div>
    </div>
  );
}
