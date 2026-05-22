import { supabaseAdmin, supabaseAuth, SUPABASE_MODE } from '../config/supabase';
import { AppError, UnauthorizedError } from '../lib/errors';
import { checkPasswordStrength } from '../lib/password';
import { generateUrlSafeToken } from '../lib/crypto';
import { signPayload, verifyPayload } from '../lib/jwt';
import { logger } from '../lib/logger';
import { env } from '../config/env';
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendParentalConsentEmail,
  sendAccountDeletionEmail,
} from './resend.service';
import { trackEvent } from './analytics.service';

// ─── Age helpers ───────────────────────────────────────────────────────────

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function getAgeTier(age: number): 'under_13' | 'minor' | 'adult' {
  if (age < 13) return 'under_13';
  if (age < 18) return 'minor';
  return 'adult';
}

// ─── Signup ────────────────────────────────────────────────────────────────

export async function signup(input: {
  email: string;
  password: string;
  name: string;
  dateOfBirth: string;
  school?: string;
  grade?: number;
  goalProgram?: string;
  goalHours?: number;
  marketingConsent?: boolean;
  parentEmail?: string;
}) {
  // 1. Age check
  const age = calculateAge(input.dateOfBirth);
  const ageTier = getAgeTier(age);

  if (ageTier === 'under_13') {
    throw new AppError('age_restricted', 'Users must be 13 or older to use Merit.', 403);
  }

  if (ageTier === 'minor' && !input.parentEmail) {
    throw new AppError('parental_email_required', 'A parent or guardian email is required for users under 18.', 400);
  }

  // 2. Password strength
  const strength = await checkPasswordStrength(input.password, [input.email, input.name]);
  if (!strength.isStrong) {
    throw new AppError('weak_password', 'Password is too weak. Choose something harder to guess.', 400, {
      score: strength.score,
      feedback: strength.feedback,
    });
  }

  if (input.password.toLowerCase() === input.email.toLowerCase()) {
    throw new AppError('weak_password', 'Password cannot be the same as your email.', 400);
  }

  // 3. Check email not already in use
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email_lower', input.email.toLowerCase())
    .maybeSingle();

  if (existingUser) {
    throw new AppError('email_taken', 'An account with this email already exists.', 409);
  }

  // 4. Create Supabase auth user.
  //    In mock mode: use the mock client so tests pass without a network call.
  //    In real mode: bypass @supabase/auth-js with a raw GoTrue HTTP call to avoid
  //    URL-construction bugs in the SDK on Railway. Uses the same SUPABASE_URL +
  //    SERVICE_ROLE_KEY that DB operations already confirm works.
  let authUserId: string;

  if (SUPABASE_MODE === 'mock') {
    const { data: mockAuthData, error: mockAuthError } = await supabaseAdmin.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name } },
    });
    if (mockAuthError || !mockAuthData?.user) {
      throw new AppError('signup_failed', mockAuthError?.message ?? 'Failed to create account.', 500);
    }
    authUserId = mockAuthData.user.id;
  } else {
    const gotrueUrl = `${env.SUPABASE_URL}/auth/v1/admin/users`;
    const gotrueRes = await fetch(gotrueUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { name: input.name },
      }),
    });
    const gotrueBody = await gotrueRes.json() as any;
    if (!gotrueRes.ok || !gotrueBody?.id) {
      logger.error({ status: gotrueRes.status, body: gotrueBody, url: gotrueUrl }, 'supabase_signup_failed');
      throw new AppError('signup_failed', gotrueBody?.msg ?? gotrueBody?.message ?? 'Failed to create account.', 500);
    }
    authUserId = gotrueBody.id as string;
  }

  // 5. Insert app user row
  const { data: appUser, error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      id: authUserId,
      email: input.email,
      name: input.name,
      age_tier: ageTier,
      date_of_birth: input.dateOfBirth,
      school: input.school ?? null,
      grade: input.grade ?? null,
      goal_program: input.goalProgram ?? null,
      goal_hours: input.goalHours ?? 75,
      is_minor: ageTier === 'minor',
      marketing_consent: input.marketingConsent ?? false,
      marketing_consent_at: input.marketingConsent ? new Date().toISOString() : null,
      parental_consent_email: input.parentEmail ?? null,
    })
    .select()
    .single();

  if (insertError || !appUser) {
    logger.error({ insertError }, 'user_row_insert_failed');
    // Best-effort cleanup
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    throw new AppError('signup_failed', 'Failed to create user profile.', 500);
  }

  // 6. Send emails
  const confirmationUrl = `${env.FRONTEND_URL ?? 'http://localhost:3000'}/auth/confirm`;
  await sendWelcomeEmail({ name: input.name, email: input.email, confirmationUrl });

  if (ageTier === 'minor' && input.parentEmail) {
    const consentToken = signPayload({ userId: appUser.id, type: 'parental_consent' }, env.MAGIC_LINK_SECRET, 7 * 24 * 3600);
    const consentUrl = `${env.FRONTEND_URL ?? 'http://localhost:3000'}/parental-consent?token=${consentToken}`;
    await sendParentalConsentEmail({
      parentEmail: input.parentEmail,
      studentName: input.name,
      consentUrl,
    });
  }

  // 7. Analytics
  trackEvent(appUser.id, 'signup', { ageTier, goalProgram: input.goalProgram, plan: 'free' });

  return {
    user: appUser,
    requiresEmailConfirmation: true,
    requiresParentalConsent: ageTier === 'minor',
  };
}

// ─── Login ─────────────────────────────────────────────────────────────────

export async function login(input: { email: string; password: string; ip?: string }) {
  if (SUPABASE_MODE === 'mock') {
    return {
      user: { id: 'mock-user', email: input.email, plan: 'free', role: 'student' },
      session: { accessToken: 'mock-token', refreshToken: 'mock-refresh', expiresAt: Date.now() + 3600000 },
    };
  }

  // 1. Load user to check lock
  const { data: appUser } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email_lower', input.email.toLowerCase())
    .is('deleted_at', null)
    .maybeSingle();

  if (appUser?.account_locked_until) {
    const lockedUntil = new Date(appUser.account_locked_until);
    if (lockedUntil > new Date()) {
      throw new AppError('account_locked', `Account locked until ${lockedUntil.toISOString()}`, 423, {
        lockedUntil: lockedUntil.toISOString(),
      });
    }
  }

  // 2. Attempt sign in
  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error || !data.user) {
    // Increment failed attempts
    if (appUser) {
      const attempts = (appUser.failed_login_attempts ?? 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await supabaseAdmin
        .from('users')
        .update({
          failed_login_attempts: attempts,
          account_locked_until: lockUntil,
        })
        .eq('id', appUser.id);

      logger.warn({ userId: appUser.id, attempts, lockUntil }, 'login_failed');
    }
    throw new UnauthorizedError('Invalid email or password.');
  }

  // 3. Reset failed attempts
  if (appUser) {
    await supabaseAdmin
      .from('users')
      .update({ failed_login_attempts: 0, account_locked_until: null })
      .eq('id', appUser.id);
  }

  // 4. Write audit log
  await supabaseAdmin.from('audit_log').insert({
    user_id: data.user.id,
    action: 'login',
    ip_address: input.ip ?? null,
  });

  trackEvent(data.user.id, 'login');

  return {
    user: appUser ?? data.user,
    session: {
      accessToken: data.session!.access_token,
      refreshToken: data.session!.refresh_token,
      expiresAt: data.session!.expires_at,
    },
  };
}

// ─── Refresh ───────────────────────────────────────────────────────────────

export async function refreshSession(refreshToken: string) {
  if (SUPABASE_MODE === 'mock') {
    return { accessToken: 'mock-token', refreshToken, expiresAt: Date.now() + 3600000 };
  }

  const { data, error } = await (supabaseAuth.auth as any).refreshSession?.({ refresh_token: refreshToken })
    ?? { data: null, error: new Error('refresh not supported in this mode') };

  if (error || !data?.session) {
    throw new UnauthorizedError('Invalid or expired refresh token.');
  }

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  };
}

// ─── Password reset ────────────────────────────────────────────────────────

export async function requestPasswordReset(email: string, ip?: string) {
  // Always return 200 — don't leak whether email exists
  if (SUPABASE_MODE === 'mock') return;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, name')
    .eq('email_lower', email.toLowerCase())
    .is('deleted_at', null)
    .maybeSingle();

  if (!user) return; // Silent — don't reveal existence

  const resetUrl = `${env.FRONTEND_URL ?? 'http://localhost:3000'}/auth/reset-password`;

  // Supabase sends the reset email; we also send our branded one
  await (supabaseAdmin.auth as any).resetPasswordForEmail?.(email, {
    redirectTo: resetUrl,
  });

  await sendPasswordResetEmail({
    name: user.name,
    email,
    resetUrl,
    ipAddress: ip ?? 'unknown',
  });

  await supabaseAdmin.from('audit_log').insert({
    user_id: user.id,
    action: 'password_reset_requested',
    ip_address: ip ?? null,
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const strength = await checkPasswordStrength(newPassword);
  if (!strength.isStrong) {
    throw new AppError('weak_password', 'New password is too weak.', 400, { score: strength.score });
  }

  if (SUPABASE_MODE === 'mock') return;

  const { error } = await (supabaseAdmin.auth as any).updateUser?.({ password: newPassword });
  if (error) throw new AppError('reset_failed', 'Failed to reset password.', 400);
}

// ─── Email confirmation ────────────────────────────────────────────────────

export async function confirmEmail(token: string) {
  if (SUPABASE_MODE === 'mock') return;

  const { error } = await (supabaseAdmin.auth as any).verifyOtp?.({ token_hash: token, type: 'email' });
  if (error) throw new AppError('invalid_token', 'Confirmation link is invalid or expired.', 400);
}

export async function resendConfirmation(email: string) {
  if (SUPABASE_MODE === 'mock') return;

  await (supabaseAdmin.auth as any).resend?.({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${env.FRONTEND_URL ?? 'http://localhost:3000'}/auth/confirm` },
  });
}

// ─── Parental consent ──────────────────────────────────────────────────────

export async function processParentalConsent(opts: {
  token: string;
  consent: boolean;
  parentName: string;
}) {
  const payload = verifyPayload<{ userId: string; type: string }>(opts.token, env.MAGIC_LINK_SECRET);
  if (!payload || payload.type !== 'parental_consent') {
    throw new AppError('invalid_token', 'Consent link is invalid or expired.', 400);
  }

  await supabaseAdmin
    .from('users')
    .update({
      parental_consent_received: opts.consent,
      parental_consent_at: opts.consent ? new Date().toISOString() : null,
    })
    .eq('id', payload.userId);

  return { userId: payload.userId, consent: opts.consent };
}

// ─── Get current user ──────────────────────────────────────────────────────

export async function getMe(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*, chapter:chapters!fk_users_chapter(id, name, type, logo_url)')
    .eq('id', userId)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new AppError('not_found', 'User not found.', 404);
  return data;
}
