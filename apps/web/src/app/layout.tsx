import type { Metadata } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { THEME_SCRIPT } from '@/lib/theme/theme';
import './globals.css';

// Fonts are fetched at build time and served from this origin, so the content policy needs no change.
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

// Nonces only work on dynamically rendered pages, because a prerendered page has no request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'SysScribble — Real-time notes & whiteboard', template: '%s · SysScribble' },
  description:
    'SysScribble pairs a rich document editor with an infinite multiplayer whiteboard, synced in real time.',
  applicationName: 'SysScribble',
  openGraph: { siteName: 'SysScribble', title: 'SysScribble', type: 'website' },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The proxy makes a fresh nonce per request. The script below runs only because it carries it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    // The theme class is set by the script before React hydrates, so the two can differ here.
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable}`}>
      <head>
        {/* A constant, with no user input in it: it applies the saved theme before the first paint. */}
        <script nonce={nonce} suppressHydrationWarning>
          {THEME_SCRIPT}
        </script>
      </head>
      <body className="min-h-full bg-neutral-50 font-sans text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
