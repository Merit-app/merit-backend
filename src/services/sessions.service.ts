import DOMPurify from 'isomorphic-dompurify';
import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import { normalizePhone } from '../lib/phone';
import { logger } from '../lib/logger';

/** Strip all HTML/script tags from free-text fields before storing. */
function sanitizeText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
import { resolveOrCreateAuthenticator } from './trust.service';
import { calculateFraudScore } from './fraud.service';
import { resolveOrCreateOrg } from './organizations.service';
import { trackEvent } from './analytics.service';
import { smsQueue } from '../queues/index';
import { sendVerificationSMS, sendVerificationEmail } from './verifications.service';
import type { CreateSessionInput, UpdateSessionInput } from '../schemas/sessions.schema';

const RESEND_LIMITS: Record<string, number> = { free: 2, pro: 5, premium: 999, institutional: 999 };

/**
 * Idempotency guard against double-submits. A double-tapped "Log" button (or a
 * client retry on a slow connection) would otherwise insert two identical
 * sessions AND fire the supervisor SMS/email twice (real Twilio cost + duplicated
 * hours). If an identical session for this user/org/date/hours was created in the
 * last few seconds, return it instead of creating a new one.
 */
const DEDUPE_WINDOW_MS = 15_000;
async function findRecentDuplicate(
  userId: string,
  orgId: string | null,
  date: string,
  hours: number,
) {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  let q = supabaseAdmin
    .from('sessions')
    .select('*, org:organizations(id, name), authenticator:authenticators(id, name, tier)')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('hours', hours)
    .is('deleted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  q = orgId ? q.eq('org_id', orgId) : q.is('org_id', null);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

export async function getSessions(
  userId: string,
  filters: {
    status?: string;
    verificationTier?: string;
    orgId?: string;
    from?: string;
    to?: string;
    page: number;
    perPage: number;
  },
) {
  let query = supabaseAdmin
    .from('sessions')
    .select('*, org:organizations(id, name, city, state), authenticator:authenticators(id, name, tier)', { count: 'exact' })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('date', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.verificationTier) query = query.eq('verification_tier', filters.verificationTier);
  if (filters.orgId) query = query.eq('org_id', filters.orgId);
  if (filters.from) query = query.gte('date', filters.from);
  if (filters.to) query = query.lte('date', filters.to);

  const from = (filters.page - 1) * filters.perPage;
  const to = from + filters.perPage - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    sessions: data ?? [],
    meta: { total: count ?? 0, page: filters.page, perPage: filters.perPage, hasMore: (count ?? 0) > to + 1 },
  };
}

export async function getSession(sessionId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .select('*, org:organizations(*), authenticator:authenticators(*)')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new NotFoundError('Session');
  return data;
}

export async function createSession(userId: string, input: CreateSessionInput, userPlan: string, userName = 'Student') {
  // ── Self-reported (tracker) path ──────────────────────────────────────────
  if (input.selfReported) {
    const orgId = await resolveOrCreateOrg({ orgId: input.orgId ?? undefined, newOrg: input.newOrg });

    const dup = await findRecentDuplicate(userId, orgId, input.date, input.hours);
    if (dup) {
      logger.info({ sessionId: dup.id, userId }, 'self_reported_session_deduped');
      return dup;
    }

    const { data: session, error } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id: userId,
        org_id: orgId,
        date: input.date,
        hours: input.hours,
        activity: sanitizeText(input.activity),
        supervisor_name: 'Self-tracked',
        supervisor_phone: null,
        supervisor_email: null,
        status: 'verified',
        self_reported: true,
        tracker_note: input.trackerNote ? sanitizeText(input.trackerNote) : null,
        fraud_score: 0,
        fraud_flags: [],
      })
      .select('*, org:organizations(id, name), authenticator:authenticators(id, name, tier)')
      .single();

    if (error || !session) {
      logger.error({ error, userId }, 'self_reported_session_create_failed');
      throw new AppError('create_failed', 'Failed to create session.', 500);
    }

    trackEvent(userId, 'session_created', { orgId, hours: input.hours, selfReported: true });
    logger.info({ sessionId: session.id, userId }, 'self_reported_session_created');
    return session;
  }

  // ── Normal (verified) path ────────────────────────────────────────────────

  // 1. Normalize contact info
  let supervisorPhone: string | undefined;
  if (input.supervisorPhone) {
    const normalized = normalizePhone(input.supervisorPhone);
    if (!normalized) throw new AppError('invalid_phone', 'Supervisor phone number is not valid.', 400);
    supervisorPhone = normalized;
  }
  const supervisorEmail = input.supervisorEmail?.toLowerCase();

  // 2. Resolve org
  const orgId = await resolveOrCreateOrg({ orgId: input.orgId ?? undefined, newOrg: input.newOrg });
  if (!orgId) {
    // resolveOrCreateOrg should always return an id or throw, but never write a
    // supervisor session with a null org_id — it would orphan the row and break
    // org dashboards (sessions.org_id is nullable since migration 020).
    logger.error({ userId }, 'create_session_null_org');
    throw new AppError('org_required', 'A valid organization is required to log verified hours.', 400);
  }

  // 2b. Double-submit guard — return the just-created row instead of logging a
  // second identical session (which would also fire a second supervisor text).
  const dup = await findRecentDuplicate(userId, orgId, input.date, input.hours);
  if (dup) {
    logger.info({ sessionId: dup.id, userId }, 'session_deduped');
    return dup;
  }

  // 3. Resolve or create authenticator
  const authenticator = await resolveOrCreateAuthenticator({
    name: input.supervisorName ?? '',
    email: supervisorEmail,
    phone: supervisorPhone,
    orgId,
  });

  // 4. Fraud check
  const { score: fraudScore, flags: fraudFlags } = await calculateFraudScore({
    user_id: userId,
    org_id: orgId,
    date: input.date,
    hours: input.hours,
    supervisor_phone: supervisorPhone,
    supervisor_email: supervisorEmail,
  });

  // 5. Insert session
  // sendLater = log it now, hold the supervisor text. The row is "pending" but
  // verification_sent=false flags it as "Not sent yet" so the student can fire it
  // later from the By-organization dashboard.
  // We only set verification_sent on the deferred path; the send-now path relies on
  // the column DEFAULT (true). That keeps normal logging working even if migration
  // 040 hasn't been applied yet — only the new "send later" path needs the column.
  const sendNow = !input.sendLater;
  const insertRow: Record<string, any> = {
    user_id: userId,
    org_id: orgId,
    date: input.date,
    hours: input.hours,
    activity: sanitizeText(input.activity),
    supervisor_name: sanitizeText(input.supervisorName ?? ''),
    supervisor_phone: supervisorPhone ?? null,
    supervisor_email: supervisorEmail ?? null,
    authenticator_id: authenticator?.id ?? null,
    status: 'pending',
    self_reported: false,
    fraud_score: fraudScore,
    fraud_flags: fraudFlags,
  };
  if (!sendNow) insertRow.verification_sent = false;

  const { data: session, error } = await supabaseAdmin
    .from('sessions')
    .insert(insertRow)
    .select('*, org:organizations(id, name), authenticator:authenticators(id, name, tier)')
    .single();

  if (error || !session) {
    logger.error({ error, userId }, 'session_create_failed');
    throw new AppError('create_failed', 'Failed to create session.', 500);
  }

  if (!sendNow) {
    // Deferred: skip the send entirely. The student sends it later.
    trackEvent(userId, 'session_created', { orgId, hours: input.hours, fraudScore, deferred: true });
    return session;
  }

  // 6. Queue or send verifications
  // When Redis/BullMQ is available: jobs are queued for reliable async delivery.
  // When Redis is unavailable (REDIS_URL not set): send directly as fire-and-forget
  // so verification always fires regardless of queue infrastructure.
  if (fraudScore < 0.9) {
    const userForQueue = { id: userId, name: userName, plan: userPlan };

    if (supervisorPhone) {
      if (smsQueue) {
        await smsQueue.add('verification_sms', { type: 'verification_sms', session, user: userForQueue });
        logger.info({ sessionId: session.id, phone_suffix: supervisorPhone.slice(-4) }, 'sms_verification_queued');
      } else {
        // Direct send — no Redis configured
        logger.warn({ sessionId: session.id }, 'sms_queue_unavailable_sending_direct');
        sendVerificationSMS(session, userForQueue).catch((err: any) =>
          logger.error({ sessionId: session.id, err: err.message }, 'sms_direct_send_failed'),
        );
      }
    }

    if (supervisorEmail) {
      if (smsQueue) {
        await smsQueue.add('verification_email', { type: 'verification_email', session, user: userForQueue });
        logger.info({ sessionId: session.id, email_domain: supervisorEmail.split('@')[1] }, 'email_verification_queued');
      } else {
        // Direct send — no Redis configured
        logger.warn({ sessionId: session.id }, 'email_queue_unavailable_sending_direct');
        sendVerificationEmail(session, userForQueue).catch((err: any) =>
          logger.error({ sessionId: session.id, err: err.message }, 'email_direct_send_failed'),
        );
      }
    }
  } else {
    logger.warn({ sessionId: session.id, fraudScore, fraudFlags }, 'verification_skipped_high_fraud');
  }

  trackEvent(userId, 'session_created', { orgId, hours: input.hours, fraudScore });

  return session;
}

export async function updateSession(sessionId: string, userId: string, input: UpdateSessionInput) {
  const existing = await getSession(sessionId, userId);

  if (existing.status === 'verified') {
    throw new ForbiddenError('Verified sessions cannot be edited.');
  }

  const updates: Record<string, any> = {};
  if (input.activity) updates.activity = sanitizeText(input.activity);
  if (input.supervisorName) updates.supervisor_name = sanitizeText(input.supervisorName);
  if (input.supervisorPhone !== undefined) {
    const normalized = input.supervisorPhone ? normalizePhone(input.supervisorPhone) : null;
    if (input.supervisorPhone && !normalized) throw new AppError('invalid_phone', 'Phone number is not valid.', 400);
    updates.supervisor_phone = normalized;
  }
  if (input.supervisorEmail !== undefined) {
    updates.supervisor_email = input.supervisorEmail?.toLowerCase() ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from('sessions')
    .update(updates)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) throw new AppError('update_failed', 'Failed to update session.', 500);
  return data;
}

export async function deleteSession(sessionId: string, userId: string) {
  const existing = await getSession(sessionId, userId);
  if (!existing) throw new NotFoundError('Session');

  await supabaseAdmin
    .from('sessions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', userId);

  return { deleted: true };
}

export async function bulkDeleteSessions(sessionIds: string[], userId: string) {
  if (sessionIds.length === 0) throw new AppError('empty_ids', 'No session IDs provided.', 400);
  if (sessionIds.length > 50) throw new AppError('too_many_ids', 'Maximum 50 sessions per bulk delete.', 400);

  // Only touch sessions that belong to this user and are not already deleted
  const { data: owned, error: fetchError } = await supabaseAdmin
    .from('sessions')
    .select('id')
    .in('id', sessionIds)
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (fetchError) throw fetchError;
  if (!owned || owned.length === 0) throw new NotFoundError('Sessions');

  const ownedIds = owned.map((s: any) => s.id as string);

  const { error: updateError } = await supabaseAdmin
    .from('sessions')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', ownedIds)
    .eq('user_id', userId);

  if (updateError) throw new AppError('delete_failed', 'Failed to delete sessions.', 500);

  return { deleted: ownedIds.length };
}

export async function resendVerification(sessionId: string, userId: string, userPlan: string) {
  const session = await getSession(sessionId, userId);

  if (session.status === 'verified') {
    throw new AppError('already_verified', 'This session is already verified.', 409);
  }

  // Check reminder limit per plan
  const { data: verification } = await supabaseAdmin
    .from('verifications')
    .select('reminder_count')
    .eq('session_id', sessionId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const maxReminders = RESEND_LIMITS[userPlan] ?? 2;
  if ((verification?.reminder_count ?? 0) >= maxReminders) {
    throw new AppError(
      'reminder_limit_reached',
      `You've reached the reminder limit for your plan (${maxReminders}).`,
      429,
      { maxReminders, plan: userPlan },
    );
  }

  // Increment reminder count and log
  if (verification) {
    await supabaseAdmin
      .from('verifications')
      .update({ reminder_count: (verification.reminder_count ?? 0) + 1 })
      .eq('session_id', sessionId);
  }

  // Fetch sender's name for the verification message
  const { data: userData } = await supabaseAdmin
    .from('users')
    .select('name')
    .eq('id', userId)
    .single();

  const userForSend = { id: userId, name: userData?.name ?? 'Student', plan: userPlan };

  // Send via queue (if available) or direct fire-and-forget
  const supervisorPhone = session.supervisor_phone;
  const supervisorEmail = session.supervisor_email;

  if (supervisorPhone) {
    if (smsQueue) {
      await smsQueue.add('verification_sms', { type: 'verification_sms', session, user: userForSend });
      logger.info({ sessionId, phone_suffix: supervisorPhone.slice(-4) }, 'resend_sms_queued');
    } else {
      logger.warn({ sessionId }, 'sms_queue_unavailable_sending_direct');
      sendVerificationSMS(session, userForSend).catch((err: any) =>
        logger.error({ sessionId, err: err.message }, 'resend_sms_direct_send_failed'),
      );
    }
  }

  if (supervisorEmail) {
    if (smsQueue) {
      await smsQueue.add('verification_email', { type: 'verification_email', session, user: userForSend });
      logger.info({ sessionId, email_domain: supervisorEmail.split('@')[1] }, 'resend_email_queued');
    } else {
      logger.warn({ sessionId }, 'email_queue_unavailable_sending_direct');
      sendVerificationEmail(session, userForSend).catch((err: any) =>
        logger.error({ sessionId, err: err.message }, 'resend_email_direct_send_failed'),
      );
    }
  }

  logger.info({ sessionId, userId }, 'verification_resent');
  return { queued: true };
}

// ─── Batch send for deferred ("Not sent yet") sessions ───────────────────────
// Powers the By-organization dashboard's "Send all" / "Send selected" actions.
// Sends the FIRST supervisor text for sessions the student logged with "send
// later". Safety: the query can ONLY ever match rows that are pending, NOT
// self-reported, NOT already sent, and that actually carry a contact — so a
// self-tracked session is structurally incapable of being texted here, even if
// a bad sessionId were passed in.
export async function sendVerifications(
  userId: string,
  opts: { sessionIds?: string[]; orgId?: string },
  userPlan: string,
  userName = 'Student',
) {
  let query = supabaseAdmin
    .from('sessions')
    .select('*, org:organizations(id, name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('self_reported', false)
    .eq('verification_sent', false)
    .is('deleted_at', null);

  if (opts.sessionIds && opts.sessionIds.length > 0) query = query.in('id', opts.sessionIds);
  if (opts.orgId) query = query.eq('org_id', opts.orgId);

  const { data: rows, error } = await query;
  if (error) {
    logger.error({ error, userId }, 'send_verifications_query_failed');
    throw new AppError('query_failed', 'Could not load the sessions to send.', 500);
  }

  // Only rows that actually have somewhere to send (defence-in-depth — the
  // verified path always captures a contact, but never trust that here).
  const list = (rows ?? []).filter((s: any) => s.supervisor_phone || s.supervisor_email);
  if (list.length === 0) return { sent: 0, skipped: 0 };

  const userForSend = { id: userId, name: userName, plan: userPlan };
  let sent = 0;

  for (const session of list) {
    let didSend = false;

    if (session.supervisor_phone) {
      try {
        if (smsQueue) {
          await smsQueue.add('verification_sms', { type: 'verification_sms', session, user: userForSend });
        } else {
          await sendVerificationSMS(session, userForSend);
        }
        didSend = true;
      } catch (err: any) {
        logger.error({ sessionId: session.id, err: err?.message }, 'deferred_sms_send_failed');
      }
    }

    if (session.supervisor_email) {
      try {
        if (smsQueue) {
          await smsQueue.add('verification_email', { type: 'verification_email', session, user: userForSend });
        } else {
          await sendVerificationEmail(session, userForSend);
        }
        didSend = true;
      } catch (err: any) {
        logger.error({ sessionId: session.id, err: err?.message }, 'deferred_email_send_failed');
      }
    }

    if (didSend) {
      await supabaseAdmin
        .from('sessions')
        .update({ verification_sent: true })
        .eq('id', session.id)
        .eq('user_id', userId);
      sent += 1;
    }
  }

  logger.info({ userId, requested: list.length, sent }, 'deferred_verifications_sent');
  trackEvent(userId, 'verifications_batch_sent', { count: sent });
  return { sent, skipped: list.length - sent };
}

// ─── Share control: which sessions/orgs the student's school can see ─────────
// Student-only, scoped to their own rows. Toggle a whole org (orgId) or specific
// sessionIds. Only shared + verified hours count toward the chapter requirement and
// appear in the coordinator's dashboard/reports.
export async function setSessionsShared(
  userId: string,
  opts: { sessionIds?: string[]; orgId?: string; shared: boolean },
): Promise<{ updated: number }> {
  if ((!opts.sessionIds || opts.sessionIds.length === 0) && !opts.orgId) {
    throw new AppError('missing_target', 'Provide sessionIds or orgId.', 400);
  }
  let query = supabaseAdmin
    .from('sessions')
    .update({ shared_with_chapter: opts.shared })
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (opts.orgId) query = query.eq('org_id', opts.orgId);
  if (opts.sessionIds && opts.sessionIds.length > 0) query = query.in('id', opts.sessionIds);

  const { data, error } = await query.select('id');
  if (error) {
    logger.error({ error, userId }, 'set_sessions_shared_failed');
    throw new AppError('share_update_failed', 'Failed to update sharing.', 500);
  }
  trackEvent(userId, 'sessions_share_updated', { count: (data ?? []).length, shared: opts.shared });
  return { updated: (data ?? []).length };
}

// ─── Public verification lookup (no auth — limited fields) ────────────────

export async function getSessionForVerification(sessionId: string) {
  const { data: session, error } = await supabaseAdmin
    .from('sessions')
    .select(`
      id,
      date,
      hours,
      activity,
      status,
      verified_at,
      created_at,
      supervisor_name,
      users!sessions_user_id_fkey (
        name,
        school,
        grade
      ),
      organizations!sessions_org_id_fkey (
        name,
        city,
        category
      )
    `)
    .eq('id', sessionId)
    .is('deleted_at', null)
    .single();

  if (error || !session) return null;

  const s = session as any;
  return {
    id: s.id,
    date: s.date,
    hours: s.hours,
    activity: s.activity,
    status: s.status,
    verifiedAt: s.verified_at,
    supervisorName: s.supervisor_name,
    student: {
      name: s.users?.name ?? null,
      school: s.users?.school ?? null,
      grade: s.users?.grade ?? null,
    },
    organization: {
      name: s.organizations?.name ?? null,
      city: s.organizations?.city ?? null,
      category: s.organizations?.category ?? null,
    },
  };
}

// ─── Org-level public verification ──────────────────────────────────────────
// Aggregates ALL of a student's logged hours at a single organization. Powers
// the QR code on the exported PDF's per-org verification block. No auth — only
// non-sensitive fields are returned (no email/phone/user_id beyond the path).
export async function getOrgVerificationForUser(userId: string, orgId: string) {
  const { data: rows, error } = await supabaseAdmin
    .from('sessions')
    .select(`
      id,
      date,
      hours,
      activity,
      status,
      verified_at,
      supervisor_name,
      users!sessions_user_id_fkey ( name, school, grade ),
      organizations!sessions_org_id_fkey ( name, city, category )
    `)
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('date', { ascending: false });

  if (error || !rows || rows.length === 0) return null;

  const list = rows as any[];
  const first = list[0];

  const verified = list.filter((r) => r.status === 'verified');
  const pending = list.filter((r) => r.status === 'pending');
  const disputed = list.filter((r) => r.status === 'disputed');

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const verifiedHours = round1(verified.reduce((sum, r) => sum + Number(r.hours ?? 0), 0));
  const totalHours = round1(list.reduce((sum, r) => sum + Number(r.hours ?? 0), 0));

  const dates = list.map((r) => r.date).filter(Boolean).sort();

  return {
    student: {
      name: first.users?.name ?? null,
      school: first.users?.school ?? null,
      grade: first.users?.grade ?? null,
    },
    organization: {
      name: first.organizations?.name ?? null,
      city: first.organizations?.city ?? null,
      category: first.organizations?.category ?? null,
    },
    summary: {
      verifiedHours,
      totalHours,
      totalSessions: list.length,
      verifiedSessions: verified.length,
      pendingSessions: pending.length,
      disputedSessions: disputed.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
    },
    sessions: list.map((r) => ({
      id: r.id,
      date: r.date,
      hours: Number(r.hours ?? 0),
      activity: r.activity ?? null,
      status: r.status,
      verifiedAt: r.verified_at ?? null,
      supervisorName: r.supervisor_name ?? null,
    })),
  };
}
