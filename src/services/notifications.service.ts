import { supabaseAdmin } from '../config/supabase';
import { NotFoundError } from '../lib/errors';

// NOTE: the notifications table tracks read state via a nullable `read_at`
// timestamp (NULL = unread), NOT a boolean `read` column. The API still exposes
// a boolean `read` to clients — we derive it from `read_at` on the way out.
interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

function shape(row: NotificationRow) {
  return { ...row, read: row.read_at != null };
}

export async function getNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; page: number; perPage: number },
) {
  let query = supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (opts.unreadOnly) query = query.is('read_at', null);

  const from = (opts.page - 1) * opts.perPage;
  const to = from + opts.perPage - 1;
  query = query.range(from, to);

  const { data, count } = await query;
  const total = count ?? 0;

  return {
    notifications: ((data as NotificationRow[] | null) ?? []).map(shape),
    meta: { total, page: opts.page, perPage: opts.perPage, hasMore: total > to + 1 },
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  return count ?? 0;
}

export async function markRead(notificationId: string, userId: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('id', notificationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) throw new NotFoundError('Notification');

  await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)
    .is('read_at', null);
}

export async function markAllRead(userId: string): Promise<void> {
  await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
}

export async function deleteNotification(notificationId: string, userId: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('id', notificationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) throw new NotFoundError('Notification');

  await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('id', notificationId)
    .eq('user_id', userId);
}

export async function deleteAllRead(userId: string): Promise<void> {
  await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('user_id', userId)
    .not('read_at', 'is', null);
}

// ─── Creation helpers ───────────────────────────────────────────────────────

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string | null;
}

/** Create a single in-app notification (best-effort; never throws). */
export async function createNotification(n: NewNotification): Promise<void> {
  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      action_url: n.actionUrl ?? null,
    });
  } catch {
    /* non-fatal */
  }
}

/** Bulk-create notifications (one row per recipient). Returns count inserted. */
export async function createManyNotifications(
  recipientIds: string[],
  payload: { type: string; title: string; body: string; actionUrl?: string | null },
): Promise<number> {
  if (recipientIds.length === 0) return 0;
  const rows = recipientIds.map((userId) => ({
    user_id: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    action_url: payload.actionUrl ?? null,
  }));
  const { error } = await supabaseAdmin.from('notifications').insert(rows);
  if (error) return 0;
  return rows.length;
}
