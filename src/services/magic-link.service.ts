import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../lib/errors';
import { generateUrlSafeToken } from '../lib/crypto';
import { sendSupervisorMagicLinkEmail } from './resend.service';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export async function sendSupervisorMagicLink(supervisorEmail: string) {
  // Check opt-out
  const { data: optedOut } = await supabaseAdmin
    .from('email_opt_outs')
    .select('email')
    .eq('email_lower', supervisorEmail.toLowerCase())
    .maybeSingle();

  if (optedOut) throw new AppError('opted_out', 'This email has opted out of Merit communications.', 409);

  // Find all recent unverified sessions for this supervisor
  const { data: verifications } = await supabaseAdmin
    .from('verifications')
    .select('id, session:sessions(id, user_id, hours, date, status, org:organizations(name), user:users!user_id(name))')
    .eq('destination', supervisorEmail.toLowerCase())
    .eq('channel', 'email')
    .is('responded_at', null)
    .order('sent_at', { ascending: false })
    .limit(10);

  if (!verifications?.length) {
    // Return silently — don't reveal whether email is known
    return { sent: true };
  }

  const token = generateUrlSafeToken(32);
  const dashUrl = `${env.FRONTEND_URL ?? 'http://localhost:3000'}/supervisor/dashboard?token=${token}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Store token on the most recent pending verification
  await supabaseAdmin
    .from('verifications')
    .update({ confirmation_token: token, token_expires_at: expiresAt })
    .eq('id', verifications[0].id);

  await sendSupervisorMagicLinkEmail({
    supervisorEmail,
    pendingCount: verifications.length,
    dashUrl,
  });

  logger.info({ email_domain: supervisorEmail.split('@')[1] }, 'supervisor_magic_link_sent');
  return { sent: true };
}

export async function verifySupervisorToken(token: string, response: 'YES' | 'NO' | 'STOP') {
  const { data: verification } = await supabaseAdmin
    .from('verifications')
    .select('*, session:sessions(*, org:organizations(name), user:users!user_id(name), authenticator:authenticators(*))')
    .eq('confirmation_token', token)
    .maybeSingle();

  if (!verification) throw new AppError('invalid_token', 'Link is invalid or expired.', 400);
  if (verification.token_expires_at && new Date(verification.token_expires_at) < new Date()) {
    throw new AppError('token_expired', 'This link has expired.', 400);
  }

  // Import here to avoid circular dependency
  const { processVerificationResponse } = await import('./verifications.service');
  return processVerificationResponse({ token, response });
}
