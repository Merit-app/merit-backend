import { supabaseAdmin } from '../config/supabase';
import { NotFoundError, ForbiddenError } from '../lib/errors';
import { logger } from '../lib/logger';
import * as propublica from './propublica.service';
import type { CreateOrgInput } from '../schemas/organizations.schema';

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
