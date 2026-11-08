'use client';

import { USER_MEDIA_BUDGET_BYTES } from '@wb/shared';
import { FolderOpen, LogOut, Share2, Star, UserRound, type LucideIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/room/ThemeToggle';
import { useTheme } from '@/hooks/useTheme';
import { TABS, TAB_LABELS, formatBytes, usagePercent, type DashboardTab } from '@/lib/dashboard/filter';

const TAB_ICONS: Readonly<Record<DashboardTab, LucideIcon>> = {
  all: FolderOpen,
  owned: UserRound,
  shared: Share2,
  starred: Star,
};

export interface DashboardUser {
  id: string;
  name: string;
  email: string;
}

interface SidebarProps {
  user: DashboardUser;
  tab: DashboardTab;
  counts: Readonly<Record<DashboardTab, number>>;
  usedBytes: number;
  onTab: (tab: DashboardTab) => void;
}

/** The left column: who you are, where you can go, and how much media you have used. */
export function Sidebar({ user, tab, counts, usedBytes, onTab }: SidebarProps) {
  const { pref, setPref } = useTheme();
  const percent = usagePercent(usedBytes, USER_MEDIA_BUDGET_BYTES);

  return (
    <div className="flex h-full w-[260px] flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
        {/* Initials only: a remote avatar image would need the content policy opened up. */}
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white"
        >
          {(Array.from(user.name.trim())[0] ?? '?').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-neutral-500">{user.email}</p>
        </div>
        <ThemeToggle pref={pref} onChange={setPref} />
      </div>

      <nav aria-label="Workspaces" className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {TABS.map((id) => {
            const Icon = TAB_ICONS[id];
            const active = tab === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onTab(id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                    active
                      ? 'bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Icon size={16} aria-hidden />
                  <span className="flex-1 truncate">{TAB_LABELS[id]}</span>
                  <span className={`text-xs tabular-nums ${active ? 'opacity-80' : 'text-neutral-400'}`}>{counts[id]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">Media storage</span>
          <span className="tabular-nums text-neutral-500">
            {formatBytes(usedBytes)} / {formatBytes(USER_MEDIA_BUDGET_BYTES)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Media storage used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
        >
          <div
            style={{ width: `${percent}%` }}
            className={`h-full rounded-full ${percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          />
        </div>
        <form action="/auth/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <LogOut size={15} aria-hidden />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
