import { supabaseAdmin } from '../config/supabase';
import { sendEmail } from './resend.service';
import { logger } from '../lib/logger';
import { env } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClaimRole =
  | 'employee'
  | 'coordinator'
  | 'owner'
  | 'board_member'
  | 'other';

// Must match the status check constraint in 009_profiles_and_orgs.sql:
// ('pending', 'verified', 'approved', 'rejected', 'expired')
export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'expired';

// ─── Submit a new org claim ───────────────────────────────────────────────────

export async function submitOrgClaim(params: {
  userId: string;
  orgId: string;
  role: ClaimRole;
  workEmail: string;
}): Promise<{ claimId: string; status: ClaimStatus; autoApproved: boolean }> {
  const { userId, orgId, role, workEmail } = params;

  // 1. Load org
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, claimed, website_url, contact_email')
    .eq('id', orgId)
    .single();

  if (orgError || !org) throw new Error('Organization not found');
  if (org.claimed) throw new Error('This organization has already been claimed');

  // 2. Check for an existing pending claim by this user
  const { data: existingClaim } = await supabaseAdmin
    .from('org_claims')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (existingClaim) throw new Error('You already have a pending claim for this organization');

  // 3. Domain matching
  const emailDomain = workEmail.split('@')[1]?.toLowerCase() ?? '';

  let orgDomain: string | null = null;
  if (org.website_url) {
    try {
      const raw = org.website_url.startsWith('http') ? org.website_url : `https://${org.website_url}`;
      orgDomain = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      orgDomain = null;
    }
  }

  const contactDomain = org.contact_email?.split('@')[1]?.toLowerCase() ?? null;
  const domainMatch = !!(orgDomain && (emailDomain === orgDomain || emailDomain === contactDomain));
  const status: ClaimStatus = domainMatch ? 'approved' : 'pending';

  // 4. Insert claim
  // Column names in org_claims: email, email_domain (not work_email/work_email_domain)
  const { data: claim, error: claimError } = await supabaseAdmin
    .from('org_claims')
    .insert({
      org_id: orgId,
      user_id: userId,
      role,
      email: workEmail,
      email_domain: emailDomain,
      status,
      verification_token: crypto.randomUUID(),
      domain_matched: domainMatch,
      reviewed_at: domainMatch ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  if (claimError || !claim) {
    logger.error(claimError, 'failed_to_insert_org_claim');
    throw new Error('Failed to submit claim');
  }

  // 5. Auto-approve path: mark org as claimed + add org admin row
  if (domainMatch) {
    await Promise.all([
      supabaseAdmin
        .from('organizations')
        .update({ claimed: true, claimed_at: new Date().toISOString() })
        .eq('id', orgId),
      supabaseAdmin
        .from('org_admins')
        .insert({ org_id: orgId, user_id: userId, role }),
    ]);

    await sendClaimApprovedEmail({ to: workEmail, orgName: org.name, orgSlug: org.slug ?? '' });
  } else {
    // Manual-review path: notify claimant + admin
    await sendClaimUnderReviewEmail({ to: workEmail, orgName: org.name });
    await sendClaimAdminNotificationEmail({ claimId: claim.id, orgName: org.name, workEmail, role });
  }

  return { claimId: claim.id, status, autoApproved: domainMatch };
}

// ─── Get claim status for a user + org ───────────────────────────────────────

export async function getClaimStatus(params: {
  userId: string;
  orgId: string;
}): Promise<ClaimStatus | null> {
  const { data } = await supabaseAdmin
    .from('org_claims')
    .select('status')
    .eq('org_id', params.orgId)
    .eq('user_id', params.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.status as ClaimStatus) ?? null;
}

// ─── Admin: approve a pending claim ──────────────────────────────────────────

export async function approveClaim(claimId: string): Promise<void> {
  const { data: claim, error } = await supabaseAdmin
    .from('org_claims')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', claimId)
    .select('org_id, user_id, role, email')
    .single();

  if (error || !claim) throw new Error('Claim not found');

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .update({ claimed: true, claimed_at: new Date().toISOString() })
    .eq('id', claim.org_id)
    .select('name, slug')
    .single();

  await supabaseAdmin
    .from('org_admins')
    .insert({ org_id: claim.org_id, user_id: claim.user_id, role: claim.role });

  if (org) {
    await sendClaimApprovedEmail({ to: claim.email, orgName: org.name, orgSlug: org.slug ?? '' });
  }
}

// ─── Admin: reject a pending claim ───────────────────────────────────────────

export async function rejectClaim(claimId: string, reason?: string): Promise<void> {
  const { data: claim, error } = await supabaseAdmin
    .from('org_claims')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      rejected_reason: reason ?? null,
    })
    .eq('id', claimId)
    .select('email, org_id')
    .single();

  if (error || !claim) throw new Error('Claim not found');

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', claim.org_id)
    .single();

  await sendClaimRejectedEmail({ to: claim.email, orgName: org?.name ?? 'the organization', reason });
}

// ─── Email helpers ────────────────────────────────────────────────────────────

async function sendClaimApprovedEmail(p: { to: string; orgName: string; orgSlug: string }) {
  await sendEmail({
    to: p.to,
    subject: `You're now an admin of ${p.orgName} on Merit`,
    html: `
      <p>Your claim for <strong>${p.orgName}</strong> has been approved.</p>
      <p>You can now manage your organization's page on Merit.</p>
      <p><a href="https://meritco.app/organizations/${p.orgSlug}">View your org page →</a></p>
      <p style="color:#6B7280;font-size:12px;">Merit · meritco.app</p>
    `,
  }).catch((err) => logger.error(err, 'claim_approved_email_failed'));
}

async function sendClaimUnderReviewEmail(p: { to: string; orgName: string }) {
  await sendEmail({
    to: p.to,
    subject: `Your claim for ${p.orgName} is under review`,
    html: `
      <p>Thanks for claiming <strong>${p.orgName}</strong> on Merit.</p>
      <p>We couldn't automatically verify your email domain, so your claim is being reviewed manually.
         We'll get back to you within 2 business days.</p>
      <p style="color:#6B7280;font-size:12px;">Merit · meritco.app</p>
    `,
  }).catch((err) => logger.error(err, 'claim_review_email_failed'));
}

async function sendClaimAdminNotificationEmail(p: {
  claimId: string;
  orgName: string;
  workEmail: string;
  role: string;
}) {
  const adminEmail = env.ADMIN_EMAIL ?? 'kai@meritco.app';
  await sendEmail({
    to: adminEmail,
    subject: `New org claim needs review: ${p.orgName}`,
    html: `
      <p>A new org claim requires manual review.</p>
      <ul>
        <li><strong>Org:</strong> ${p.orgName}</li>
        <li><strong>Work Email:</strong> ${p.workEmail}</li>
        <li><strong>Role:</strong> ${p.role}</li>
        <li><strong>Claim ID:</strong> ${p.claimId}</li>
      </ul>
    `,
  }).catch((err) => logger.error(err, 'claim_admin_notification_failed'));
}

async function sendClaimRejectedEmail(p: { to: string; orgName: string; reason?: string }) {
  await sendEmail({
    to: p.to,
    subject: `Update on your claim for ${p.orgName}`,
    html: `
      <p>Unfortunately, we were unable to approve your claim for <strong>${p.orgName}</strong>.</p>
      ${p.reason ? `<p>Reason: ${p.reason}</p>` : ''}
      <p>If you think this is a mistake, reply to this email.</p>
      <p style="color:#6B7280;font-size:12px;">Merit · meritco.app</p>
    `,
  }).catch((err) => logger.error(err, 'claim_rejected_email_failed'));
}
