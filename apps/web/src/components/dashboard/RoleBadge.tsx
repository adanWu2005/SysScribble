import type { RoomRole } from '@wb/shared';

const STYLES: Readonly<Record<RoomRole, string>> = {
  OWNER: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  EDITOR: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  VIEWER: 'bg-slate-200 text-slate-700 dark:bg-slate-500/25 dark:text-slate-300',
};

/** The role as a colored pill. Text as well as color, so it never relies on color alone. */
export function RoleBadge({ role }: { role: RoomRole }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STYLES[role]}`}>
      {role}
    </span>
  );
}
