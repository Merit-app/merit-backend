import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { sendSms } from './twilio.service';
import { sendEmail } from './resend.service';
import { createManyNotifications, createNotification } from './notifications.service';
import { env } from '../config/env';
import { NotFoundError } from '../lib/errors';

const APP_URL = env.FRONTEND_URL ?? 'https://meritco.app';

// ── List events for an org ────────────────────────────────────────────────────

export async function listOrgEvents(params: {
  orgId: string;
  status?: string;
  upcoming?: boolean;
  limit?: number;
}) {
  const { orgId, status, upcoming, limit = 50 } = params;

  let query = supabaseAdmin
    .from('org_events')
    .select(`
      id, title, description, location, start_time, end_time,
      max_volunteers, min_volunteers, status, program,
      hours_value, auto_log_hours, created_at,
      event_signups(count)
    `)
    .eq('org_id', orgId)
    .order('start_time', { ascending: true })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (upcoming) query = query.gte('start_time', new Date().toISOString());

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((event: any) => ({
    ...event,
    signupCount: event.event_signups?.[0]?.count ?? 0,
    spotsLeft: event.max_volunteers
      ? event.max_volunteers - (event.event_signups?.[0]?.count ?? 0)
      : null,
  }));
}

// ── Create event ──────────────────────────────────────────────────────────────

export async function createOrgEvent(params: {
  orgId: string;
  createdBy: string;
  title: string;
  description?: string;
  location?: string;
  locationUrl?: string;
  program?: string;
  startTime: string;
  endTime: string;
  maxVolunteers?: number;
  minVolunteers?: number;
  hoursValue?: number;
  autoLogHours?: boolean;
}) {
  const { data, error } = await supabaseAdmin
    .from('org_events')
    .insert({
      org_id: params.orgId,
      created_by: params.createdBy,
      title: params.title,
      description: params.description,
      location: params.location,
      location_url: params.locationUrl,
      program: params.program,
      start_time: params.startTime,
      end_time: params.endTime,
      max_volunteers: params.maxVolunteers,
      min_volunteers: params.minVolunteers ?? 1,
      hours_value: params.hoursValue,
      auto_log_hours: params.autoLogHours ?? true,
      status: 'draft',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Update an event (draft or published) ──────────────────────────────────────

export async function updateOrgEvent(params: {
  orgId: string;
  eventId: string;
  title?: string;
  description?: string;
  location?: string;
  locationUrl?: string;
  program?: string;
  startTime?: string;
  endTime?: string;
  maxVolunteers?: number;
  hoursValue?: number;
  autoLogHours?: boolean;
}) {
  const patch: Record<string, unknown> = {};
  if (params.title !== undefined) patch.title = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.location !== undefined) patch.location = params.location;
  if (params.locationUrl !== undefined) patch.location_url = params.locationUrl;
  if (params.program !== undefined) patch.program = params.program;
  if (params.startTime !== undefined) patch.start_time = params.startTime;
  if (params.endTime !== undefined) patch.end_time = params.endTime;
  if (params.maxVolunteers !== undefined) patch.max_volunteers = params.maxVolunteers;
  if (params.hoursValue !== undefined) patch.hours_value = params.hoursValue;
  if (params.autoLogHours !== undefined) patch.auto_log_hours = params.autoLogHours;

  const { data, error } = await supabaseAdmin
    .from('org_events')
    .update(patch)
    .eq('id', params.eventId)
    .eq('org_id', params.orgId) // scope guard — can't edit another org's event
    .not('status', 'in', '(completed,cancelled)') // don't edit a finished event
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError('Event');
  return data;
}

// ── Get event detail with signups ─────────────────────────────────────────────

export async function getEventDetail(eventId: string) {
  const { data: event, error } = await supabaseAdmin
    .from('org_events')
    .select(`
      *,
      organizations!org_events_org_id_fkey (name, slug),
      event_signups (
        id, status, signed_up_at, checked_in_at,
        users!event_signups_user_id_fkey (
          id, name, username, school, grade
        )
      )
    `)
    .eq('id', eventId)
    .single();

  if (error || !event) throw new Error('Event not found');

  const signups: any[] = event.event_signups ?? [];
  return {
    ...event,
    // The detail page expects a FLAT array here and does its own grouping —
    // keep this an array. Grouped buckets are exposed separately for any
    // consumer that wants them.
    signups,
    signupGroups: {
      confirmed:  signups.filter((s) => s.status === 'signed_up'),
      waitlisted: signups.filter((s) => s.status === 'waitlisted'),
      checkedIn:  signups.filter((s) => s.status === 'checked_in'),
      noShow:     signups.filter((s) => s.status === 'no_show'),
      cancelled:  signups.filter((s) => s.status === 'cancelled'),
    },
    totalSignups: signups.filter((s) =>
      ['signed_up', 'checked_in'].includes(s.status)
    ).length,
  };
}

// ── Publish event + notify volunteers via SMS ─────────────────────────────────

export async function publishEvent(eventId: string, orgId: string) {
  const { data: event, error } = await supabaseAdmin
    .from('org_events')
    .update({ status: 'published' })
    .eq('id', eventId)
    .eq('org_id', orgId)
    .select(`*, organizations!org_events_org_id_fkey (name)`)
    .single();

  if (error || !event) throw new Error('Event not found');

  // Notify the org's full audience: anyone who has logged a session here
  // (any status), registered interest, OR follows the org. Following an org
  // is an explicit "keep me posted" signal, so followers get event invites too.
  const [{ data: sessionRows }, { data: interestRows }, { data: followRows }] = await Promise.all([
    supabaseAdmin
      .from('sessions')
      .select('user_id')
      .eq('org_id', orgId)
      .is('deleted_at', null),
    supabaseAdmin
      .from('org_volunteer_interests')
      .select('user_id')
      .eq('org_id', orgId),
    supabaseAdmin
      .from('user_org_follows')
      .select('user_id')
      .eq('org_id', orgId),
  ]);

  const audienceIds = [...new Set<string>([
    ...((followRows ?? []).map((r: any) => r.user_id)),
    ...((sessionRows ?? []).map((r: any) => r.user_id)),
    ...((interestRows ?? []).map((r: any) => r.user_id)),
  ])];

  const orgName = (event as any).organizations?.name ?? 'Your organization';
  const startDate = new Date(event.start_time).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const startTime = new Date(event.start_time).toLocaleTimeString('en-CA', {
    hour: 'numeric', minute: '2-digit',
  });
  const eventUrl = `${APP_URL}/events/${eventId}`;

  let notified = 0;

  if (audienceIds.length) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, email, phone')
      .in('id', audienceIds);

    const smsBody =
      `${orgName}: New volunteer shift — ${event.title} on ${startDate} at ${startTime}. ` +
      `${event.location ? `Location: ${event.location}. ` : ''}` +
      `Tap to participate: ${eventUrl}`;

    const html = eventEmailHtml({
      orgName, title: event.title, startDate, startTime,
      location: event.location, description: event.description, eventUrl,
    });

    const reached = new Set<string>();
    for (const user of (users ?? []).slice(0, 500) as any[]) {
      if (user.phone) {
        try { await sendSms({ to: user.phone, body: smsBody }); reached.add(user.id); }
        catch (err) { logger.warn({ err }, 'event_sms_failed'); }
      }
      if (user.email) {
        try {
          await sendEmail({ to: user.email, subject: `${orgName}: ${event.title} — can you make it?`, html });
          reached.add(user.id);
        } catch (err) { logger.warn({ err }, 'event_email_failed'); }
      }
    }

    // Guaranteed in-app notification with a one-click participate link.
    await createManyNotifications(audienceIds, {
      type: 'event',
      title: `New shift from ${orgName}`,
      body: `${event.title} — ${startDate} at ${startTime}. Tap to participate.`,
      actionUrl: `/events/${eventId}`,
    });
    audienceIds.forEach((id) => reached.add(id));
    notified = reached.size;
  }

  logger.info({ eventId, notified }, 'event_published');
  return { event, notified };
}

/** Branded HTML for an event invitation email with a Participate button. */
function eventEmailHtml(p: {
  orgName: string; title: string; startDate: string; startTime: string;
  location?: string | null; description?: string | null; eventUrl: string;
}) {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <p style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6B7280;margin:0 0 6px;">
      ${p.orgName} · New volunteer shift
    </p>
    <h1 style="font-size:20px;color:#111827;margin:0 0 12px;">${p.title}</h1>
    <table style="font-size:14px;color:#374151;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:2px 12px 2px 0;color:#6B7280;">When</td><td>${p.startDate} at ${p.startTime}</td></tr>
      ${p.location ? `<tr><td style="padding:2px 12px 2px 0;color:#6B7280;">Where</td><td>${p.location}</td></tr>` : ''}
    </table>
    ${p.description ? `<p style="font-size:14px;line-height:1.55;color:#374151;margin:0 0 20px;">${p.description}</p>` : ''}
    <a href="${p.eventUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px;">
      Click here to participate →
    </a>
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
    <p style="color:#9CA3AF;font-size:12px;margin:0;">
      You're receiving this because you volunteered with ${p.orgName} on Merit.
    </p>
  </div>`;
}

// ── Student-facing: get one event by id (for the participate page) ─────────────

export async function getStudentEvent(eventId: string, userId?: string) {
  const { data: event, error } = await supabaseAdmin
    .from('org_events')
    .select(`
      id, title, description, location, location_url, program,
      start_time, end_time, max_volunteers, status, hours_value, org_id,
      organizations!org_events_org_id_fkey (name, slug),
      event_signups(count)
    `)
    .eq('id', eventId)
    .single();

  if (error || !event) throw new NotFoundError('Event');

  let mySignup: string | null = null;
  if (userId) {
    const { data: signup } = await supabaseAdmin
      .from('event_signups')
      .select('status')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle();
    mySignup = (signup as any)?.status ?? null;
  }

  const signupCount = (event as any).event_signups?.[0]?.count ?? 0;
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    locationUrl: (event as any).location_url,
    program: event.program,
    startTime: event.start_time,
    endTime: event.end_time,
    maxVolunteers: event.max_volunteers,
    hoursValue: event.hours_value,
    status: event.status,
    orgId: event.org_id,
    orgName: (event as any).organizations?.name ?? 'Organization',
    orgSlug: (event as any).organizations?.slug ?? null,
    signupCount,
    spotsLeft: event.max_volunteers ? Math.max(0, event.max_volunteers - signupCount) : null,
    mySignupStatus: mySignup,
  };
}

// ── Student signup for event ──────────────────────────────────────────────────

export async function signupForEvent(params: {
  eventId: string;
  userId: string;
}) {
  const { eventId, userId } = params;

  const { data: event } = await supabaseAdmin
    .from('org_events')
    .select('id, max_volunteers, status, title, start_time, org_id')
    .eq('id', eventId)
    .single();

  if (!event) throw new Error('Event not found');
  if (event.status !== 'published') throw new Error('This event is not accepting signups');

  const { count: signupCount } = await supabaseAdmin
    .from('event_signups')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'signed_up');

  const isWaitlisted =
    event.max_volunteers !== null && (signupCount ?? 0) >= event.max_volunteers;

  const { data, error } = await supabaseAdmin
    .from('event_signups')
    .upsert({
      event_id: eventId,
      user_id: userId,
      status: isWaitlisted ? 'waitlisted' : 'signed_up',
    }, { onConflict: 'event_id,user_id' })
    .select()
    .single();

  if (error) throw error;

  // Confirmation notification for the student's inbox.
  const startDate = new Date(event.start_time).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  await createNotification({
    userId,
    type: 'event',
    title: isWaitlisted ? `You're on the waitlist` : `You're signed up!`,
    body: isWaitlisted
      ? `${event.title} on ${startDate} is full — we'll let you know if a spot opens.`
      : `${event.title} on ${startDate}. See you there!`,
    actionUrl: `/events/${eventId}`,
  });

  return { signup: data, isWaitlisted };
}

// ── Check in a volunteer ──────────────────────────────────────────────────────

export async function checkInVolunteer(params: {
  eventId: string;
  userId: string;
  checkedInBy: string;
}) {
  const { eventId, userId } = params;

  const { error } = await supabaseAdmin
    .from('event_signups')
    .update({ status: 'checked_in', checked_in_at: new Date().toISOString() })
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (error) throw error;
  return { checkedIn: true };
}

// ── Mark no-show ──────────────────────────────────────────────────────────────

export async function markNoShow(params: {
  eventId: string;
  userId: string;
}) {
  const { eventId, userId } = params;

  const { error } = await supabaseAdmin
    .from('event_signups')
    .update({ status: 'no_show' })
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (error) throw error;
  return { marked: true };
}

// ── Complete event + auto-log hours ───────────────────────────────────────────

export async function completeEvent(eventId: string, orgId: string) {
  const { data: event, error: eventError } = await supabaseAdmin
    .from('org_events')
    .update({ status: 'completed' })
    .eq('id', eventId)
    .eq('org_id', orgId)
    .select('*, organizations!org_events_org_id_fkey(name)')
    .single();

  if (eventError || !event) throw new Error('Event not found');

  if (!event.auto_log_hours) {
    return { completed: true, sessionsCreated: 0 };
  }

  const { data: checkins } = await supabaseAdmin
    .from('event_signups')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'checked_in');

  if (!checkins?.length) {
    return { completed: true, sessionsCreated: 0 };
  }

  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  const hours =
    event.hours_value ??
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;

  const orgName = (event as any).organizations?.name ?? 'Organization';

  let sessionsCreated = 0;
  for (const checkin of checkins) {
    try {
      const { error } = await supabaseAdmin.from('sessions').insert({
        user_id: checkin.user_id,
        org_id: orgId,
        date: event.start_time.split('T')[0],
        hours,
        activity: event.title,
        status: 'verified',
        supervisor_name: orgName,
        org_verified_by_user_id: event.created_by,
        org_verified_at: new Date().toISOString(),
        self_reported: false,
      });
      if (!error) sessionsCreated++;
    } catch (err) {
      logger.warn({ userId: checkin.user_id, eventId }, 'session_create_failed');
    }
  }

  logger.info({ eventId, sessionsCreated }, 'event_completed');
  return { completed: true, sessionsCreated };
}
