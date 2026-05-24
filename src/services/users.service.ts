import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError } from '../lib/errors';
import { normalizePhone } from '../lib/phone';
import { logger } from '../lib/logger';
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

  if (input.name !== undefined) updates.name = input.name;
  if (input.school !== undefined) updates.school = input.school;
  if (input.grade !== undefined) updates.grade = input.grade;
  if (input.graduationYear !== undefined) updates.graduation_year = input.graduationYear;
  if (input.goalProgram !== undefined) updates.goal_program = input.goalProgram;
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
