import { AudioLines, Columns2, FilePlus2, RefreshCw, UserPlus, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { AppPreview } from './AppPreview';
import { Brand } from './Logo';

/** Where the buttons go. Sign-up opens the same form on its "Create account" side. */
export const SIGN_IN_HREF = '/login';
export const SIGN_UP_HREF = '/login?mode=signup';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

const FEATURES: readonly Feature[] = [
  {
    icon: Columns2,
    title: 'Dual-pane workspace',
    body: 'Switch between Notes only, Split view and Canvas only without losing your place or your context.',
  },
  {
    icon: RefreshCw,
    title: 'Conflict-free real-time sync',
    body: 'Built on Yjs CRDTs and WebSockets, with live cursors, spotlight follow mode, and strict Owner, Editor and Viewer permissions.',
  },
  {
    icon: AudioLines,
    title: 'Voice huddles and instant exports',
    body: 'Talk live inside any room with integrated audio huddles, and export your work to PNG, SVG or Markdown any time.',
  },
];

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: readonly Step[] = [
  { icon: FilePlus2, title: 'Create a room', body: 'Start blank, or pick an architecture or Kanban template.' },
  { icon: UserPlus, title: 'Invite collaborators', body: 'Share a link or send email invites with granular role controls.' },
  { icon: Users, title: 'Build together, live', body: 'Co-edit documents, draw diagrams and hop into voice huddles.' },
];

/** The page signed-out visitors see at `/`. Static markup: no client JavaScript of its own. */
export function Landing() {
  return (
    <div className="arc-backdrop min-h-screen overflow-x-hidden text-white">
      <header>
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-2">
            <Link href={SIGN_IN_HREF} className="arc-btn-ghost">
              Sign In
            </Link>
            <Link href={SIGN_UP_HREF} className="arc-btn !px-4 !py-2">
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pt-20">
          <p className="mx-auto inline-block rounded-full border-2 border-dashed border-white/60 px-4 py-1 text-xs font-semibold text-white">
            Real-Time Notes &amp; Whiteboard Workspace
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl">
            Think in prose. <span className="text-indigo-200">Sketch in space.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-indigo-100 sm:text-lg">
            SysScribble pairs a Notion-style rich document editor with an infinite multiplayer whiteboard, kept in sync
            in real time with WebSockets and CRDTs.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={SIGN_UP_HREF} className="arc-btn !px-6 !py-3">
              Start Collaborating Free
            </Link>
            <a href="#features" className="arc-btn-dark !px-6 !py-3">
              See Features ↓
            </a>
          </div>
          <AppPreview />
        </section>

        <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-16 sm:px-6">
          <h2 id="features-heading" className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Everything a team needs in one room
          </h2>
          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-3xl bg-white p-7 text-neutral-900 shadow-xl">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
                  <Icon size={22} aria-hidden />
                </span>
                <h3 className="mt-5 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm text-neutral-600">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-heading" className="arc-band my-16">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="how-heading" className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, body }, index) => (
                <li key={title} className="text-center">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-indigo-900">
                    <Icon size={22} aria-hidden />
                  </span>
                  <h3 className="mt-4 text-lg font-bold">
                    <span className="text-indigo-300">Step {index + 1}. </span>
                    {title}
                  </h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-indigo-100">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="rounded-3xl bg-white px-6 py-14 text-center text-neutral-900 shadow-xl">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Ready to think out loud, together?</h2>
            <Link href={SIGN_UP_HREF} className="arc-btn-dark mt-7 !px-6 !py-3">
              Get Started with SysScribble
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/20">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-indigo-100 sm:flex-row sm:px-6">
          <p>© SysScribble</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link href={SIGN_IN_HREF} className="hover:text-white">
              Sign In
            </Link>
            <Link href={SIGN_UP_HREF} className="hover:text-white">
              Sign Up
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
