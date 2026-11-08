import { z } from 'zod';

/**
 * Public environment — the ONLY variables that may reach the browser bundle (PRD §5.7).
 * Each one is referenced explicitly so Next.js can inline it at build time.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_WS_URL: z.string().url().refine((u) => /^wss?:/.test(u), 'must be ws:// or wss://'),
  NEXT_PUBLIC_LIVEKIT_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  NEXT_PUBLIC_WS_URL: process.env['NEXT_PUBLIC_WS_URL'],
  NEXT_PUBLIC_LIVEKIT_URL: process.env['NEXT_PUBLIC_LIVEKIT_URL'],
  NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid public environment: ${issues}`);
}

export const publicEnv: PublicEnv = parsed.data;
