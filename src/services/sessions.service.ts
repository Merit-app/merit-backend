import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import { normalizePhone } from '../lib/phone';
import { logger } from '../lib/logger';
import { resolveOrCreateAuthenticator } from './trust.service';
import { calculateFraudScore } from './fraud.service';
import { resolveOrCreateOrg } from './organizations.service';
import { trackEvent } from './analytics.service';
import { smsQueue } from '../queues/index';
import { sendVerificationSMS, sendVerificationEmail } from './verifications.service';
import type { CreateSessionInput, UpdateSessionInput } from '../schemas/sessions.schema';

const RESEND_LIMITS: Record<string, number> = { free: 2, pro: 5, premium: 999, institutional: 999 };

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

  // 3. Resolve or create authenticator
  const authenticator = await resolveOrCreateAuthenticator({
    name: input.supervisorName,
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
  const { data: session, error } = await supabaseAdmin
    .from('sessions')
    .insert({
      user_id: userId,
      org_id: orgId,
      date: input.date,
      hours: input.hours,
      activity: input.activity,
      supervisor_name: input.supervisorName,
      supervisor_phone: supervisorPhone ?? null,
      supervisor_email: supervisorEmail ?? null,
      authenticator_id: authenticator?.id ?? null,
      status: 'pending',
      fraud_score: fraudScore,
      fraud_flags: fraudFlags,
    })
    .select('*, org:organizations(id, name), authenticator:authenticators(id, name, tier)')
    .single();

  if (error || !session) {
    logger.error({ error, userId }, 'session_create_failed');
    throw new AppError('create_failed', 'Failed to create session.', 500);
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
        logger.info({ sessionId: session.id, phone: supervisorPhone }, 'sms_verification_queued');
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
        logger.info({ sessionId: session.id, email: supervisorEmail }, 'email_verification_queued');
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
  if (input.activity) updates.activity = input.activity;
  if (input.supervisorName) updates.supervisor_name = input.supervisorName;
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
      logger.info({ sessionId, phone: supervisorPhone }, 'resend_sms_queued');
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
      logger.info({ sessionId, email: supervisorEmail }, 'resend_email_queued');
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
