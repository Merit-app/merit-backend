/**
 * public-orgs.service.ts
 * Read-only, no-auth service for the public org page at /orgs/[slug].
 */

import { supabaseAdmin } from '../config/supabase';
import { NotFoundError } from '../lib/errors';

export interface PublicOrgProfile {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  website: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
  ein: string | null;
  isRegisteredNonprofit: boolean;
  isInstitutionalPartner: boolean;
  claimed: boolean;
  isRecruiting: boolean;
  // Stats
  totalVerifiedHours: number;
  totalVerifiedSessions: number;
  totalVolunteers: number;
  // Top volunteers (public profiles only, up to 10)
  topVolunteers: Array<{
    userId: string;
    name: string;
    username: string | null;
    verifiedHours: number;
    sessionCount: number;
  }>;
}

/**
 * Look up an org by its `slug` column (added in migration 009).
 * Falls back to UUID id lookup so /orgs/[id] also works during the slug backfill period.
 */
export async function getPublicOrg(slugOrId: string): Promise<PublicOrgProfile> {
  // Try slug first, then UUID
  let { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, slug, description, website, category, city, state, ein, ' +
      'is_registered_nonprofit, is_institutional_partner, claimed, is_recruiting',
    )
    .eq('slug', slugOrId)
    .maybeSingle();

  if (!org) {
    // Fallback: try by UUID id
    const res = await supabaseAdmin
      .from('organizations')
      .select(
        'id, name, slug, description, website, category, city, state, ein, ' +
        'is_registered_nonprofit, is_institutional_partner, claimed, is_recruiting',
      )
      .eq('id', slugOrId)
      .maybeSingle();
    org = res.data;
    error = res.error;
  }

  if (error || !org) throw new NotFoundError('Organization');

  // Aggregate verified session stats for this org
  const { data: sessionStats } = await supabaseAdmin
    .from('sessions')
    .select('user_id, hours')
    .eq('org_id', org.id)
    .eq('status', 'verified')
    .is('deleted_at', null);

  const sessions = sessionStats ?? [];
  const totalVerifiedHours = sessions.reduce((sum: number, s: any) => sum + Number(s.hours ?? 0), 0);
  const totalVerifiedSessions = sessions.length;

  // Unique volunteers
  const volunteerIds = [...new Set(sessions.map((s: any) => s.user_id as string))];
  const totalVolunteers = volunteerIds.length;

  // Top 10 volunteers by verified hours, public profiles only
  const volunteerMap = new Map<string, { verifiedHours: number; sessionCount: number }>();
  for (const s of sessions) {
    const uid = s.user_id as string;
    const entry = volunteerMap.get(uid) ?? { verifiedHours: 0, sessionCount: 0 };
    entry.verifiedHours += Number(s.hours ?? 0);
    entry.sessionCount += 1;
    volunteerMap.set(uid, entry);
  }

  const topIds = [...volunteerMap.entries()]
    .sort((a, b) => b[1].verifiedHours - a[1].verifiedHours)
    .slice(0, 10)
    .map(([id]) => id);

  let topVolunteers: PublicOrgProfile['topVolunteers'] = [];

  if (topIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, username, profile_public')
      .in('id', topIds);

    topVolunteers = (users ?? [])
      .filter((u: any) => u.profile_public === true)
      .map((u: any) => ({
        userId: u.id,
        name: u.name ?? '',
        username: u.username ?? null,
        verifiedHours: volunteerMap.get(u.id)?.verifiedHours ?? 0,
        sessionCount: volunteerMap.get(u.id)?.sessionCount ?? 0,
      }))
      .sort((a, b) => b.verifiedHours - a.verifiedHours);
  }

  return {
    id: org.id,
    name: org.name ?? '',
    slug: org.slug ?? null,
    description: org.description ?? null,
    website: org.website ?? null,
    category: org.category ?? null,
    city: org.city ?? null,
    state: org.state ?? null,
    ein: org.ein ?? null,
    isRegisteredNonprofit: org.is_registered_nonprofit ?? false,
    isInstitutionalPartner: org.is_institutional_partner ?? false,
    claimed: org.claimed ?? false,
    isRecruiting: org.is_recruiting ?? false,
    totalVerifiedHours,
    totalVerifiedSessions,
    totalVolunteers,
    topVolunteers,
  };
}
