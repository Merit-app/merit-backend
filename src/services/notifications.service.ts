import { supabaseAdmin } from '../config/supabase';
import { NotFoundError } from '../lib/errors';

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  read: boolean;
  created_at: string;
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

  if (opts.unreadOnly) query = query.eq('read', false);

  const from = (opts.page - 1) * opts.perPage;
  const to = from + opts.perPage - 1;
  query = query.range(from, to);

  const { data, count } = await query;
  const total = count ?? 0;

  return {
    notifications: (data as NotificationRow[] | null) ?? [],
    meta: { total, page: opts.page, perPage: opts.perPage, hasMore: total > to + 1 },
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

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
    .update({ read: true })
    .eq('id', notificationId)
    .eq('user_id', userId);
}

export async function markAllRead(userId: string): Promise<void> {
  await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
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
    .eq('read', true);
}
