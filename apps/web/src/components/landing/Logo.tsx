import Link from 'next/link';

/** The SysScribble mark: a rounded square holding a pen stroke and a node. Inline SVG, no image file. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" className="fill-white" />
      <path d="M8 21c3-8 5-8 7-3s4 3 9-6" className="stroke-indigo-600" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="12" r="2.2" className="fill-indigo-600" />
    </svg>
  );
}

/** Logo and name, as a link home. */
export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
      <Logo />
      <span>SysScribble</span>
    </Link>
  );
}
