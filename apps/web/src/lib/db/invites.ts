import 'server-only';
import { INVITE_TTL_MS, type AssignableRole, type Invite, type PendingInvite, type Tables } from '@wb/shared';
import { ApiError } from '@/lib/api';
import { getAdminClient } from '@/lib/supabase/admin';

type InviteRow = Tables<'room_invites'>;

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    roomId: row.room_id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdBy: row.created_by,
  };
}

/** Never selected for the API: a stored hash has no business leaving the server. */
const PUBLIC_COLUMNS = 'id, room_id, email, role, expires_at, accepted_at, created_by' as const;

export interface NewInvite {
  roomId: string;
  email: string;
  role: AssignableRole;
  tokenHash: string;
  createdBy: string;
}

export async function createInvite(invite: NewInvite): Promise<Invite> {
  const admin = getAdminClient();

  // A fresh invite replaces any pending one, so an old link stops working.
  const cleared = await admin
    .from('room_invites')
    .delete()
    .eq('room_id', invite.roomId)
    .eq('email', invite.email)
    .is('accepted_at', null);
  if (cleared.error) throw new ApiError(500, 'INTERNAL', 'Database error');

  const { data, error } = await admin
    .from('room_invites')
    .insert({
      room_id: invite.roomId,
      email: invite.email,
      role: invite.role,
      token_hash: invite.tokenHash,
      created_by: invite.createdBy,
      expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    })
    .select(PUBLIC_COLUMNS)
    .single();
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return toInvite({ ...data, token_hash: '', created_at: '' });
}

export async function listPendingInvites(roomId: string): Promise<Invite[]> {
  const { data, error } = await getAdminClient()
    .from('room_invites')
    .select(PUBLIC_COLUMNS)
    .eq('room_id', roomId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false });
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.map((row) => toInvite({ ...row, token_hash: '', created_at: '' }));
}

/** Scoped to the room, so an owner cannot revoke another room's invite by id. */
export async function revokeInvite(roomId: string, inviteId: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('room_invites')
    .delete()
    .eq('id', inviteId)
    .eq('room_id', roomId)
    .is('accepted_at', null)
    .select('id');
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.length > 0;
}

export async function deleteInvite(inviteId: string): Promise<void> {
  await getAdminClient().from('room_invites').delete().eq('id', inviteId);
}

/** The RPC is the atomic single-use claim. Every failure looks the same to the caller. */
export async function acceptInvite(tokenHash: string, userId: string, email: string): Promise<string> {
  const { data, error } = await getAdminClient().rpc('accept_invite', {
    p_token_hash: tokenHash,
    p_user_id: userId,
    p_email: email,
  });
  if (error) {
    if (error.message.includes('INVITE_INVALID')) {
      throw new ApiError(400, 'INVITE_INVALID', 'This invite is invalid, expired or already used');
    }
    throw new ApiError(500, 'INTERNAL', 'Database error');
  }
  return data;
}

/** Invitations sent to this email that are still open. The email must come from the verified JWT. */
export async function listPendingInvitesForEmail(email: string): Promise<PendingInvite[]> {
  const { data, error } = await getAdminClient().rpc('list_pending_invites', { p_email: email });
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data.map((row) => ({
    inviteId: row.invite_id,
    roomId: row.room_id,
    roomTitle: row.room_title,
    role: row.role,
    invitedBy: row.invited_by_name,
    expiresAt: row.expires_at,
  }));
}

/** The same atomic single-use claim as the emailed link, found by id. Every failure looks the same. */
export async function acceptInviteById(inviteId: string, userId: string, email: string): Promise<string> {
  const { data, error } = await getAdminClient().rpc('accept_invite_by_id', {
    p_invite_id: inviteId,
    p_user_id: userId,
    p_email: email,
  });
  if (error) {
    if (error.message.includes('INVITE_INVALID')) {
      throw new ApiError(400, 'INVITE_INVALID', 'This invite is invalid, expired or already used');
    }
    throw new ApiError(500, 'INTERNAL', 'Database error');
  }
  return data;
}

/** Deletes an open invite addressed to this email. False when there was nothing of theirs to decline. */
export async function declineInviteById(inviteId: string, email: string): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc('decline_invite', { p_invite_id: inviteId, p_email: email });
  if (error) throw new ApiError(500, 'INTERNAL', 'Database error');
  return data;
}
