import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors';
import { generateUrlSafeToken } from '../lib/crypto';
import { sendEmail } from './resend.service';
import { logger } from '../lib/logger';
import { getCoordinatorChapterId } from './admin.service';
import { assertPermission } from './chapter-team.service';
import { createManyNotifications } from './notifications.service';
import DOMPurify from 'isomorphic-dompurify';

const FRONTEND = (env.FRONTEND_URL ?? 'https://meritco.app').replace(/\/+$/, '');
function clean(s: string | undefined | null, max = 500): string {
  if (!s) return '';
  return DOMPurify.sanitize(String(s), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).slice(0, max);
}

// ─── Partners ───────────────────────────────────────────────────────────────

export async function createPartnerInvite(userId: string, input: { orgName: string; contactEmail: string }) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_partners');

  const orgName = clean(input.orgName, 200);
  const contactEmail = clean(input.contactEmail, 200).toLowerCase();
  if (!orgName || !contactEmail.includes('@')) {
    throw new AppError('invalid_input', 'Org name and a valid contact email are required.', 400);
  }

  const token = generateUrlSafeToken(32);
  const { data: chapter } = await supabaseAdmin.from('chapters').select('name').eq('id', chapterId).maybeSingle();
  const chapterName = (chapter as any)?.name ?? 'A school';

  const { data, error } = await supabaseAdmin
    .from('chapter_partners')
    .insert({ chapter_id: chapterId, org_name: orgName, contact_email: contactEmail, invite_token: token, status: 'pending' })
    .select('id')
    .single();
  if (error) throw new AppError('partner_failed', 'Failed to create partner invite.', 500);

  const acceptUrl = `${FRONTEND}/partner/accept?token=${token}`;
  void sendEmail({
    to: contactEmail,
    subject: `${chapterName} wants to partner with ${orgName} on Merit`,
    html: `
      <h2>${chapterName} invited you to partner on Merit</h2>
      <p>As a partner, <strong>${orgName}</strong> gets a free <strong>Pro</strong> plan and can post
      volunteering opportunities directly to ${chapterName}'s students.</p>
      <p><a href="${acceptUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Accept &amp; claim free Pro</a></p>
      <p style="color:#666;font-size:13px">You'll sign in (or create an org account) and link your organization.</p>
    `,
  });

  logger.info({ chapterId, partnerId: (data as any).id }, 'partner_invite_created');
  return { id: (data as any).id };
}

export async function listPartners(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  const { data } = await supabaseAdmin
    .from('chapter_partners')
    .select('id, org_name, contact_email, status, comp_plan, created_at, accepted_at, org:organizations(id, name, slug, logo_url)')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });
  return (data as any[] | null) ?? [];
}

export async function revokePartner(userId: string, partnerId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_partners');
  const { data: p } = await supabaseAdmin.from('chapter_partners').select('id, chapter_id').eq('id', partnerId).maybeSingle();
  if (!p || (p as any).chapter_id !== chapterId) throw new NotFoundError('Partner');
  await supabaseAdmin.from('chapter_partners').update({ status: 'revoked' }).eq('id', partnerId);
  return { revoked: true };
}

/** Public-ish lookup for the accept page (auth required at the route). */
export async function getPartnerInvite(token: string) {
  const { data } = await supabaseAdmin
    .from('chapter_partners')
    .select('id, org_name, status, chapter:chapters(name)')
    .eq('invite_token', token)
    .maybeSingle();
  if (!data) throw new AppError('invalid_token', 'This partner link is invalid.', 400);
  const d = data as any;
  return { id: d.id, orgName: d.org_name, status: d.status, chapterName: d.chapter?.name ?? 'A school' };
}

/** An org admin accepts the partnership and links one of their orgs, which gets comped. */
export async function acceptPartner(userId: string, token: string, orgId: string) {
  const { data: partner } = await supabaseAdmin
    .from('chapter_partners')
    .select('id, status, comp_plan, chapter_id')
    .eq('invite_token', token)
    .maybeSingle();
  const p = partner as any;
  if (!p) throw new AppError('invalid_token', 'This partner link is invalid or expired.', 400);
  if (p.status === 'active') throw new AppError('already_active', 'This partnership is already active.', 409);

  // Caller must be an admin of the org they're linking.
  const { data: admin } = await supabaseAdmin
    .from('org_admins')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!admin) throw new ForbiddenError('You must be an admin of that organization.');

  const compPlan = p.comp_plan ?? 'pro';
  const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // Comp the org's plan.
  await supabaseAdmin
    .from('organizations')
    .update({ org_plan: compPlan, subscription_status: 'active', subscription_period_end: periodEnd })
    .eq('id', orgId);

  await supabaseAdmin
    .from('chapter_partners')
    .update({ status: 'active', org_id: orgId, invite_token: null, accepted_at: new Date().toISOString() })
    .eq('id', p.id);

  logger.info({ partnerId: p.id, orgId, compPlan }, 'partner_accepted_and_comped');
  return { ok: true, compPlan };
}

// ─── Opportunities ──────────────────────────────────────────────────────────

export async function createOpportunity(
  userId: string,
  input: { title: string; description?: string; orgName?: string; slots?: number; startsAt?: string | null; location?: string },
) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'post_opportunities');

  const title = clean(input.title, 140);
  if (!title) throw new AppError('invalid_input', 'A title is required.', 400);

  const { data, error } = await supabaseAdmin
    .from('chapter_opportunities')
    .insert({
      chapter_id: chapterId,
      title,
      description: clean(input.description, 2000) || null,
      org_name: clean(input.orgName, 200) || null,
      slots: input.slots != null && Number.isFinite(Number(input.slots)) ? Math.max(0, Math.trunc(Number(input.slots))) : null,
      starts_at: input.startsAt || null,
      location: clean(input.location, 200) || null,
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) throw new AppError('opportunity_failed', 'Failed to post opportunity.', 500);

  // Notify all chapter members.
  const { data: members } = await supabaseAdmin
    .from('users').select('id').eq('chapter_id', chapterId).is('deleted_at', null);
  const ids = ((members as any[] | null) ?? []).map((m) => m.id as string);
  const slotsLine = input.slots ? ` · ${input.slots} spaces` : '';
  await createManyNotifications(ids, {
    type: 'chapter_opportunity',
    title: `New opportunity: ${title}`,
    body: `${input.orgName ? input.orgName + ' · ' : ''}${title}${slotsLine}. Tap to sign up.`,
    actionUrl: '/my-chapter',
  });

  logger.info({ chapterId, opportunityId: (data as any).id, notified: ids.length }, 'opportunity_posted');
  return { id: (data as any).id, notified: ids.length };
}

export async function listOpportunities(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  const { data: opps } = await supabaseAdmin
    .from('chapter_opportunities')
    .select('*')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });

  const list = (opps as any[] | null) ?? [];
  if (list.length === 0) return [];

  // Signup counts
  const { data: signups } = await supabaseAdmin
    .from('opportunity_signups')
    .select('opportunity_id, status')
    .in('opportunity_id', list.map((o) => o.id))
    .neq('status', 'cancelled');
  const counts = new Map<string, number>();
  for (const s of (signups as any[] | null) ?? []) counts.set(s.opportunity_id, (counts.get(s.opportunity_id) ?? 0) + 1);

  return list.map((o) => ({
    id: o.id, title: o.title, description: o.description, orgName: o.org_name,
    slots: o.slots, startsAt: o.starts_at, location: o.location, createdAt: o.created_at,
    signupCount: counts.get(o.id) ?? 0,
  }));
}

export async function getOpportunitySignups(userId: string, opportunityId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  const { data: opp } = await supabaseAdmin
    .from('chapter_opportunities').select('id, chapter_id, title').eq('id', opportunityId).maybeSingle();
  if (!opp || (opp as any).chapter_id !== chapterId) throw new NotFoundError('Opportunity');

  const { data } = await supabaseAdmin
    .from('opportunity_signups')
    .select('status, created_at, user:users(id, name, email)')
    .eq('opportunity_id', opportunityId)
    .neq('status', 'cancelled')
    .order('created_at');
  return {
    title: (opp as any).title,
    signups: ((data as any[] | null) ?? []).map((s) => ({
      userId: s.user?.id, name: s.user?.name ?? 'Student', email: s.user?.email ?? '', status: s.status, at: s.created_at,
    })),
  };
}

// ── Student-facing opportunities ──

export async function listMyOpportunities(userId: string) {
  const { data: user } = await supabaseAdmin.from('users').select('chapter_id').eq('id', userId).maybeSingle();
  const chapterId = (user as any)?.chapter_id;
  if (!chapterId) return [];

  const { data: opps } = await supabaseAdmin
    .from('chapter_opportunities')
    .select('*')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });
  const list = (opps as any[] | null) ?? [];
  if (list.length === 0) return [];

  const { data: mySignups } = await supabaseAdmin
    .from('opportunity_signups')
    .select('opportunity_id, status')
    .eq('user_id', userId)
    .in('opportunity_id', list.map((o) => o.id));
  const mine = new Map<string, string>();
  for (const s of (mySignups as any[] | null) ?? []) mine.set(s.opportunity_id, s.status);

  const { data: allSignups } = await supabaseAdmin
    .from('opportunity_signups')
    .select('opportunity_id')
    .in('opportunity_id', list.map((o) => o.id))
    .neq('status', 'cancelled');
  const counts = new Map<string, number>();
  for (const s of (allSignups as any[] | null) ?? []) counts.set(s.opportunity_id, (counts.get(s.opportunity_id) ?? 0) + 1);

  return list.map((o) => ({
    id: o.id, title: o.title, description: o.description, orgName: o.org_name,
    slots: o.slots, startsAt: o.starts_at, location: o.location,
    signupCount: counts.get(o.id) ?? 0,
    mySignupStatus: mine.get(o.id) ?? null,
  }));
}

export async function signupOpportunity(userId: string, opportunityId: string) {
  // Verify the opportunity belongs to the student's chapter.
  const { data: user } = await supabaseAdmin.from('users').select('chapter_id').eq('id', userId).maybeSingle();
  const chapterId = (user as any)?.chapter_id;
  const { data: opp } = await supabaseAdmin
    .from('chapter_opportunities').select('id, chapter_id, slots').eq('id', opportunityId).maybeSingle();
  if (!opp || !chapterId || (opp as any).chapter_id !== chapterId) throw new NotFoundError('Opportunity');

  // Waitlist if full.
  let status = 'signed_up';
  if ((opp as any).slots != null) {
    const { count } = await supabaseAdmin
      .from('opportunity_signups')
      .select('*', { count: 'exact', head: true })
      .eq('opportunity_id', opportunityId)
      .eq('status', 'signed_up');
    if ((count ?? 0) >= (opp as any).slots) status = 'waitlisted';
  }

  const { error } = await supabaseAdmin
    .from('opportunity_signups')
    .upsert({ opportunity_id: opportunityId, user_id: userId, status }, { onConflict: 'opportunity_id,user_id' });
  if (error) throw new AppError('signup_failed', 'Failed to sign up.', 500);
  return { status };
}

export async function cancelSignup(userId: string, opportunityId: string) {
  await supabaseAdmin
    .from('opportunity_signups')
    .update({ status: 'cancelled' })
    .eq('opportunity_id', opportunityId)
    .eq('user_id', userId);
  return { cancelled: true };
}
