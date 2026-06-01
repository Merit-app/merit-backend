import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { sendSms } from './twilio.service';

function toStringArray(rows: unknown[] | null | undefined): string[] {
  return (rows ?? []).map((s: any) => s.user_id as string);
}

export async function sendBulkMessage(params: {
  orgId: string;
  sentBy: string;
  message: string;
  filter: 'all' | 'event' | 'active_30d' | 'active_90d';
  eventId?: string;
}) {
  const { orgId, sentBy, message, filter, eventId } = params;

  let userIds: string[] = [];

  if (filter === 'all') {
    const { data } = await supabaseAdmin
      .from('sessions')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('status', 'verified')
      .is('deleted_at', null);
    userIds = [...new Set<string>(toStringArray(data))];
  } else if (filter === 'event' && eventId) {
    const { data } = await supabaseAdmin
      .from('event_signups')
      .select('user_id')
      .eq('event_id', eventId)
      .in('status', ['signed_up', 'waitlisted']);
    userIds = toStringArray(data);
  } else if (filter === 'active_30d') {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data } = await supabaseAdmin
      .from('sessions')
      .select('user_id')
      .eq('org_id', orgId)
      .gte('date', since.toISOString().split('T')[0])
      .is('deleted_at', null);
    userIds = [...new Set<string>(toStringArray(data))];
  } else if (filter === 'active_90d') {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const { data } = await supabaseAdmin
      .from('sessions')
      .select('user_id')
      .eq('org_id', orgId)
      .gte('date', since.toISOString().split('T')[0])
      .is('deleted_at', null);
    userIds = [...new Set<string>(toStringArray(data))];
  }

  if (!userIds.length) {
    return { sent: 0, failed: 0 };
  }

  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, phone')
    .in('id', userIds)
    .not('phone', 'is', null);

  let sent = 0;
  let failed = 0;

  for (const user of (users ?? []) as any[]) {
    if (!user.phone) continue;
    try {
      await sendSms({ to: user.phone as string, body: message });
      sent++;
    } catch (err) {
      logger.warn({ userId: user.id }, 'bulk_sms_failed');
      failed++;
    }
  }

  await supabaseAdmin.from('org_messages').insert({
    org_id: orgId,
    sent_by: sentBy,
    message,
    recipient_count: sent,
    recipient_filter: { filter, eventId },
    status: failed > 0 && sent === 0 ? 'failed' : failed > 0 ? 'partial' : 'sent',
  });

  return { sent, failed };
}

export async function getMessageHistory(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('org_messages')
    .select(`
      id, message, recipient_count, status, sent_at,
      users!org_messages_sent_by_fkey (name)
    `)
    .eq('org_id', orgId)
    .order('sent_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}
