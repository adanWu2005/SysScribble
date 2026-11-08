import { z } from 'zod';

const originSchema = z.string().refine((value) => {
  try {
    return !value.includes('*') && new URL(value).origin === value;
  } catch {
    return false;
  }
}, 'must be an exact origin such as https://app.example.com, with no path and no wildcard');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Blank means verify against the project's JWKS instead of HS256. */
  SUPABASE_JWT_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),

  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL'),

  ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(originSchema).min(1)),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast on startup (PRD §5.7). Reports variable names only, never values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}
