import { supabaseAdmin } from '../config/supabase';
import { NotFoundError, ForbiddenError } from '../lib/errors';
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

  const { data: inserted } = await supabaseAdmin
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

  return inserted!.id;
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
    logger.error({ orgError, userId }, 'create_org_failed');
    throw new Error('Failed to create organization');
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

/** Get all orgs that the current user is an admin of */
export async function getAdminOrgs(userId: string) {
  const { data } = await supabaseAdmin
    .from('org_admins')
    .select('role, organizations(id, name, slug, category, city, claimed)')
    .eq('user_id', userId);

  return (data ?? []).map((row: any) => ({
    ...(row.organizations ?? {}),
    userRole: row.role,
  })).filter((o: any) => o.id);
}

/** Full dashboard data for an org, verified admin only */
export async function getOrgDashboard(orgId: string, userId: string) {
  // Verify admin
  const { data: adminRecord } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!adminRecord) throw new ForbiddenError('Not an admin of this organization');

  const [{ data: org }, { data: sessions }, { data: admins }] = await Promise.all([
    supabaseAdmin.from('organizations').select('*').eq('id', orgId).single(),
    supabaseAdmin
      .from('sessions')
      .select('id, date, hours, status, activity, users!sessions_user_id_fkey(name, school, grade)')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('org_admins')
      .select('role, users!org_admins_user_id_fkey(name, email)')
      .eq('org_id', orgId),
  ]);

  const sessionList = sessions ?? [];
  const totalHours = sessionList.reduce((sum: number, s: any) => sum + (s.hours ?? 0), 0);
  const uniqueStudents = new Set(sessionList.map((s: any) => s.users?.name).filter(Boolean)).size;
  const verifiedSessions = sessionList.filter((s: any) => s.status === 'verified').length;
  const pendingSessions = sessionList.filter((s: any) => s.status === 'pending').length;

  return {
    org,
    stats: { totalStudents: uniqueStudents, totalHours, totalSessions: sessionList.length, verifiedSessions, pendingSessions },
    recentSessions: sessionList.slice(0, 20),
    admins: admins ?? [],
    userRole: adminRecord.role,
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
