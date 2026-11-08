'use client';

import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import type { RoomTemplateId } from '@wb/shared';
import { useLocalPref } from '@/hooks/useLocalPref';
import { NewWorkspaceDialog } from './NewWorkspaceDialog';

export interface TemplateCard {
  id: RoomTemplateId;
  name: string;
  description: string;
}

export const TEMPLATE_CARDS: readonly TemplateCard[] = [
  { id: 'blank', name: 'Blank Workspace', description: 'Clean notes and an infinite canvas.' },
  { id: 'rfc', name: 'System Architecture RFC', description: 'An RFC outline, with Client, API, Redis and Postgres boxes drawn.' },
  { id: 'kanban', name: 'Kanban Sprint Board', description: 'Three columns with sticky notes, and sprint goals in the notes.' },
  { id: 'retro', name: 'Team Retrospective', description: 'Went well, to improve and action items.' },
];

const GALLERY_KEY = 'wb:gallery-collapsed';

/** A tiny picture of each starting point. Decorative, so hidden from screen readers. */
function Preview({ id }: { id: RoomTemplateId }) {
  const box = 'fill-neutral-200 dark:fill-neutral-700';
  const accent = 'fill-blue-300 dark:fill-blue-500/60';
  const note = 'fill-amber-300 dark:fill-amber-400/70';
  return (
    <svg aria-hidden viewBox="0 0 160 80" className="h-20 w-full rounded-md bg-neutral-100 dark:bg-neutral-800">
      {id === 'blank' ? (
        <>
          <rect x="14" y="14" width="46" height="6" rx="3" className={box} />
          <rect x="14" y="28" width="62" height="4" rx="2" className={box} />
          <rect x="14" y="38" width="54" height="4" rx="2" className={box} />
          <rect x="94" y="22" width="50" height="38" rx="4" className={accent} />
        </>
      ) : null}
      {id === 'rfc' ? (
        <>
          <rect x="10" y="30" width="30" height="20" rx="3" className={accent} />
          <rect x="58" y="30" width="30" height="20" rx="3" className="fill-violet-300 dark:fill-violet-500/60" />
          <rect x="116" y="12" width="30" height="20" rx="3" className="fill-red-300 dark:fill-red-500/60" />
          <rect x="116" y="48" width="30" height="20" rx="3" className="fill-green-300 dark:fill-green-500/60" />
          <path d="M40 40h18M88 40l14 0 0-18 14 0M102 40l0 18 14 0" className="fill-none stroke-neutral-500" strokeWidth="1.5" />
        </>
      ) : null}
      {id === 'kanban' ? (
        <>
          {[10, 58, 106].map((x) => (
            <rect key={x} x={x} y="10" width="44" height="60" rx="4" className={box} />
          ))}
          <rect x="15" y="18" width="34" height="12" rx="2" className={note} />
          <rect x="15" y="34" width="34" height="12" rx="2" className={note} />
          <rect x="63" y="18" width="34" height="12" rx="2" className={note} />
        </>
      ) : null}
      {id === 'retro' ? (
        <>
          <rect x="10" y="10" width="44" height="60" rx="4" className="fill-green-200 dark:fill-green-500/30" />
          <rect x="58" y="10" width="44" height="60" rx="4" className="fill-red-200 dark:fill-red-500/30" />
          <rect x="106" y="10" width="44" height="60" rx="4" className="fill-blue-200 dark:fill-blue-500/30" />
          <rect x="15" y="20" width="34" height="12" rx="2" className={note} />
          <rect x="63" y="20" width="34" height="12" rx="2" className={note} />
          <rect x="111" y="20" width="34" height="12" rx="2" className={note} />
        </>
      ) : null}
    </svg>
  );
}

/** One-click starting points. A card asks for a name, then creates the workspace already filled in. */
export function TemplateGallery() {
  const [collapsedRaw, saveCollapsed] = useLocalPref(GALLERY_KEY);
  const collapsed = collapsedRaw === '1';
  const [chosen, setChosen] = useState<TemplateCard | null>(null);

  return (
    <section aria-labelledby="create-heading">
      <h2 id="create-heading" className="mb-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => saveCollapsed(collapsed ? '0' : '1')}
          className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-neutral-300 dark:hover:text-white"
        >
          <ChevronDown size={16} aria-hidden className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          Create new workspace
        </button>
      </h2>

      {collapsed ? null : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TEMPLATE_CARDS.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => setChosen(card)}
                className="group flex h-full w-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left transition hover:border-blue-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-500"
              >
                <Preview id={card.id} />
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{card.name}</span>
                  <Plus size={15} aria-hidden className="shrink-0 text-neutral-400 group-hover:text-blue-500" />
                </span>
                <span className="text-xs text-neutral-500">{card.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen ? <NewWorkspaceDialog template={chosen} onClose={() => setChosen(null)} /> : null}
    </section>
  );
}
