import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { AppError, NotFoundError } from '../lib/errors';
import { generateUrlSafeToken } from '../lib/crypto';
import { sendEmail } from './resend.service';
import { logger } from '../lib/logger';
import DOMPurify from 'isomorphic-dompurify';

function clean(s: string | undefined | null, max = 500): string {
  if (!s) return '';
  return DOMPurify.sanitize(String(s), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).slice(0, max);
}

const FRONTEND = (env.FRONTEND_URL ?? 'https://meritco.app').replace(/\/+$/, '');

// ─── Lead capture ──────────────────────────────────────────────────────────────

export interface SchoolLeadInput {
  schoolName: string;
  coordinatorName: string;
  email: string;
  role?: string;
  studentCount?: number;
  note?: string;
}

export async function submitLead(input: SchoolLeadInput) {
  const row = {
    school_name: clean(input.schoolName, 200),
    coordinator_name: clean(input.coordinatorName, 120),
    email: clean(input.email, 200).toLowerCase(),
    role: clean(input.role, 120) || null,
    student_count:
      input.studentCount != null && Number.isFinite(Number(input.studentCount))
        ? Math.max(0, Math.trunc(Number(input.studentCount)))
        : null,
    note: clean(input.note, 1000) || null,
  };

  if (!row.school_name || !row.coordinator_name || !row.email.includes('@')) {
    throw new AppError('invalid_lead', 'Please provide a valid school, name, and email.', 400);
  }

  const { data, error } = await supabaseAdmin
    .from('school_leads')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    logger.error({ error }, 'school_lead_insert_failed');
    throw new AppError('lead_failed', 'Could not submit your request. Please try again.', 500);
  }

  // Notify the platform admin (fire-and-forget; never blocks the response).
  const adminEmail = env.ADMIN_EMAIL;
  if (adminEmail) {
    void sendEmail({
      to: adminEmail,
      subject: `New school lead: ${row.school_name}`,
      html: `
        <h2>New school early-access request</h2>
        <p><strong>School:</strong> ${row.school_name}</p>
        <p><strong>Coordinator:</strong> ${row.coordinator_name} (${row.role || 'role not given'})</p>
        <p><strong>Email:</strong> ${row.email}</p>
        <p><strong>Students:</strong> ${row.student_count ?? 'not given'}</p>
        <p><strong>Note:</strong> ${row.note || '—'}</p>
        <p>Review &amp; approve in the admin panel: <a href="${FRONTEND}/admin/schools">${FRONTEND}/admin/schools</a></p>
      `,
    });
  }

  return { id: (data as any).id, status: 'pending' };
}

// ─── Admin: review leads ────────────────────────────────────────────────────────

export async function listLeads(status?: string) {
  let query = supabaseAdmin
    .from('school_leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    query = query.eq('status', status);
  }
  const { data } = await query;
  return (data as any[] | null) ?? [];
}

export async function rejectLead(leadId: string) {
  const { error } = await supabaseAdmin
    .from('school_leads')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) throw new AppError('reject_failed', 'Failed to reject lead.', 500);
  return { status: 'rejected' };
}

// ─── Admin: provision a chapter (the "approve" action) ──────────────────────────

export interface ProvisionInput {
  leadId?: string;
  schoolName: string;
  coordinatorEmail: string;
  coordinatorName?: string;
  maxMembers?: number;
  requiredHours?: number;
}

export async function provisionChapter(input: ProvisionInput) {
  const schoolName = clean(input.schoolName, 200);
  const coordinatorEmail = clean(input.coordinatorEmail, 200).toLowerCase();
  if (!schoolName || !coordinatorEmail.includes('@')) {
    throw new AppError('invalid_input', 'School name and a valid coordinator email are required.', 400);
  }

  const claimToken = generateUrlSafeToken(32);
  const claimExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: chapter, error } = await supabaseAdmin
    .from('chapters')
    .insert({
      name: schoolName,
      active: true,
      max_members: input.maxMembers != null ? Math.max(1, Math.trunc(input.maxMembers)) : 500,
      required_hours: input.requiredHours != null ? Math.max(0, Math.trunc(input.requiredHours)) : 0,
      pending_coordinator_email: coordinatorEmail,
      claim_token: claimToken,
      claim_token_expires: claimExpires,
    })
    .select('id')
    .single();

  if (error || !chapter) {
    logger.error({ error }, 'chapter_provision_failed');
    throw new AppError('provision_failed', 'Failed to create chapter.', 500);
  }

  const chapterId = (chapter as any).id;

  // Link the lead → chapter and mark approved.
  if (input.leadId) {
    await supabaseAdmin
      .from('school_leads')
      .update({ status: 'approved', chapter_id: chapterId, reviewed_at: new Date().toISOString() })
      .eq('id', input.leadId);
  }

  const claimUrl = `${FRONTEND}/claim?token=${claimToken}`;
  void sendEmail({
    to: coordinatorEmail,
    subject: `Your Merit chapter for ${schoolName} is ready`,
    html: `
      <h2>Welcome to Merit, ${clean(input.coordinatorName, 120) || 'there'}!</h2>
      <p>We've set up a Merit chapter for <strong>${schoolName}</strong>.</p>
      <p>Click below to claim it and start adding your students. If you don't have a Merit
      account yet, you'll be able to create one first — just use this same email address
      (<strong>${coordinatorEmail}</strong>).</p>
      <p><a href="${claimUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Claim your chapter</a></p>
      <p style="color:#666;font-size:13px">This link expires in 30 days and only works for ${coordinatorEmail}.</p>
    `,
  });

  logger.info({ chapterId, coordinatorEmail }, 'chapter_provisioned');
  return { chapterId, status: 'approved' };
}

// ─── Coordinator: claim a provisioned chapter ───────────────────────────────────

export async function claimChapter(token: string, userId: string, userEmail: string | undefined) {
  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('id, name, claim_token_expires, pending_coordinator_email, primary_coordinator_id')
    .eq('claim_token', token)
    .maybeSingle();

  const c = chapter as any;
  if (!c) throw new AppError('invalid_token', 'This claim link is invalid or has already been used.', 400);
  if (c.primary_coordinator_id) throw new AppError('already_claimed', 'This chapter has already been claimed.', 409);
  if (c.claim_token_expires && new Date(c.claim_token_expires) < new Date()) {
    throw new AppError('expired', 'This claim link has expired. Ask your Merit contact to re-send it.', 400);
  }

  // Email-locked: the signed-in user must match the approved coordinator email.
  if (
    c.pending_coordinator_email &&
    (userEmail ?? '').toLowerCase() !== (c.pending_coordinator_email as string).toLowerCase()
  ) {
    throw new AppError(
      'email_mismatch',
      `This chapter was assigned to ${c.pending_coordinator_email}. Please sign in with that email to claim it.`,
      403,
    );
  }

  const { error } = await supabaseAdmin
    .from('chapters')
    .update({
      primary_coordinator_id: userId,
      claim_token: null,
      claim_token_expires: null,
      pending_coordinator_email: null,
    })
    .eq('id', c.id);

  if (error) {
    logger.error({ error, chapterId: c.id }, 'chapter_claim_failed');
    throw new AppError('claim_failed', 'Failed to claim chapter. Please try again.', 500);
  }

  logger.info({ chapterId: c.id, userId }, 'chapter_claimed');
  return { chapterId: c.id, name: c.name };
}

// ─── Roster invite emails ───────────────────────────────────────────────────────

/** Send chapter-roster invite emails. Best-effort; failures are swallowed per-recipient. */
export async function sendRosterInviteEmails(
  chapterName: string,
  invites: { email: string; name: string; inviteToken: string }[],
): Promise<void> {
  for (const inv of invites) {
    const joinUrl = `${FRONTEND}/invite?token=${inv.inviteToken}`;
    void sendEmail({
      to: inv.email,
      subject: `You've been added to ${chapterName} on Merit`,
      html: `
        <h2>Hi ${clean(inv.name, 120) || 'there'},</h2>
        <p>Your coordinator added you to <strong>${clean(chapterName, 200)}</strong> on Merit —
        the easiest way to log and verify your volunteer hours.</p>
        <p><a href="${joinUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Join your chapter</a></p>
        <p style="color:#666;font-size:13px">If you already have a Merit account, sign in with this email and you'll be joined automatically.</p>
      `,
    });
  }
}
