import 'server-only';
import type { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface AuthUser {
  userId: string;
  email: string | null;
}

async function resolveAccessToken(req: NextRequest): Promise<string | null> {
  const header = req.headers.get('authorization');
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match?.[1] ?? null;
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Authentication only. Proves identity, says nothing about room access —
 * every handler must still call requireRoomRole (PRD §5.2).
 */
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const token = await resolveAccessToken(req);
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required');
  try {
    const verified = await verifyAccessToken(token);
    return { userId: verified.userId, email: verified.email };
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired session');
  }
}
