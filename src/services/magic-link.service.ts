import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../lib/errors';
import { generateUrlSafeToken } from '../lib/crypto';
import { sendEmail } from './resend.service';
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
    .select('id, session:sessions(id, user_id, hours, date, status, org:organizations(name), user:users(name))')
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

  await sendEmail({
    to: supervisorEmail,
    subject: 'Your Merit supervisor dashboard',
    html: `<p>Click below to view and manage all student verifications that need your response.</p>
           <p><a href="${dashUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Open my dashboard</a></p>
           <p style="font-size:12px;color:#666;margin-top:24px">This link expires in 24 hours. — Merit</p>`,
  });

  logger.info({ supervisorEmail }, 'supervisor_magic_link_sent');
  return { sent: true };
}

export async function verifySupervisorToken(token: string, response: 'YES' | 'NO' | 'STOP') {
  const { data: verification } = await supabaseAdmin
    .from('verifications')
    .select('*, session:sessions(*, org:organizations(name), user:users(name), authenticator:authenticators(*))')
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
