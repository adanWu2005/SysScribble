import { NextResponse } from 'next/server';
import { appOrigin } from '@/lib/appOrigin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', appOrigin()), { status: 303 });
}
