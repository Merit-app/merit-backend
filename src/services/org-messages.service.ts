import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { sendSms } from './twilio.service';
import { sendEmail } from './resend.service';
import { createManyNotifications } from './notifications.service';

function toStringArray(rows: unknown[] | null | undefined): string[] {
  return (rows ?? []).map((s: any) => s.user_id as string);
}

/** Minimal branded HTML wrapper for a plain-text announcement. */
function announcementHtml(orgName: string, message: string) {
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <p style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6B7280;margin:0 0 8px;">
      ${orgName}
    </p>
    <div style="font-size:15px;line-height:1.55;color:#111827;">${safe}</div>
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
    <p style="color:#9CA3AF;font-size:12px;margin:0;">
      You're receiving this because you volunteered with ${orgName} on Merit.
    </p>
  </div>`;
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
    // Include everyone who has ever logged a session here (any status) OR
    // registered interest — not just verified sessions.
    const [{ data: sessionRows }, { data: interestRows }] = await Promise.all([
      supabaseAdmin
        .from('sessions')
        .select('user_id')
        .eq('org_id', orgId)
        .is('deleted_at', null),
      supabaseAdmin
        .from('org_volunteer_interests')
        .select('user_id')
        .eq('org_id', orgId),
    ]);
    userIds = [...new Set<string>([
      ...toStringArray(sessionRows),
      ...toStringArray(interestRows),
    ])];
  } else if (filter === 'event' && eventId) {
    const { data } = await supabaseAdmin
      .from('event_signups')
      .select('user_id')
      .eq('event_id', eventId)
      .in('status', ['signed_up', 'waitlisted', 'checked_in']);
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
    return { sent: 0, failed: 0, viaSms: 0, viaEmail: 0, inApp: 0 };
  }

  // Org name for the email/in-app header.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single();
  const orgName = (org as any)?.name ?? 'Your organization';

  // Fetch all matched users — include those without phone/email so we can
  // still reach them in-app and count reach accurately.
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, name, email, phone')
    .in('id', userIds);

  const subject = `${orgName}: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`;
  const html = announcementHtml(orgName, message);

  let viaSms = 0;
  let viaEmail = 0;
  let failed = 0;
  const reached = new Set<string>();

  for (const user of (users ?? []) as any[]) {
    let any = false;
    if (user.phone) {
      try {
        await sendSms({ to: user.phone as string, body: `${orgName}: ${message}` });
        viaSms++;
        any = true;
      } catch {
        logger.warn({ userId: user.id }, 'bulk_sms_failed');
      }
    }
    if (user.email) {
      try {
        // sendEmail swallows its own errors, so this counts as an attempt.
        await sendEmail({ to: user.email as string, subject, html });
        viaEmail++;
        any = true;
      } catch {
        logger.warn({ userId: user.id }, 'bulk_email_failed');
      }
    }
    if (any) reached.add(user.id);
    else failed++;
  }

  // Always drop an in-app notification for every recipient — this is the
  // channel that's guaranteed to land in their Merit inbox.
  const inApp = await createManyNotifications(userIds, {
    type: 'org_message',
    title: `${orgName} sent an announcement`,
    body: message,
    actionUrl: '/inbox',
  });
  for (const id of userIds) reached.add(id);

  const sent = reached.size;

  await supabaseAdmin.from('org_messages').insert({
    org_id: orgId,
    sent_by: sentBy,
    message,
    recipient_count: sent,
    recipient_filter: { filter, eventId },
    status: sent === 0 ? 'failed' : failed > 0 ? 'partial' : 'sent',
  });

  return { sent, failed, viaSms, viaEmail, inApp };
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
