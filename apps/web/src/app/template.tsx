import type { ReactNode } from 'react';

/** A template remounts on every navigation, so each page fades in instead of appearing instantly. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
