import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { generateUrlSafeToken } from '../lib/crypto';
import { sendSms } from './twilio.service';
import { sendVerificationRequestEmail } from './resend.service';
import { trackEvent } from './analytics.service';
import { incrementAuthenticatorStats, determineVerificationTier, recalculateDomainTrust } from './trust.service';
import { formatVerificationSMS } from '../templates/sms/verification';
import { formatOptOutConfirm } from '../templates/sms/opt-out-confirm';
import { env } from '../config/env';

const SMS_LIMITS: Record<string, number> = { free: 3, pro: 15, premium: 999, institutional: 999 };

// ─── Send SMS verification ────────────────────────────────────────────────

export async function sendVerificationSMS(
  session: any,
  user: { id: string; name: string; plan: string },
) {
  if (!session.supervisor_phone) {
    throw new AppError('no_phone', 'Session has no supervisor phone number.', 400);
  }

  // 1. Check opt-out
  const { data: optedOut } = await supabaseAdmin
    .from('sms_opt_outs')
    .select('phone')
    .eq('phone', session.supervisor_phone)
    .maybeSingle();

  if (optedOut) {
    throw new AppError('supervisor_opted_out', 'This supervisor opted out of SMS. Use email verification instead.', 409);
  }

  // 2. Rate limit check
  const max = SMS_LIMITS[user.plan] ?? 3;
  const today = new Date().toISOString().split('T')[0];
  let rl: { count: number } | null = null;
  if (max < 999 && SUPABASE_MODE !== 'mock') {
    const { data } = await supabaseAdmin
      .from('rate_limits')
      .select('count')
      .eq('user_id', user.id)
      .eq('action', 'sms_send')
      .eq('date', today)
      .maybeSingle();
    rl = data;

    if ((rl?.count ?? 0) >= max) {
      throw new AppError('rate_limit_exceeded', `You've used your ${max} daily SMS verifications. Upgrade for more.`, 429, {
        limit: max, plan: user.plan,
      });
    }
  }

  // 3. Build and send message
  const org = session.org ?? { name: 'your organization' };
  const body = formatVerificationSMS({
    supervisorName: session.supervisor_name,
    studentName: user.name,
    hours: Number(session.hours),
    orgName: org.name,
    date: session.date,
  });

  const { sid } = await sendSms({ to: session.supervisor_phone, body });

  // 4. Record verification attempt
  await supabaseAdmin.from('verifications').insert({
    session_id: session.id,
    channel: 'sms',
    destination: session.supervisor_phone,
    twilio_sid: sid,
  });

  // 5. Increment rate limit
  if (SUPABASE_MODE !== 'mock') {
    await supabaseAdmin
      .from('rate_limits')
      .upsert({ user_id: user.id, action: 'sms_send', date: today, count: (rl?.count ?? 0) + 1 }, {
        onConflict: 'user_id,action,date',
      });
  }

  trackEvent(user.id, 'verification_sent', { sessionId: session.id, channel: 'sms' });
  return { sent: true, channel: 'sms' };
}

// ─── Send email magic-link verification ──────────────────────────────────

export async function sendVerificationEmail(
  session: any,
  user: { id: string; name: string; plan: string },
) {
  if (!session.supervisor_email) {
    throw new AppError('no_email', 'Session has no supervisor email address.', 400);
  }

  // Check opt-out
  const { data: optedOut } = await supabaseAdmin
    .from('email_opt_outs')
    .select('email')
    .eq('email_lower', session.supervisor_email.toLowerCase())
    .maybeSingle();

  if (optedOut) {
    throw new AppError('supervisor_opted_out', 'This supervisor opted out of email.', 409);
  }

  // Generate token
  const token = generateUrlSafeToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await supabaseAdmin.from('verifications').insert({
    session_id: session.id,
    channel: 'email',
    destination: session.supervisor_email,
    confirmation_token: token,
    token_expires_at: expiresAt.toISOString(),
  });

  const baseUrl = `${env.FRONTEND_URL ?? 'http://localhost:3000'}/verify?token=${token}`;
  const org = session.org ?? { name: 'your organization' };

  await sendVerificationRequestEmail({
    supervisorEmail: session.supervisor_email,
    supervisorName: session.supervisor_name,
    studentName: user.name,
    hours: Number(session.hours),
    orgName: org.name,
    date: session.date,
    verifyUrl: `${baseUrl}&response=YES`,
    disputeUrl: `${baseUrl}&response=NO`,
    unsubscribeUrl: `${baseUrl}&response=STOP`,
  });

  trackEvent(user.id, 'verification_sent', { sessionId: session.id, channel: 'email' });
  return { sent: true, channel: 'email' };
}

// ─── Get verifications for a session ─────────────────────────────────────

export async function getSessionVerifications(sessionId: string, userId: string) {
  // Verify session belongs to user
  const { data: session } = await supabaseAdmin
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!session) throw new NotFoundError('Session');

  const { data } = await supabaseAdmin
    .from('verifications')
    .select('*')
    .eq('session_id', sessionId)
    .order('sent_at', { ascending: false });

  return data ?? [];
}

// ─── Process verification response (magic link or webhook) ───────────────

export async function processVerificationResponse(opts: {
  token?: string;
  phone?: string;
  response: 'YES' | 'NO' | 'STOP';
}) {
  let verification: any;

  if (opts.token) {
    const { data } = await supabaseAdmin
      .from('verifications')
      .select('*, session:sessions(*, org:organizations(name), authenticator:authenticators(*))')
      .eq('confirmation_token', opts.token)
      .maybeSingle();

    if (!data) throw new AppError('invalid_token', 'Verification link is invalid or expired.', 400);
    if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
      throw new AppError('token_expired', 'Verification link has expired.', 400);
    }
    if (data.responded_at) throw new AppError('already_responded', 'This verification was already answered.', 409);
    verification = data;
  } else if (opts.phone) {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from('verifications')
      .select('*, session:sessions(*, org:organizations(name), authenticator:authenticators(*))')
      .eq('destination', opts.phone)
      .eq('channel', 'sms')
      .is('responded_at', null)
      .gte('sent_at', cutoff)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null; // No pending verification for this phone
    verification = data;
  }

  if (!verification) return null;

  const session = verification.session;
  const authenticator = session?.authenticator;
  const now = new Date().toISOString();
  const responseMethod = opts.token ? 'magic_link_click' : 'sms_reply';

  // Mark verification as responded
  await supabaseAdmin
    .from('verifications')
    .update({ responded_at: now, response: opts.response, response_method: responseMethod })
    .eq('id', verification.id);

  if (opts.response === 'STOP') {
    await handleOptOut(verification.destination, verification.channel);
    return { handled: 'opt_out' };
  }

  if (opts.response === 'YES') {
    const isWhitelisted = await checkWhitelisted(authenticator, session.user_id);
    const tier = authenticator
      ? determineVerificationTier(authenticator.tier, isWhitelisted)
      : 'verified_basic';

    await supabaseAdmin
      .from('sessions')
      .update({
        status: 'verified',
        verification_tier: tier,
        verified_at: now,
        verified_by: authenticator?.name ?? verification.destination,
      })
      .eq('id', session.id);

    if (authenticator) {
      await incrementAuthenticatorStats(authenticator.id, 'success', session.user_id);
      if (authenticator.email_domain) {
        await recalculateDomainTrust(authenticator.email_domain).catch(() => {});
      }
    }

    await createVerificationNotification(session.user_id, {
      type: 'verification_received',
      title: 'Hours verified',
      body: `${authenticator?.name ?? 'Your supervisor'} verified your ${session.hours} hours at ${session.org?.name ?? 'your org'}.`,
      sessionId: session.id,
    });

    return { handled: 'verified', tier };
  }

  if (opts.response === 'NO') {
    await supabaseAdmin
      .from('sessions')
      .update({ status: 'disputed', verified_at: now })
      .eq('id', session.id);

    if (authenticator) {
      await incrementAuthenticatorStats(authenticator.id, 'failure', session.user_id);
    }

    await createVerificationNotification(session.user_id, {
      type: 'verification_disputed',
      title: 'Hours disputed',
      body: `${authenticator?.name ?? 'Your supervisor'} disputed your hours at ${session.org?.name ?? 'your org'}.`,
      sessionId: session.id,
    });

    return { handled: 'disputed' };
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function handleOptOut(destination: string, channel: string) {
  if (channel === 'sms') {
    await supabaseAdmin
      .from('sms_opt_outs')
      .upsert({ phone: destination }, { onConflict: 'phone' });
  } else {
    await supabaseAdmin
      .from('email_opt_outs')
      .upsert({ email: destination }, { onConflict: 'email' });
  }
  logger.info({ destination, channel }, 'opt_out_recorded');
}

async function checkWhitelisted(authenticator: any, userId: string): Promise<boolean> {
  if (!authenticator) return false;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('chapter_id')
    .eq('id', userId)
    .maybeSingle();

  if (!user?.chapter_id) return false;

  // Match by email or phone within the chapter. Use parameterized .eq() (the value is sent
  // as a discrete query arg, not interpolated into a PostgREST filter string) so a crafted
  // email/phone can't inject extra filter clauses to widen the whitelist match.
  const email = authenticator.email ? String(authenticator.email).toLowerCase() : null;
  const phone = authenticator.phone ? String(authenticator.phone) : null;

  if (email) {
    const { data } = await supabaseAdmin
      .from('supervisor_whitelist')
      .select('id')
      .eq('chapter_id', user.chapter_id)
      .eq('email_lower', email)
      .maybeSingle();
    if (data) return true;
  }

  if (phone) {
    const { data } = await supabaseAdmin
      .from('supervisor_whitelist')
      .select('id')
      .eq('chapter_id', user.chapter_id)
      .eq('phone', phone)
      .maybeSingle();
    if (data) return true;
  }

  return false;
}

async function createVerificationNotification(
  userId: string,
  opts: { type: string; title: string; body: string; sessionId: string },
) {
  await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    action_url: `/sessions/${opts.sessionId}`,
  });
}
