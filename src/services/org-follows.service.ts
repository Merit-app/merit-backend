/**
 * org-follows.service.ts
 * Follow/unfollow orgs, discover feed, per-org stats, similar orgs.
 */

import { supabaseAdmin } from '../config/supabase';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getStudentCountsForOrgs(orgIds: string[]): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map();
  const { data } = await supabaseAdmin
    .from('sessions')
    .select('org_id, user_id')
    .in('org_id', orgIds)
    .eq('status', 'verified')
    .is('deleted_at', null);

  const buckets = new Map<string, Set<string>>();
  for (const s of (data ?? [])) {
    if (!buckets.has(s.org_id)) buckets.set(s.org_id, new Set());
    buckets.get(s.org_id)!.add(s.user_id);
  }
  const result = new Map<string, number>();
  for (const [id, users] of buckets) result.set(id, users.size);
  return result;
}

function shapeDiscoverOrg(org: any, counts: Map<string, number>, isFollowing: boolean) {
  return {
    id: org.id,
    slug: org.slug ?? org.id,
    name: org.name ?? '',
    category: org.category ?? null,
    city: org.city ?? null,
    state: org.state ?? null,
    website: org.website_url ?? org.website ?? null,
    description: org.description ?? null,
    logoUrl: org.logo_url ?? null,
    coverUrl: org.cover_url ?? null,
    isRegisteredNonprofit: org.is_registered_nonprofit ?? false,
    isInstitutionalPartner: org.is_institutional_partner ?? false,
    claimed: org.claimed ?? false,
    isRecruiting: org.is_recruiting ?? false,
    studentCount: counts.get(org.id) ?? 0,
    isFollowing,
  };
}

// ─── Toggle follow ────────────────────────────────────────────────────────────

export async function toggleFollow(userId: string, orgId: string): Promise<{ following: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from('user_org_follows')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('user_org_follows')
      .delete()
      .eq('user_id', userId)
      .eq('org_id', orgId);
    return { following: false };
  } else {
    await supabaseAdmin
      .from('user_org_follows')
      .insert({ user_id: userId, org_id: orgId });
    return { following: true };
  }
}

// ─── Get followed orgs ────────────────────────────────────────────────────────

export async function getFollowedOrgs(userId: string) {
  const { data: follows } = await supabaseAdmin
    .from('user_org_follows')
    .select('org_id')
    .eq('user_id', userId);

  if (!follows || follows.length === 0) return [];

  const orgIds = follows.map((f: any) => f.org_id);

  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, slug, category, city, state, website, website_url, description, ' +
      'logo_url, cover_url, is_registered_nonprofit, is_institutional_partner, claimed, is_recruiting',
    )
    .in('id', orgIds);

  if (!orgs || orgs.length === 0) return [];

  const counts = await getStudentCountsForOrgs(orgIds);
  const followedSet = new Set(orgIds);

  return (orgs as any[]).map((o) => shapeDiscoverOrg(o, counts, followedSet.has(o.id)));
}

// ─── Discover feed ────────────────────────────────────────────────────────────

export async function discoverOrgs(userId: string, opts: {
  category?: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;

  // Personalisation data: cities + categories from the user's existing sessions
  const { data: userSessions } = await supabaseAdmin
    .from('sessions')
    .select('org_id')
    .eq('user_id', userId)
    .eq('status', 'verified')
    .is('deleted_at', null);

  const userOrgIds = [...new Set((userSessions ?? []).map((s: any) => s.org_id as string))];
  let userCities = new Set<string>();
  let userCategories = new Set<string>();

  if (userOrgIds.length > 0) {
    const { data: userOrgs } = await supabaseAdmin
      .from('organizations')
      .select('city, category')
      .in('id', userOrgIds);
    for (const o of (userOrgs ?? [])) {
      if (o.city) userCities.add(o.city);
      if (o.category) userCategories.add(o.category);
    }
  }

  // Fetch orgs
  let query = supabaseAdmin
    .from('organizations')
    .select(
      'id, name, slug, category, city, state, website, website_url, description, ' +
      'logo_url, cover_url, is_registered_nonprofit, is_institutional_partner, claimed, is_recruiting',
    );

  if (opts.category) {
    query = (query as any).ilike('category', `%${opts.category}%`);
  }
  if (opts.q) {
    query = (query as any).ilike('name', `%${opts.q}%`);
  }

  // Fetch a window larger than needed so we can sort and slice
  const fetchLimit = Math.min(limit + offset + 100, 300);
  const { data: orgs } = await (query as any).limit(fetchLimit);

  if (!orgs || orgs.length === 0) return [];

  const allIds = (orgs as any[]).map((o) => o.id);
  const [counts, followsRes] = await Promise.all([
    getStudentCountsForOrgs(allIds),
    supabaseAdmin
      .from('user_org_follows')
      .select('org_id')
      .eq('user_id', userId)
      .in('org_id', allIds),
  ]);

  const followedSet = new Set((followsRes.data ?? []).map((f: any) => f.org_id as string));

  // Sort: same-city > same-category > student-count > alpha
  const sorted = [...(orgs as any[])].sort((a, b) => {
    const ac = userCities.has(a.city) ? 2 : 0;
    const bc = userCities.has(b.city) ? 2 : 0;
    if (bc !== ac) return bc - ac;

    const ak = userCategories.has(a.category) ? 1 : 0;
    const bk = userCategories.has(b.category) ? 1 : 0;
    if (bk !== ak) return bk - ak;

    const as_ = counts.get(a.id) ?? 0;
    const bs_ = counts.get(b.id) ?? 0;
    if (bs_ !== as_) return bs_ - as_;

    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  return sorted
    .slice(offset, offset + limit)
    .map((o) => shapeDiscoverOrg(o, counts, followedSet.has(o.id)));
}

// ─── Org stats ────────────────────────────────────────────────────────────────

export async function getOrgStats(orgId: string) {
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('user_id, hours, date')
    .eq('org_id', orgId)
    .eq('status', 'verified')
    .is('deleted_at', null);

  const sess = (sessions ?? []) as Array<{ user_id: string; hours: any; date: string | null }>;
  const totalHours = sess.reduce((s, r) => s + Number(r.hours ?? 0), 0);
  const totalStudents = new Set(sess.map((r) => r.user_id)).size;
  const totalSessions = sess.length;
  const avgSessionHours = totalSessions > 0 ? totalHours / totalSessions : 0;

  // Monthly breakdown
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthCounts = new Map<number, number>();
  for (const r of sess) {
    if (r.date) {
      const m = new Date(r.date + 'T00:00:00').getMonth();
      monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
    }
  }
  const mostActiveMonths = [...monthCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => MONTH_NAMES[m]);

  // Volunteers this calendar month
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const recentVolunteerCount = new Set(
    sess.filter((r) => r.date && r.date >= startOfMonth).map((r) => r.user_id),
  ).size;

  return {
    totalStudents,
    totalHours: Math.round(totalHours * 10) / 10,
    avgSessionHours: Math.round(avgSessionHours * 10) / 10,
    totalSessions,
    mostActiveMonths,
    recentVolunteerCount,
  };
}

// ─── Similar orgs ─────────────────────────────────────────────────────────────

export async function getSimilarOrgs(orgId: string) {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('category, city')
    .eq('id', orgId)
    .maybeSingle();

  if (!org || !org.category) return [];

  // Fetch up to 8 same-category orgs, sort city-match first, take 3
  const { data: candidates } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, category, city, state, logo_url, is_registered_nonprofit')
    .neq('id', orgId)
    .eq('category', org.category)
    .limit(8);

  const sorted = [...(candidates ?? [])].sort((a, b) => {
    const am = a.city === org.city ? 1 : 0;
    const bm = b.city === org.city ? 1 : 0;
    return bm - am;
  }).slice(0, 3);

  const ids = sorted.map((o) => o.id);
  const counts = await getStudentCountsForOrgs(ids);

  return sorted.map((o: any) => ({
    id: o.id,
    slug: o.slug ?? o.id,
    name: o.name ?? '',
    category: o.category ?? null,
    city: o.city ?? null,
    state: o.state ?? null,
    logoUrl: o.logo_url ?? null,
    isRegisteredNonprofit: o.is_registered_nonprofit ?? false,
    studentCount: counts.get(o.id) ?? 0,
  }));
}
