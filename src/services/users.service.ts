import DOMPurify from 'isomorphic-dompurify';
import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError } from '../lib/errors';
import { normalizePhone } from '../lib/phone';
import { logger } from '../lib/logger';

/** Strip all HTML/script tags from free-text user-supplied fields. */
function sanitizeText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
import { sendAccountDeletionEmail } from './resend.service';
import { trackEvent } from './analytics.service';
import { env } from '../config/env';
import type { UpdateUserInput } from '../schemas/users.schema';

export async function getUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*, chapter:chapters(id, name, type, logo_url, primary_color)')
    .eq('id', userId)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new NotFoundError('User');
  return data;
}

export async function updateUser(userId: string, input: UpdateUserInput) {
  const updates: Record<string, any> = {};

  if (input.name !== undefined) updates.name = input.name ? sanitizeText(input.name) : input.name;
  if (input.school !== undefined) updates.school = input.school ? sanitizeText(input.school) : input.school;
  if (input.grade !== undefined) updates.grade = input.grade;
  if (input.graduationYear !== undefined) updates.graduation_year = input.graduationYear;
  if (input.goalProgram !== undefined) {
    // Map frontend display values → DB-stored values (keep constraint-safe)
    const PROGRAM_MAP: Record<string, string> = {
      'IB CAS': 'IB',
      'Graduation': 'graduation',
      'Scholarship': 'scholarship',
      'Custom': 'personal',
      'NHS': 'NHS',
      'IB': 'IB',
      'personal': 'personal',
      'other': 'other',
    };
    updates.goal_program = input.goalProgram === null
      ? null
      : (PROGRAM_MAP[input.goalProgram] ?? input.goalProgram);
  }
  if (input.goalHours !== undefined) updates.goal_hours = input.goalHours;
  if (input.notifications !== undefined) updates.notifications = input.notifications;

  if (input.phone !== undefined) {
    if (input.phone === null) {
      updates.phone = null;
    } else {
      const normalized = normalizePhone(input.phone);
      if (!normalized) throw new AppError('invalid_phone', 'Phone number is not valid.', 400);
      updates.phone = normalized;
    }
  }

  // email changes are managed through Supabase auth flows — ignore here

  if (input.marketingConsent !== undefined) {
    updates.marketing_consent = input.marketingConsent;
    updates.marketing_consent_at = input.marketingConsent ? new Date().toISOString() : null;
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', userId)
    .is('deleted_at', null)
    .select()
    .single();

  if (error || !data) {
    logger.error({ error, userId }, 'user_update_failed');
    throw new AppError('update_failed', 'Failed to update profile.', 500);
  }

  return data;
}

export async function scheduleAccountDeletion(userId: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('name, email, deletion_scheduled_for')
    .eq('id', userId)
    .is('deleted_at', null)
    .single();

  if (!user) throw new NotFoundError('User');
  if (user.deletion_scheduled_for) {
    throw new AppError('deletion_already_scheduled', 'Account deletion is already scheduled.', 409);
  }

  const deletionDate = new Date();
  deletionDate.setDate(deletionDate.getDate() + 30);

  await supabaseAdmin
    .from('users')
    .update({
      deleted_at: new Date().toISOString(),
      deletion_scheduled_for: deletionDate.toISOString(),
    })
    .eq('id', userId);

  const cancelUrl = `${env.FRONTEND_URL ?? 'http://localhost:3000'}/account/cancel-deletion`;
  await sendAccountDeletionEmail({
    name: user.name,
    email: user.email,
    deletionDate: deletionDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    cancelUrl,
  });

  await supabaseAdmin.from('audit_log').insert({
    user_id: userId,
    action: 'account_deletion_requested',
  });

  trackEvent(userId, 'account_deletion_requested');

  return { scheduledFor: deletionDate.toISOString() };
}

export async function cancelAccountDeletion(userId: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('deletion_scheduled_for')
    .eq('id', userId)
    .single();

  if (!user?.deletion_scheduled_for) {
    throw new AppError('no_deletion_scheduled', 'No pending deletion to cancel.', 409);
  }

  await supabaseAdmin
    .from('users')
    .update({ deleted_at: null, deletion_scheduled_for: null })
    .eq('id', userId);

  await supabaseAdmin.from('audit_log').insert({
    user_id: userId,
    action: 'account_deletion_cancelled',
  });

  return { cancelled: true };
}

export async function updateUserNotifications(
  userId: string,
  prefs: {
    smsVerification?: boolean;
    weeklyProgress?: boolean;
    goalMilestones?: boolean;
    productUpdates?: boolean;
    marketingEmails?: boolean;
  },
) {
  // Fetch current prefs so we only overwrite what was explicitly sent
  const { data: current } = await supabaseAdmin
    .from('users')
    .select('notifications')
    .eq('id', userId)
    .is('deleted_at', null)
    .single();

  if (!current) throw new NotFoundError('User');

  const merged = { ...(current.notifications as object ?? {}), ...prefs };

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ notifications: merged })
    .eq('id', userId)
    .is('deleted_at', null)
    .select('notifications')
    .single();

  if (error || !data) throw new AppError('update_failed', 'Failed to update notification preferences.', 500);
  return data.notifications;
}

/**
 * Hard-deletes all data for a user whose scheduled deletion date has passed.
 * Explicitly deletes child rows in dependency order before removing the user and
 * auth record, so FK constraints are satisfied regardless of CASCADE config.
 */
export async function purgeExpiredAccounts(): Promise<{ purged: string[]; errors: Record<string, string> }> {
  const { data: expiredUsers } = await supabaseAdmin
    .from('users')
    .select('id')
    .not('deletion_scheduled_for', 'is', null)
    .lt('deletion_scheduled_for', new Date().toISOString());

  const purged: string[] = [];
  const errors: Record<string, string> = {};

  for (const user of expiredUsers ?? []) {
    try {
      // 1. Get session IDs so we can delete their verifications first
      const { data: sessions } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('user_id', user.id);
      const sessionIds = (sessions ?? []).map((s: any) => s.id as string);

      // 2. Explicit child-table deletes in dependency order
      if (sessionIds.length > 0) {
        await supabaseAdmin.from('verifications').delete().in('session_id', sessionIds);
      }
      await supabaseAdmin.from('sessions').delete().eq('user_id', user.id);
      await supabaseAdmin.from('notifications').delete().eq('user_id', user.id);
      await supabaseAdmin.from('audit_log').delete().eq('user_id', user.id);
      await supabaseAdmin.from('subscriptions').delete().eq('user_id', user.id);
      await supabaseAdmin.from('rate_limits').delete().eq('user_id', user.id);

      // 3. Delete Supabase auth user (this will also cascade the users row if FK is set)
      await supabaseAdmin.auth.admin.deleteUser(user.id);

      // 4. Delete app users row (in case FK isn't CASCADE)
      await supabaseAdmin.from('users').delete().eq('id', user.id);

      purged.push(user.id);
      logger.info({ userId: user.id }, 'account_purged');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors[user.id] = msg;
      logger.error({ userId: user.id, err: msg }, 'account_purge_failed');
    }
  }

  return { purged, errors };
}

export async function exportUserData(userId: string) {
  const [userRes, sessionsRes, verificationsRes, notificationsRes, subscriptionsRes] = await Promise.all([
    supabaseAdmin.from('users').select('*').eq('id', userId).single(),
    supabaseAdmin.from('sessions').select('*, org:organizations(name)').eq('user_id', userId),
    supabaseAdmin
      .from('verifications')
      .select('*')
      .in(
        'session_id',
        (await supabaseAdmin.from('sessions').select('id').eq('user_id', userId)).data?.map((s: any) => s.id) ?? [],
      ),
    supabaseAdmin.from('notifications').select('*').eq('user_id', userId),
    supabaseAdmin.from('subscriptions').select('*').eq('user_id', userId),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    user: userRes.data,
    sessions: sessionsRes.data ?? [],
    verifications: verificationsRes.data ?? [],
    notifications: notificationsRes.data ?? [],
    subscriptions: subscriptionsRes.data ?? [],
  };
}
