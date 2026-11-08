'use client';

import type { RoomRole } from '@wb/shared';
import { Copy, CopyPlus, MoreHorizontal, Pencil, Trash2, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ACTION_LABELS, actionsFor, type RoomAction } from '@/lib/dashboard/actions';

const ICONS: Readonly<Record<RoomAction, LucideIcon>> = {
  rename: Pencil,
  duplicate: CopyPlus,
  members: Users,
  copyLink: Copy,
  delete: Trash2,
};

const MENU_WIDTH = 208;

interface RoomMenuProps {
  title: string;
  role: RoomRole;
  onAction: (action: RoomAction) => void;
}

/**
 * The `...` menu. The list is positioned on screen rather than inside the card, so a card's
 * rounded, clipped corners cannot cut it off. Arrow keys, Home, End and Esc work as in any menu.
 */
export function RoomMenu({ title, role, onAction }: RoomMenuProps) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const actions = actionsFor(role);

  function close(restoreFocus: boolean) {
    setAt(null);
    if (restoreFocus) trigger.current?.focus();
  }

  function toggle() {
    if (at) {
      close(false);
      return;
    }
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.max(8, Math.min(box.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const below = box.bottom + 4;
    // Opens upward when there is no room below.
    const top = below + actions.length * 40 + 16 > window.innerHeight ? Math.max(8, box.top - actions.length * 40 - 12) : below;
    setAt({ top, left });
  }

  useEffect(() => {
    if (!at) return undefined;
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dismiss = () => setAt(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (list.current?.contains(target) || trigger.current?.contains(target))) return;
      setAt(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [at]);

  function onKeyDown(event: React.KeyboardEvent) {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.findIndex((item) => item === document.activeElement);
    const go = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(false);
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-controls={at ? menuId : undefined}
        aria-label={`Actions for ${title}`}
        onClick={toggle}
        className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {at ? (
        <ul
          ref={list}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${title}`}
          onKeyDown={onKeyDown}
          style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
          className="fixed z-50 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        >
          {actions.map((action) => {
            const Icon = ICONS[action];
            const danger = action === 'delete';
            return (
              <li key={action} role="none" className={danger ? 'mt-1 border-t border-neutral-200 pt-1 dark:border-neutral-700' : ''}>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    close(false);
                    onAction(action);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left focus:outline-none ${
                    danger
                      ? 'text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 dark:focus:bg-red-500/10'
                      : 'hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700'
                  }`}
                >
                  <Icon size={15} aria-hidden />
                  {ACTION_LABELS[action]}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
