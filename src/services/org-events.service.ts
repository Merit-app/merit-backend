import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { sendSms } from './twilio.service';
import { NotFoundError } from '../lib/errors';

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
    signups: {
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

  // Get verified volunteers for this org that have a phone on record
  // (users.phone is populated when students verify their own number)
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('users!sessions_user_id_fkey(id, name, phone)')
    .eq('org_id', orgId)
    .eq('status', 'verified')
    .is('deleted_at', null);

  const seen = new Set<string>();
  const toNotify: { name: string; phone: string }[] = [];

  for (const s of sessions ?? []) {
    const user = (s as any).users;
    if (user?.phone && !seen.has(user.id)) {
      seen.add(user.id);
      toNotify.push({ name: user.name, phone: user.phone });
    }
  }

  const orgName = (event as any).organizations?.name ?? 'Your organization';
  const startDate = new Date(event.start_time).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const startTime = new Date(event.start_time).toLocaleTimeString('en-CA', {
    hour: 'numeric', minute: '2-digit',
  });

  const body =
    `${orgName}: New volunteer shift — ${event.title} on ${startDate} at ${startTime}. ` +
    `${event.location ? `Location: ${event.location}. ` : ''}` +
    `Sign up at meritco.app/events/${eventId}`;

  let notified = 0;
  for (const volunteer of toNotify.slice(0, 100)) {
    try {
      await sendSms({ to: volunteer.phone, body });
      notified++;
    } catch (err) {
      logger.warn({ phone: volunteer.phone.slice(-4), err }, 'sms_notify_failed');
    }
  }

  logger.info({ eventId, notified }, 'event_published');
  return { event, notified };
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
    })
    .select()
    .single();

  if (error) throw error;
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
