import type { ApiErrorCode } from '@wb/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { publicEnv } from '@/lib/env';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function errorResponse(status: number, code: ApiErrorCode, message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

export interface RouteContext<P> {
  req: NextRequest;
  params: P;
}

type RouteHandler<P> = (ctx: RouteContext<P>) => Promise<Response>;

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth behind SameSite=Lax cookies. Browsers always send Origin on a
 * cross-site write. Non-browser clients omit it but have no ambient cookies to abuse.
 */
function assertSameOrigin(req: NextRequest): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get('origin');
  if (origin && origin !== publicEnv.NEXT_PUBLIC_APP_URL) {
    throw new ApiError(403, 'FORBIDDEN', 'Cross-origin request refused');
  }
}

/**
 * Wraps a route handler with uniform error mapping.
 * Order inside handlers is fixed: parse → authenticate → authorize → rate-limit → act → respond.
 */
export function route<P extends Record<string, string> = Record<string, string>>(handler: RouteHandler<P>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOrigin(req);
      return await handler({ req, params: await ctx.params });
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResponse(err.status, err.code, err.message, err.details);
      }
      if (err instanceof ZodError) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Invalid input', err.flatten());
      }
      console.error('[api] unhandled error', err instanceof Error ? err.message : err);
      return errorResponse(500, 'INTERNAL', 'Internal server error');
    }
  };
}

/** Validate route params (every ID from the URL passes through here — PRD §5.1). */
export function parseParams<S extends ZodTypeAny>(params: unknown, schema: S): z.output<S> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid route parameter', result.error.flatten());
  }
  return result.data;
}

const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Parse and validate a JSON body. Bodies over 64 KB are rejected before parsing. */
export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  }
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, 'BAD_REQUEST', 'Body must be valid JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', result.error.flatten());
  }
  return result.data;
}
