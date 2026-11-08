import { roomIdParamsSchema } from '@wb/shared';
import { notFound, redirect } from 'next/navigation';
import { Workspace } from '@/components/room/Workspace';
import { findMemberRole } from '@/lib/db/members';
import { getRoom } from '@/lib/db/rooms';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const parsed = roomIdParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { roomId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/rooms/${roomId}`)}`);

  // A non-member gets the same page as a room that does not exist, so ids cannot be probed.
  const role = await findMemberRole(roomId, user.id);
  if (role === null) notFound();
  const room = await getRoom(roomId);
  if (!room) notFound();

  const metadata: Record<string, unknown> = user.user_metadata;
  const fullName = metadata['full_name'] ?? metadata['name'];
  const displayName = typeof fullName === 'string' && fullName.length > 0 ? fullName : (user.email ?? 'Anonymous');

  return (
    <Workspace
      roomId={roomId}
      title={room.title}
      initialRole={role}
      userId={user.id}
      displayName={displayName}
    />
  );
}
