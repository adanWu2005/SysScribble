import 'server-only';
import { getAdminClient } from '@/lib/supabase/admin';

export interface DashboardProfile {
  displayName: string | null;
}

/** The caller's own display name. A missing profile is not an error: the email is shown instead. */
export async function getOwnProfile(userId: string): Promise<DashboardProfile> {
  const { data } = await getAdminClient().from('profiles').select('display_name').eq('id', userId).maybeSingle();
  return { displayName: data?.display_name?.trim() || null };
}
