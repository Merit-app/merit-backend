import { supabaseAdmin } from '../config/supabase';
import { resendClient } from '../config/resend';
import { logger } from '../lib/logger';

export async function createInvite(params: {
  orgId: string;
  invitedBy: string;
  email: string;
  role: 'coordinator' | 'admin';
}) {
  const { orgId, invitedBy, email, role } = params;

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .single();

  if (!org) throw new Error('Organization not found');

  // Check if email belongs to an existing team member
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email_lower', email.toLowerCase())
    .maybeSingle();

  if (existingUser) {
    const { data: existing } = await supabaseAdmin
      .from('org_admins')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', existingUser.id)
      .maybeSingle();

    if (existing) throw new Error('Already a team member');
  }

  // Delete any pending invite for this email + org
  await supabaseAdmin
    .from('org_invites')
    .delete()
    .eq('org_id', orgId)
    .eq('email', email.toLowerCase());

  const { data: invite, error } = await supabaseAdmin
    .from('org_invites')
    .insert({
      org_id: orgId,
      invited_by: invitedBy,
      email: email.toLowerCase(),
      role,
    })
    .select('id, token')
    .single();

  if (error || !invite) throw error ?? new Error('Failed to create invite');

  const inviteUrl = `https://meritco.app/org/join?token=${invite.token}`;

  try {
    await resendClient.emails.send({
      from: 'Merit <hello@meritco.app>',
      to: email,
      subject: `You've been invited to manage ${org.name} on Merit`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
          <h2 style="color:#1a1a1a;">You're invited to ${org.name}</h2>
          <p>You've been added as a <strong>${role}</strong> for
             <strong>${org.name}</strong> on Merit.</p>
          <p>Merit helps organizations manage volunteers, run events,
             and generate reports for grant applications.</p>
          <a href="${inviteUrl}"
             style="display:inline-block;background:#1a1a1a;color:#fff;
                    padding:12px 24px;border-radius:8px;text-decoration:none;
                    font-weight:600;margin:16px 0;">
            Accept invitation →
          </a>
          <p style="font-size:12px;color:#666;">
            This link expires in 7 days. If you don't have a Merit account,
            you'll be asked to create one.
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="font-size:12px;color:#999;">Merit · meritco.app</p>
        </div>
      `,
    });
  } catch (err) {
    logger.error(err, 'invite_email_failed');
    // Non-fatal — invite was created, email failure is acceptable
  }

  return { inviteId: invite.id, email, role };
}

export async function getInviteByToken(token: string) {
  const { data, error } = await supabaseAdmin
    .from('org_invites')
    .select(`
      id, email, role, expires_at, accepted_at,
      organizations!org_invites_org_id_fkey (id, name, slug, logo_url)
    `)
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.accepted_at) return { ...data, alreadyAccepted: true };
  if (new Date(data.expires_at) < new Date()) return { ...data, expired: true };

  return data;
}

export async function acceptInvite(params: {
  token: string;
  userId: string;
}) {
  const { token, userId } = params;

  const invite = await getInviteByToken(token);
  if (!invite) throw new Error('Invalid invite');
  if ((invite as any).expired) throw new Error('Invite has expired');
  if ((invite as any).alreadyAccepted) throw new Error('Already accepted');

  const org = (invite as any).organizations;

  // Never downgrade an existing higher role. If the user is already a member with
  // an equal-or-higher role (e.g. an owner accepting an admin invite), keep it.
  const ROLE_RANK: Record<string, number> = { coordinator: 0, admin: 1, owner: 2 };
  const { data: existing } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', userId)
    .maybeSingle();

  const existingRank = existing ? (ROLE_RANK[existing.role] ?? -1) : -1;
  const inviteRank = ROLE_RANK[invite.role] ?? 0;
  const finalRole = existingRank > inviteRank ? existing!.role : invite.role;

  const { error: adminError } = await supabaseAdmin
    .from('org_admins')
    .upsert({ org_id: org.id, user_id: userId, role: finalRole }, { onConflict: 'org_id,user_id' });

  if (adminError) throw adminError;

  await supabaseAdmin
    .from('org_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('token', token);

  return { orgId: org.id, orgSlug: org.slug, role: finalRole };
}
