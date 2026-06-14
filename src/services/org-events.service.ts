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
        id, status, signed_up_at, checked_in_at, hours_logged_at,
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

  // Confirmation copy for the org's admins/coordinators — in-app only (no point
  // texting/emailing them about their own event). Skip any admin already in the
  // volunteer audience so they don't get two notifications.
  const { data: adminRows } = await supabaseAdmin
    .from('org_admins')
    .select('user_id')
    .eq('org_id', orgId);
  const audienceSet = new Set(audienceIds);
  const adminIds = [...new Set<string>((adminRows ?? []).map((r: any) => r.user_id))]
    .filter((id) => !audienceSet.has(id));
  if (adminIds.length) {
    await createManyNotifications(adminIds, {
      type: 'event',
      title: `Event published: ${event.title}`,
      body: `${startDate} at ${startTime} · ${notified} ${notified === 1 ? 'person' : 'people'} notified. Tap to manage.`,
      actionUrl: `/org/${orgId}/events/${eventId}`,
    });
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

/** Hours credited for an event: the explicit hours_value, else the duration. */
function resolveEventHours(event: { hours_value?: number | null; start_time: string; end_time: string }): number {
  if (event.hours_value != null) return Number(event.hours_value);
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time).getTime();
  return Math.round(((end - start) / (1000 * 60 * 60)) * 10) / 10;
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

// ── Confirm a single volunteer attended + auto-log their hours ─────────────────
// One-click "yes, this person actually came" from the org event page. Marks the
// signup checked-in and immediately credits the event's hours to that student as
// a verified session. Idempotent: a second confirm (or a later bulk Complete)
// won't double-log, thanks to the hours_logged_at marker.

export async function confirmAttendance(params: {
  eventId: string;
  orgId: string;
  userId: string;
  confirmedBy: string;
}) {
  const { eventId, orgId, userId, confirmedBy } = params;

  const { data: event } = await supabaseAdmin
    .from('org_events')
    .select('id, org_id, title, start_time, end_time, hours_value, organizations!org_events_org_id_fkey(name)')
    .eq('id', eventId)
    .eq('org_id', orgId)
    .single();

  if (!event) throw new NotFoundError('Event');

  const { data: signup } = await supabaseAdmin
    .from('event_signups')
    .select('id, hours_logged_at')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!signup) throw new NotFoundError('Signup');

  const now = new Date().toISOString();

  // Always mark them checked in.
  await supabaseAdmin
    .from('event_signups')
    .update({ status: 'checked_in', checked_in_at: (signup as any).checked_in_at ?? now })
    .eq('id', (signup as any).id);

  // Already logged → idempotent no-op for the hours.
  if ((signup as any).hours_logged_at) {
    return { confirmed: true, alreadyLogged: true, hours: 0 };
  }

  const hours = resolveEventHours(event as any);
  const orgName = (event as any).organizations?.name ?? 'Organization';

  const { error: sessionError } = await supabaseAdmin.from('sessions').insert({
    user_id: userId,
    org_id: orgId,
    date: (event as any).start_time.split('T')[0],
    hours,
    activity: (event as any).title,
    status: 'verified',
    supervisor_name: orgName,
    org_verified_by_user_id: confirmedBy,
    org_verified_at: now,
    self_reported: false,
  });

  if (sessionError) throw sessionError;

  await supabaseAdmin
    .from('event_signups')
    .update({ hours_logged_at: now })
    .eq('id', (signup as any).id);

  await createNotification({
    userId,
    type: 'event',
    title: `${hours} ${hours === 1 ? 'hour' : 'hours'} added 🎉`,
    body: `${orgName} confirmed your attendance at ${(event as any).title}. Your hours are verified.`,
    actionUrl: `/hours`,
  });

  logger.info({ eventId, userId, hours }, 'attendance_confirmed');
  return { confirmed: true, alreadyLogged: false, hours };
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

  // Only checked-in volunteers who haven't already had hours logged (via a
  // one-by-one confirm). hours_logged_at NULL = not yet credited.
  const { data: checkins } = await supabaseAdmin
    .from('event_signups')
    .select('id, user_id')
    .eq('event_id', eventId)
    .eq('status', 'checked_in')
    .is('hours_logged_at', null);

  if (!checkins?.length) {
    return { completed: true, sessionsCreated: 0 };
  }

  const hours = resolveEventHours(event as any);
  const orgName = (event as any).organizations?.name ?? 'Organization';
  const now = new Date().toISOString();

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
        org_verified_at: now,
        self_reported: false,
      });
      if (error) continue;
      sessionsCreated++;
      await supabaseAdmin
        .from('event_signups')
        .update({ hours_logged_at: now })
        .eq('id', (checkin as any).id);
      await createNotification({
        userId: checkin.user_id,
        type: 'event',
        title: `${hours} ${hours === 1 ? 'hour' : 'hours'} added 🎉`,
        body: `${orgName} confirmed your attendance at ${event.title}. Your hours are verified.`,
        actionUrl: `/hours`,
      });
    } catch (err) {
      logger.warn({ userId: checkin.user_id, eventId }, 'session_create_failed');
    }
  }

  logger.info({ eventId, sessionsCreated }, 'event_completed');
  return { completed: true, sessionsCreated };
}

// ── Student-facing: my upcoming/active events (for the dashboard card) ─────────
// Events the student has signed up for (or is waitlisted on) that haven't ended
// yet, soonest first. Powers the "Upcoming event" card at the top of the
// student dashboard.

export async function getMyUpcomingEvents(userId: string, limit = 5) {
  const { data: signups } = await supabaseAdmin
    .from('event_signups')
    .select(`
      status, signed_up_at,
      org_events!event_signups_event_id_fkey (
        id, title, description, location, location_url, program,
        start_time, end_time, max_volunteers, hours_value, status, org_id,
        organizations!org_events_org_id_fkey (name, slug)
      )
    `)
    .eq('user_id', userId)
    .in('status', ['signed_up', 'waitlisted', 'checked_in']);

  const nowMs = Date.now();
  const rows = (signups ?? [])
    .map((s: any) => ({ signup: s, event: s.org_events }))
    .filter(({ event }) =>
      event &&
      event.status !== 'cancelled' &&
      new Date(event.end_time).getTime() >= nowMs,
    )
    .sort((a, b) =>
      new Date(a.event.start_time).getTime() - new Date(b.event.start_time).getTime(),
    )
    .slice(0, limit);

  return rows.map(({ signup, event }) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    locationUrl: event.location_url,
    program: event.program,
    startTime: event.start_time,
    endTime: event.end_time,
    maxVolunteers: event.max_volunteers,
    hoursValue: event.hours_value,
    orgId: event.org_id,
    orgName: event.organizations?.name ?? 'Organization',
    orgSlug: event.organizations?.slug ?? null,
    myStatus: signup.status,
  }));
}
