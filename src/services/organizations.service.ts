import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import { logger } from '../lib/logger';
import * as propublica from './propublica.service';
import type { CreateOrgInput, CreatePublicOrgInput, UpdateOrgInput } from '../schemas/organizations.schema';

/** Strip any HTML tags from user-provided strings */
function sanitize(s?: string): string | undefined {
  if (!s) return undefined;
  return s.trim().replace(/<[^>]*>/g, '').slice(0, 1000);
}

export async function searchOrganizations(q: string, limit = 10) {
  // 1. Search local cache first (trigram + full-text)
  const { data: cached } = await supabaseAdmin
    .from('organizations')
    .select('id, name, ein, city, state, category, website, is_registered_nonprofit, is_institutional_partner, internal_trust_score')
    .ilike('name', `%${q}%`)
    .order('internal_trust_score', { ascending: false })
    .limit(limit);

  const results: any[] = (cached ?? []).map((org: any) => ({ ...org, source: 'cache' }));

  // 2. If fewer than 5 local results, query ProPublica
  if (results.length < 5) {
    const remote = await propublica.searchNonprofits(q, limit);

    for (const remoteOrg of remote) {
      // Skip if already in local results (by EIN or name)
      const alreadyHave =
        results.some((r) => r.ein && r.ein === remoteOrg.ein) ||
        results.some((r) => r.name.toLowerCase() === remoteOrg.name.toLowerCase());

      if (!alreadyHave) {
        // Cache in local DB
        const { data: upserted } = await supabaseAdmin
          .from('organizations')
          .upsert(
            {
              name: remoteOrg.name,
              ein: remoteOrg.ein ?? null,
              city: remoteOrg.city ?? null,
              state: remoteOrg.state ?? null,
              ntee_code: remoteOrg.nteeCode ?? null,
              category: remoteOrg.category ?? null,
              is_registered_nonprofit: true,
            },
            { onConflict: 'ein', ignoreDuplicates: false },
          )
          .select('id, name, ein, city, state, category, website, is_registered_nonprofit, is_institutional_partner, internal_trust_score')
          .single();

        if (upserted) {
          results.push({ ...upserted, source: 'propublica' });
        }
      }
    }
  }

  return results.slice(0, limit).map(shapeOrgResult);
}

export async function getOrganization(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error || !data) throw new NotFoundError('Organization');
  return data;
}

export async function getUserOrganizations(userId: string) {
  const { data } = await supabaseAdmin
    .from('sessions')
    .select('org_id, hours, status, date, org:organizations(id, name, city, state, is_registered_nonprofit, internal_trust_score)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('date', { ascending: false });

  if (!data?.length) return [];

  // Aggregate by org
  const orgMap = new Map<string, any>();
  for (const session of data) {
    const org = (session as any).org;
    if (!org) continue;
    const key = org.id;
    if (!orgMap.has(key)) {
      orgMap.set(key, {
        ...org,
        totalHours: 0,
        sessionCount: 0,
        verifiedCount: 0,
        lastVisited: null,
      });
    }
    const entry = orgMap.get(key);
    entry.totalHours += Number(session.hours);
    entry.sessionCount += 1;
    if ((session as any).status === 'verified') entry.verifiedCount += 1;
    if (!entry.lastVisited || session.date > entry.lastVisited) entry.lastVisited = session.date;
  }

  return Array.from(orgMap.values()).map((o) => ({
    ...o,
    percentVerified: o.sessionCount > 0 ? Math.round((o.verifiedCount / o.sessionCount) * 100) : 0,
  }));
}

export async function createOrganization(input: CreateOrgInput, userId: string, role: string) {
  if (!['coordinator', 'admin'].includes(role)) {
    throw new ForbiddenError('Only coordinators and admins can add organizations.');
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: input.name,
      ein: input.ein ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? 'US',
      website: input.website ?? null,
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, userId }, 'org_create_failed');
    throw error;
  }

  return data;
}

export async function resolveOrCreateOrg(input: {
  orgId?: string;
  newOrg?: { name: string; city?: string; state?: string; website?: string };
}): Promise<string> {
  if (input.orgId) return input.orgId;

  if (!input.newOrg) throw new Error('Must provide orgId or newOrg');

  // Try to find by name first
  const { data: existing } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .ilike('name', input.newOrg.name)
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  // Search ProPublica
  const remote = await propublica.searchNonprofits(input.newOrg.name, 1);
  const match = remote[0];

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: match?.name ?? input.newOrg.name,
      ein: match?.ein ?? null,
      city: match?.city ?? input.newOrg.city ?? null,
      state: match?.state ?? input.newOrg.state ?? null,
      website: input.newOrg.website ?? null,
      is_registered_nonprofit: !!match,
    })
    .select('id')
    .single();

  // Don't `inserted!.id` blind — a silent insert failure would throw an opaque
  // "Cannot read properties of null" 500. Surface a real error instead.
  if (insertErr || !inserted?.id) {
    logger.error({ insertErr, name: input.newOrg.name }, 'resolve_org_insert_failed');
    throw new AppError('org_resolve_failed', 'Could not resolve or create the organization.', 500);
  }

  return inserted.id;
}

/** Create a brand-new org and make the creator its owner/admin */
export async function createOrgByUser(
  input: CreatePublicOrgInput,
  userId: string,
  userEmail: string,
) {
  const slugify = (await import('slugify')).default;
  const { nanoid } = await import('nanoid');

  const baseSlug = slugify(input.name, { lower: true, strict: true });
  const slug = `${baseSlug}-${nanoid(6)}`;

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: sanitize(input.name),
      category: input.category,
      city: sanitize(input.city),
      state: input.province ?? null,
      country: input.country,
      slug,
      website_url: input.websiteUrl || null,
      description: sanitize(input.description),
      contact_email: input.contactEmail || null,
      contact_phone: input.contactPhone || null,
      is_recruiting: input.isRecruiting,
      claimed: true,
      claimed_at: new Date().toISOString(),
      org_plan: 'free',
    })
    .select('id, name, slug, category, city')
    .single();

  if (orgError || !org) {
    // Surface the real Postgres error (code + message) so the cause is visible in
    // logs and — in non-production — in the API response. Common causes: a CHECK
    // constraint on category, a missing column, or a unique-slug conflict.
    logger.error({ orgError, userId, input }, 'create_org_failed');
    throw new AppError(
      'create_org_failed',
      orgError?.message
        ? `Failed to create organization: ${orgError.message}`
        : 'Failed to create organization',
      500,
      orgError ? { code: orgError.code, hint: orgError.hint, details: orgError.details } : undefined,
    );
  }

  // Auto-approve creator as owner
  await supabaseAdmin.from('org_admins').insert({
    org_id: org.id,
    user_id: userId,
    role: 'owner',
    role_label: 'Owner / Executive Director',
  });

  // Audit trail via org_claims
  await supabaseAdmin.from('org_claims').insert({
    org_id: org.id,
    user_id: userId,
    email: userEmail,
    role: 'owner',
    role_label: 'Owner / Executive Director',
    status: 'approved',
    domain_matched: true,
  });

  logger.info({ orgId: org.id, userId }, 'org_created');
  return org;
}

/** Create just the organization record (no owner attached). Used by the
 *  org-first signup flow, which creates the owner account separately. */
export async function createOrgRecord(input: CreatePublicOrgInput) {
  const slugify = (await import('slugify')).default;
  const { nanoid } = await import('nanoid');
  const baseSlug = slugify(input.name, { lower: true, strict: true }) || 'org';
  const slug = `${baseSlug}-${nanoid(6)}`;

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: sanitize(input.name),
      category: input.category,
      city: sanitize(input.city),
      state: input.province ?? null,
      country: input.country,
      slug,
      website_url: input.websiteUrl || null,
      description: sanitize(input.description),
      contact_email: input.contactEmail || null,
      contact_phone: input.contactPhone || null,
      is_recruiting: input.isRecruiting,
      claimed: true,
      claimed_at: new Date().toISOString(),
      org_plan: 'free',
    })
    .select('id, name, slug, category, city')
    .single();

  if (orgError || !org) {
    logger.error({ orgError, input }, 'create_org_record_failed');
    throw new AppError(
      'create_org_failed',
      orgError?.message ? `Failed to create organization: ${orgError.message}` : 'Failed to create organization',
      500,
      orgError ? { code: orgError.code, hint: orgError.hint, details: orgError.details } : undefined,
    );
  }
  return org;
}

/** Get all orgs that the current user is an admin of */
export async function getAdminOrgs(userId: string) {
  const { data } = await supabaseAdmin
    .from('org_admins')
    .select('role, organizations(id, name, slug, category, city, claimed, logo_url)')
    .eq('user_id', userId);

  return (data ?? []).map((row: any) => ({
    ...(row.organizations ?? {}),
    role: row.role,
  })).filter((o: any) => o.id);
}

/**
 * Truncation-free org session aggregates. The dashboard used to compute every
 * stat from a `.limit(100)` slice, so any org past 100 sessions under-reported
 * its total hours, session counts and student count. We page through narrow
 * columns (no 100-row cap) and aggregate in a single pass. Ordered by `id` so
 * OFFSET pagination is deterministic across pages.
 */
async function computeOrgSessionStats(orgId: string) {
  const PAGE = 1000;
  const MAX_PAGES = 100; // ~100k-session safety ceiling — far beyond pilot scale
  let totalSessions = 0;
  let verifiedSessions = 0;
  let pendingSessions = 0;
  let totalHours = 0;
  const studentIds = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabaseAdmin
      .from('sessions')
      .select('user_id, hours, status')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      logger.error({ error, orgId, page }, 'org_dashboard_stats_page_error');
      break;
    }

    const rows = (data ?? []) as Array<{ user_id: string | null; hours: number | null; status: string }>;
    for (const s of rows) {
      totalSessions++;
      if (s.user_id) studentIds.add(s.user_id);
      if (s.status === 'verified') {
        verifiedSessions++;
        totalHours += Number(s.hours ?? 0);
      } else if (s.status === 'pending') {
        pendingSessions++;
      }
    }

    if (rows.length < PAGE) break; // last page
  }

  return { totalSessions, verifiedSessions, pendingSessions, totalHours, studentIds };
}

/** Full dashboard data for an org, verified admin only */
export async function getOrgDashboard(orgId: string, userId: string) {
  // Verify admin and pull onboarding state in one query
  const { data: adminRecord, error: adminErr } = await supabaseAdmin
    .from('org_admins')
    .select('role, onboarding_completed')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (adminErr) logger.error({ adminErr, orgId, userId }, 'org_dashboard_admin_lookup_error');
  if (!adminRecord) throw new ForbiddenError('Not an admin of this organization');

  logger.info({ orgId, userId, role: adminRecord.role }, 'org_dashboard_query_start');

  // Stats come from a full-table scan (computeOrgSessionStats); the session list
  // below is only the 20 rows we actually render, with the disambiguated user
  // embed (sessions has two FKs to users, so the `!user_id` hint is required).
  const [orgResult, recentResult, adminsResult, sessionStats] = await Promise.all([
    supabaseAdmin.from('organizations').select('*').eq('id', orgId).single(),
    supabaseAdmin
      .from('sessions')
      .select('id, date, hours, status, activity, user_id, users!user_id(id, name, school, grade)')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('org_admins')
      .select('role, user_id, users(id, name, email, avatar_url)')
      .eq('org_id', orgId),
    computeOrgSessionStats(orgId),
  ]);

  if (orgResult.error) logger.error({ err: orgResult.error, orgId }, 'org_dashboard_org_query_error');
  if (recentResult.error) logger.error({ err: recentResult.error, orgId }, 'org_dashboard_sessions_query_error');
  if (adminsResult.error) logger.error({ err: adminsResult.error, orgId }, 'org_dashboard_admins_query_error');

  const org = orgResult.data;
  const recentSessions = recentResult.data ?? [];
  const admins = adminsResult.data ?? [];

  // Also count students who registered interest but have no sessions yet.
  // Compared against the FULL distinct-student set, not just the recent slice.
  let interestedOnlyCount = 0;
  try {
    const { data: interested } = await supabaseAdmin
      .from('org_volunteer_interests')
      .select('user_id')
      .eq('org_id', orgId);
    interestedOnlyCount = (interested ?? [])
      .filter((i: any) => i.user_id && !sessionStats.studentIds.has(i.user_id))
      .length;
  } catch { /* table may not exist yet — silent */ }

  logger.info({ orgId, orgFound: !!org, sessions: sessionStats.totalSessions, admins: admins.length, interestedOnly: interestedOnlyCount }, 'org_dashboard_result');

  return {
    org,
    stats: {
      totalStudents: sessionStats.studentIds.size + interestedOnlyCount,
      totalHours: Math.round(sessionStats.totalHours * 10) / 10,
      totalSessions: sessionStats.totalSessions,
      verifiedSessions: sessionStats.verifiedSessions,
      pendingSessions: sessionStats.pendingSessions,
    },
    recentSessions,
    admins,
    userRole: adminRecord.role,
    onboardingCompleted: (adminRecord as any).onboarding_completed ?? false,
  };
}

/** Update editable org fields — admin only */
export async function updateOrg(orgId: string, userId: string, input: UpdateOrgInput) {
  const { data: adminRecord } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!adminRecord) throw new ForbiddenError('Not an admin of this organization');

  const patch: Record<string, unknown> = {};
  if (input.description !== undefined) patch.description = sanitize(input.description);
  if (input.websiteUrl !== undefined) patch.website_url = input.websiteUrl || null;
  if (input.contactEmail !== undefined) patch.contact_email = input.contactEmail || null;
  if (input.contactPhone !== undefined) patch.contact_phone = input.contactPhone || null;
  if (input.isRecruiting !== undefined) patch.is_recruiting = input.isRecruiting;

  const { error } = await supabaseAdmin.from('organizations').update(patch).eq('id', orgId);
  if (error) throw error;
  return { updated: true };
}

// ─── Full profile update (incl. name) — admin only ────────────────────────────

export interface UpdateOrgProfileInput {
  name?: string;
  description?: string;
  website_url?: string;
  contact_email?: string;
  contact_phone?: string;
  is_recruiting?: boolean;
}

export async function updateOrgProfile(orgId: string, userId: string, input: UpdateOrgProfileInput) {
  const { data: adminRecord } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!adminRecord) throw new ForbiddenError('Not authorized to edit this organization');

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = sanitize(input.name);
  if (input.description !== undefined) patch.description = sanitize(input.description);
  if (input.website_url !== undefined) patch.website_url = input.website_url || null;
  if (input.contact_email !== undefined) patch.contact_email = input.contact_email || null;
  if (input.contact_phone !== undefined) patch.contact_phone = input.contact_phone || null;
  if (input.is_recruiting !== undefined) patch.is_recruiting = input.is_recruiting;

  if (Object.keys(patch).length === 0) {
    throw new ForbiddenError('No fields to update');
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update(patch)
    .eq('id', orgId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// ─── Logo / cover upload — admin only ─────────────────────────────────────────

const ORG_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function uploadOrgImage(params: {
  orgId: string;
  userId: string;
  kind: 'logo' | 'cover';
  base64: string;
  mimeType: string;
}): Promise<{ url: string }> {
  const { orgId, userId, kind, base64, mimeType } = params;

  const { data: adminRecord } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!adminRecord) throw new ForbiddenError('Not authorized to edit this organization');

  const ext = ORG_IMAGE_TYPES[mimeType];
  if (!ext) throw new ForbiddenError('Only JPEG, PNG, WebP and GIF images are allowed');

  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new ForbiddenError('Image must be under 5 MB');
  }

  const path = `orgs/${orgId}/${kind}.${ext}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(path, buffer, { contentType: mimeType, upsert: true });

  if (uploadError) {
    logger.error({ orgId, uploadError }, 'org_image_upload_failed');
    throw new Error('Failed to upload image. Please try again.');
  }

  // Cache-bust so the new image shows immediately
  const { data: urlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(path);
  const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`;

  const field = kind === 'logo' ? 'logo_url' : 'cover_url';
  const { error: updateError } = await supabaseAdmin
    .from('organizations')
    .update({ [field]: publicUrl })
    .eq('id', orgId);

  if (updateError) throw updateError;
  return { url: publicUrl };
}

// ─── Delete organization (owner only) ─────────────────────────────────────────

/** Permanently delete an org and all its related rows. Owner only. */
export async function deleteOrg(orgId: string, userId: string) {
  const { data: adminRecord } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!adminRecord) throw new ForbiddenError('Not an admin of this organization');
  if (adminRecord.role !== 'owner') throw new ForbiddenError('Only the owner can delete this organization');

  // Detach sessions + authenticators (keep volunteers' verified hours; just
  // unlink from the org). Requires org_id to be nullable on these tables —
  // see migration 020.
  const { error: sessErr } = await supabaseAdmin.from('sessions').update({ org_id: null }).eq('org_id', orgId);
  if (sessErr) logger.warn({ sessErr, orgId }, 'delete_org_detach_sessions_failed');
  try {
    await supabaseAdmin.from('authenticators').update({ org_id: null }).eq('org_id', orgId);
  } catch (err) {
    logger.warn({ err, orgId }, 'delete_org_detach_authenticators_failed');
  }

  // Delete dependent rows explicitly (covers tables that may not cascade).
  // Each is best-effort: a missing/already-empty table must not block the delete.
  const safeDelete = async (table: string, column: string) => {
    try {
      await supabaseAdmin.from(table).delete().eq(column, orgId);
    } catch (err) {
      logger.warn({ err, table, orgId }, 'delete_org_dependent_failed');
    }
  };

  // event_signups are keyed by event_id, so clear them via the org's events first
  try {
    const { data: events } = await supabaseAdmin.from('org_events').select('id').eq('org_id', orgId);
    const eventIds = (events ?? []).map((e: any) => e.id);
    if (eventIds.length) {
      await supabaseAdmin.from('event_signups').delete().in('event_id', eventIds);
    }
  } catch (err) {
    logger.warn({ err, orgId }, 'delete_org_event_signups_failed');
  }

  await safeDelete('org_events', 'org_id');
  await safeDelete('org_messages', 'org_id');
  await safeDelete('org_invites', 'org_id');
  await safeDelete('org_admins', 'org_id');
  await safeDelete('org_claims', 'org_id');
  await safeDelete('org_volunteer_interests', 'org_id');
  await safeDelete('user_org_follows', 'org_id');

  const { error } = await supabaseAdmin.from('organizations').delete().eq('id', orgId);
  if (error) {
    logger.error({ error, orgId, userId }, 'delete_org_failed');
    throw new AppError('delete_org_failed', `Failed to delete organization: ${error.message}`, 500);
  }

  logger.info({ orgId, userId }, 'org_deleted');
  return { deleted: true };
}

// ─── Org admin helper ─────────────────────────────────────────────────────────

async function requireOrgAdmin(orgId: string, userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new ForbiddenError('Not an admin of this organization');
  return data.role as string;
}

// ─── Volunteers list ──────────────────────────────────────────────────────────

export async function getOrgVolunteers(orgId: string, userId: string) {
  await requireOrgAdmin(orgId, userId);
  logger.info({ orgId, build: 'volunteers-noembed-v3' }, 'org_volunteers_start');

  const { data: sessions, error: sessErr } = await supabaseAdmin
    .from('sessions')
    .select('id, date, hours, status, activity, user_id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('date', { ascending: false });
  if (sessErr) logger.warn({ sessErr, orgId }, 'org_volunteers_sessions_query_failed');

  // Fetch student details in ONE plain query rather than an embedded join.
  // Embedding users(...) on sessions is ambiguous — sessions has two FKs to
  // users (user_id + org_verified_by_user_id) — and PostgREST returns null,
  // which silently dropped every session-based volunteer.
  const sessionUserIds = [...new Set((sessions ?? []).map((s: any) => s.user_id).filter(Boolean))];
  const userById = new Map<string, any>();
  if (sessionUserIds.length) {
    const { data: sUsers, error: suErr } = await supabaseAdmin
      .from('users')
      .select('id, name, email, phone, school, grade, username, avatar_url')
      .in('id', sessionUserIds);
    if (suErr) logger.warn({ suErr, orgId }, 'org_volunteers_session_users_failed');
    for (const u of sUsers ?? []) userById.set(u.id, u);
  }

  // Group by student
  const studentMap = new Map<string, {
    student: any;
    sessions: any[];
    totalHours: number;
    verifiedHours: number;
    lastActive: string;
  }>();

  for (const s of sessions ?? []) {
    const user = userById.get((s as any).user_id);
    if (!user?.id) continue;
    const existing = studentMap.get(user.id);
    if (existing) {
      existing.sessions.push(s);
      existing.totalHours += Number((s as any).hours ?? 0);
      if ((s as any).status === 'verified') existing.verifiedHours += Number((s as any).hours ?? 0);
      if ((s as any).date > existing.lastActive) existing.lastActive = (s as any).date;
    } else {
      studentMap.set(user.id, {
        student: user,
        sessions: [s],
        totalHours: Number((s as any).hours ?? 0),
        verifiedHours: (s as any).status === 'verified' ? Number((s as any).hours ?? 0) : 0,
        lastActive: (s as any).date,
      });
    }
  }

  const sessionVolunteers = Array.from(studentMap.values())
    .sort((a, b) => b.verifiedHours - a.verifiedHours);

  // Append students who registered interest but have no sessions yet.
  // Fetch interests and their users in TWO plain queries — no embedded join,
  // which was returning null and silently dropping interested volunteers.
  const { data: interests, error: interestErr } = await supabaseAdmin
    .from('org_volunteer_interests')
    .select('user_id, created_at')
    .eq('org_id', orgId);

  if (interestErr) {
    logger.warn({ interestErr, orgId }, 'org_volunteers_interest_query_failed');
    return sessionVolunteers;
  }

  const interestIds = (interests ?? [])
    .map((i: any) => i.user_id as string)
    .filter((id: string) => id && !studentMap.has(id));

  if (interestIds.length === 0) return sessionVolunteers;

  const createdAtById = new Map<string, string>();
  for (const i of interests ?? []) createdAtById.set(i.user_id, i.created_at);

  const { data: interestUsers, error: iuErr } = await supabaseAdmin
    .from('users')
    .select('*')
    .in('id', interestIds);

  if (iuErr) logger.warn({ iuErr, orgId }, 'org_volunteers_interest_users_failed');

  const interestOnly = (interestUsers ?? []).map((u: any) => ({
    student: {
      id: u.id,
      name: u.name,
      email: u.email ?? null,
      phone: u.phone ?? null,
      school: u.school ?? null,
      grade: u.grade ?? null,
      username: u.username ?? null,
      avatar_url: u.avatar_url ?? null,
    },
    sessions: [] as any[],
    totalHours: 0,
    verifiedHours: 0,
    lastActive: createdAtById.get(u.id) ?? null,
    isInterested: true,
  }));

  return [...sessionVolunteers, ...interestOnly];
}

// ─── Verify / dispute session as org ─────────────────────────────────────────

export async function verifySessionAsOrg(orgId: string, sessionId: string, userId: string) {
  await requireOrgAdmin(orgId, userId);
  const { error } = await supabaseAdmin
    .from('sessions')
    .update({
      status: 'verified',
      // Org admin attestation → institutional tier (SPEC.md Session Verification Tier).
      verification_tier: 'verified_institutional',
      org_verified_by_user_id: userId,
      org_verified_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('org_id', orgId);
  if (error) throw error;
  return { verified: true };
}

export async function disputeSessionAsOrg(orgId: string, sessionId: string, userId: string) {
  await requireOrgAdmin(orgId, userId);
  const { error } = await supabaseAdmin
    .from('sessions')
    .update({ status: 'disputed' })
    .eq('id', sessionId)
    .eq('org_id', orgId);
  if (error) throw error;
  return { disputed: true };
}

// ─── Manual hour adjustment (org-side) ────────────────────────────────────────

/**
 * Lets an org admin add or subtract verified hours for a volunteer by writing a
 * single verified session under this org. Because every total (org dashboard +
 * student dashboard) is a sum of verified session hours, this one ledger row is
 * the single source of truth and shows up on both sides automatically.
 * `hours` may be negative to subtract. Validated at the route.
 */
export async function adjustVolunteerHours(
  orgId: string,
  adminUserId: string,
  targetUserId: string,
  hours: number,
  reason?: string,
) {
  await requireOrgAdmin(orgId, adminUserId);

  const rounded = Math.round(hours * 100) / 100;
  const now = new Date().toISOString();

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single();
  const orgName = (org as any)?.name ?? 'Organization';

  const label =
    reason?.trim().slice(0, 200) ||
    (rounded >= 0 ? 'Hours added by organization' : 'Hours adjusted by organization');

  const { data: session, error } = await supabaseAdmin
    .from('sessions')
    .insert({
      user_id: targetUserId,
      org_id: orgId,
      date: now.split('T')[0],
      hours: rounded,
      activity: label,
      status: 'verified',
      // Org admin is directly attesting these hours — institutional tier
      // (SPEC.md Session Verification Tier; mirrors confirmAttendance/completeEvent).
      verification_tier: 'verified_institutional',
      supervisor_name: orgName,
      org_verified_by_user_id: adminUserId,
      org_verified_at: now,
      self_reported: false,
    })
    .select('id, date, hours, activity, status')
    .single();

  if (error) throw error;
  return { adjusted: true, session };
}

// ─── Team management ──────────────────────────────────────────────────────────

export async function inviteTeamMember(
  orgId: string,
  userId: string,
  email: string,
  role: 'coordinator' | 'admin',
) {
  await requireOrgAdmin(orgId, userId);

  // Look up user by email
  const { data: invitee } = await supabaseAdmin
    .from('users')
    .select('id, name, email')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (!invitee) {
    throw new Error('NO_ACCOUNT');
  }

  // Check if already a member
  const { data: existing } = await supabaseAdmin
    .from('org_admins')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', invitee.id)
    .maybeSingle();

  if (existing) throw new Error('ALREADY_MEMBER');

  await supabaseAdmin.from('org_admins').insert({
    org_id: orgId,
    user_id: invitee.id,
    role,
  });

  return { added: true, name: invitee.name, role };
}

export async function removeTeamMember(orgId: string, userId: string, targetUserId: string) {
  const role = await requireOrgAdmin(orgId, userId);

  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only admins can remove team members');
  }
  if (targetUserId === userId) {
    throw new Error('SELF_REMOVE');
  }

  const { error } = await supabaseAdmin
    .from('org_admins')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', targetUserId);

  if (error) throw error;
  return { removed: true };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export async function exportVolunteerCSV(orgId: string, userId: string): Promise<{ csv: string; filename: string }> {
  await requireOrgAdmin(orgId, userId);

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single();

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('date, hours, activity, status, users!sessions_user_id_fkey(name, school, grade)')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('date', { ascending: false });

  const rows = (sessions ?? []).map((s: any) => ({
    Date: s.date,
    'Student Name': s.users?.name ?? '',
    School: s.users?.school ?? '',
    Grade: s.users?.grade ?? '',
    Hours: s.hours,
    Activity: s.activity,
    Status: s.status,
  }));

  // Build CSV without extra dependency
  const headers = ['Date', 'Student Name', 'School', 'Grade', 'Hours', 'Activity', 'Status'];
  const lines = [
    headers.join(','),
    ...rows.map((r: any) =>
      headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','),
    ),
  ];

  const orgName = (org?.name ?? 'org').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const date = new Date().toISOString().split('T')[0];
  return { csv: lines.join('\n'), filename: `${orgName}-volunteers-${date}.csv` };
}

// ─── Volunteer interest ("I volunteer here") ──────────────────────────────────

export async function registerInterest(orgId: string, userId: string) {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) throw new NotFoundError('Organization');

  const { error } = await supabaseAdmin
    .from('org_volunteer_interests')
    .upsert({ org_id: orgId, user_id: userId }, { onConflict: 'user_id,org_id' });
  if (error) throw error;

  return { registered: true, orgName: org.name };
}

export async function unregisterInterest(orgId: string, userId: string) {
  const { error } = await supabaseAdmin
    .from('org_volunteer_interests')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw error;
  return { unregistered: true };
}

export async function getInterestStatus(orgId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from('org_volunteer_interests')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return { registered: !!data };
}

function shapeOrgResult(org: any) {
  return {
    id: org.id,
    name: org.name,
    ein: org.ein,
    city: org.city,
    state: org.state,
    category: org.category,
    website: org.website,
    isRegisteredNonprofit: org.is_registered_nonprofit,
    isInstitutionalPartner: org.is_institutional_partner,
    trustScore: org.internal_trust_score,
    source: org.source ?? 'cache',
  };
}
