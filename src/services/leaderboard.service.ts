import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LeaderboardPeriod = 'all' | 'month' | 'week';
export type LeaderboardType = 'global' | 'local' | 'school';

export interface LeaderboardEntry {
  rank: number;
  userId: string | null;        // null for private users
  name: string;                 // 'Anonymous Student' for private
  username: string | null;      // null for private users
  avatarUrl: string | null;
  school: string | null;
  city: string | null;
  verifiedHours: number;
  sessionCount: number;
  isCurrentUser: boolean;
  isPrivate: boolean;
  badges: {
    id: string;
    name: string;
    tier: string;
    iconName: string;
  }[];
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  currentUserEntry: LeaderboardEntry | null;
  currentUserRank: number | null;
  totalParticipants: number;
  period: LeaderboardPeriod;
  type: LeaderboardType;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateFilter(period: LeaderboardPeriod): string | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  if (period === 'week') {
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  return null;
}

// ─── Main leaderboard query ───────────────────────────────────────────────────

export async function getLeaderboard(params: {
  type: LeaderboardType;
  period: LeaderboardPeriod;
  currentUserId?: string;
  school?: string;
  city?: string;
  limit?: number;
  offset?: number;
}): Promise<LeaderboardResult> {
  const { type, period, currentUserId, school, city, limit = 50, offset = 0 } = params;
  const dateFilter = getDateFilter(period);

  // 1. Fetch all relevant verified sessions (user_id + org_id + hours)
  let sessionsQuery = supabaseAdmin
    .from('sessions')
    .select('user_id, org_id, hours')
    .eq('status', 'verified')
    .eq('self_reported', false)  // exclude self-tracked — only org-verified counts
    .is('deleted_at', null);

  if (dateFilter) {
    sessionsQuery = sessionsQuery.gte('date', dateFilter);
  }

  const { data: sessions, error: sessionsError } = await sessionsQuery;
  if (sessionsError) {
    logger.error(sessionsError, 'leaderboard_sessions_query_error');
    throw new Error('Failed to fetch leaderboard data');
  }

  if (!sessions || sessions.length === 0) {
    return {
      entries: [],
      currentUserEntry: null,
      currentUserRank: null,
      totalParticipants: 0,
      period,
      type,
    };
  }

  // 2. Aggregate hours per user
  interface UserAgg {
    userId: string;
    verifiedHours: number;
    sessionCount: number;
    orgIds: Set<string>;
  }

  const userAggMap = new Map<string, UserAgg>();

  for (const s of sessions) {
    const userId = (s as any).user_id as string | null;
    const orgId = (s as any).org_id as string | null;
    if (!userId) continue;

    const existing = userAggMap.get(userId);
    if (existing) {
      existing.verifiedHours += (s as any).hours ?? 0;
      existing.sessionCount++;
      if (orgId) existing.orgIds.add(orgId);
    } else {
      userAggMap.set(userId, {
        userId,
        verifiedHours: (s as any).hours ?? 0,
        sessionCount: 1,
        orgIds: new Set(orgId ? [orgId] : []),
      });
    }
  }

  const userIds = Array.from(userAggMap.keys());
  if (userIds.length === 0) {
    return { entries: [], currentUserEntry: null, currentUserRank: null, totalParticipants: 0, period, type };
  }

  // 3. Fetch user details in batch — include city for local leaderboard
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, name, username, avatar_url, school, city, profile_public')
    .in('id', userIds)
    .is('deleted_at', null);

  const userDetailMap = new Map<string, any>();
  for (const u of users ?? []) {
    userDetailMap.set((u as any).id as string, u);
  }

  // 4. For local filter, use the city stored on the user profile directly.
  // This is set by the student in Settings → Profile and is the most reliable
  // signal — no need to infer from org cities.
  const orgCityMap = new Map<string, string>(); // kept for type-compat, unused now

  // 5. Apply type-specific filters and build candidate list
  interface Candidate {
    userId: string;
    verifiedHours: number;
    sessionCount: number;
    orgIds: Set<string>;
    userDetail: any;
    primaryCity: string | null;
  }

  const candidates: Candidate[] = [];

  for (const agg of userAggMap.values()) {
    const ud = userDetailMap.get(agg.userId);
    if (!ud) continue; // user deleted

    if (type === 'school' && school) {
      const userSchool = (ud.school as string | null) ?? '';
      if (!userSchool || userSchool.toLowerCase() !== school.toLowerCase()) continue;
    }

    let primaryCity: string | null = null;

    if (type === 'local' && city) {
      // Use the city the student set on their own profile
      const userCity = (ud.city as string | null) ?? '';
      if (!userCity || userCity.toLowerCase() !== city.toLowerCase()) continue;
      primaryCity = userCity;
    }

    candidates.push({ ...agg, userDetail: ud, primaryCity });
  }

  // 6. Sort by verified hours descending
  candidates.sort((a, b) => b.verifiedHours - a.verifiedHours);
  const totalParticipants = candidates.length;

  // 7. Fetch badges for visible entries + current user (lazy, targeted)
  const visibleIds = candidates.slice(offset, offset + limit).map(c => c.userId);
  const currentUserCandidate = currentUserId
    ? candidates.find(c => c.userId === currentUserId)
    : null;

  const badgeFetchIds = [
    ...new Set([
      ...visibleIds,
      ...(currentUserCandidate ? [currentUserCandidate.userId] : []),
    ]),
  ];

  const badgeMap = new Map<string, LeaderboardEntry['badges']>();

  if (badgeFetchIds.length > 0) {
    try {
      const { data: userBadges } = await supabaseAdmin
        .from('user_badges')
        .select('user_id, badges(id, name, tier, icon_name, condition_type)')
        .in('user_id', badgeFetchIds);

      for (const ub of userBadges ?? []) {
        const badge = (ub as any).badges;
        if (!badge) continue;
        // Only show leaderboard-earned badges on the leaderboard rows
        if (
          !['leaderboard_global_rank', 'leaderboard_monthly_rank'].includes(
            badge.condition_type as string,
          )
        )
          continue;

        const uid = (ub as any).user_id as string;
        if (!badgeMap.has(uid)) badgeMap.set(uid, []);
        badgeMap.get(uid)!.push({
          id: badge.id,
          name: badge.name,
          tier: badge.tier,
          iconName: badge.icon_name,
        });
      }
    } catch {
      // Badge fetch is non-fatal — leaderboard still renders without badges
    }
  }

  // 8. Build final ranked entries
  const allRanked: LeaderboardEntry[] = candidates.map((c, idx) => {
    const isPrivate = !(c.userDetail.profile_public ?? true);
    const rank = idx + 1;
    return {
      rank,
      userId: isPrivate ? null : c.userId,
      name: isPrivate ? 'Anonymous Student' : ((c.userDetail.name as string) ?? 'Student'),
      username: isPrivate ? null : ((c.userDetail.username as string | null) ?? null),
      avatarUrl: isPrivate ? null : ((c.userDetail.avatar_url as string | null) ?? null),
      school: isPrivate ? null : ((c.userDetail.school as string | null) ?? null),
      city: c.primaryCity,
      verifiedHours: c.verifiedHours,
      sessionCount: c.sessionCount,
      isCurrentUser: c.userId === currentUserId,
      isPrivate,
      badges: isPrivate ? [] : (badgeMap.get(c.userId) ?? []),
    };
  });

  const entries = allRanked.slice(offset, offset + limit);

  // Find current user entry regardless of pagination
  let currentUserEntry: LeaderboardEntry | null = null;
  let currentUserRank: number | null = null;
  if (currentUserId) {
    const found = allRanked.find(e => e.isCurrentUser) ?? null;
    if (found) {
      currentUserEntry = found;
      currentUserRank = found.rank;
    }
  }

  return { entries, currentUserEntry, currentUserRank, totalParticipants, period, type };
}

// ─── Personal leaderboard stats (for shareable card) ─────────────────────────

export async function getUserLeaderboardStats(username: string): Promise<{
  user: {
    name: string;
    username: string;
    avatarUrl: string | null;
    school: string | null;
    isPrivate: boolean;
  };
  stats: {
    verifiedHours: number;
    sessionCount: number;
    globalRank: number | null;
    globalTotal: number;
    monthlyRank: number | null;
    schoolRank: number | null;
    schoolTotal: number | null;
  };
  badges: any[];
  topOrgs: { name: string; hours: number }[];
} | null> {
  // Get user
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, name, username, avatar_url, school, profile_public')
    .eq('username', username)
    .is('deleted_at', null)
    .maybeSingle();

  if (!user) return null;

  const userId = (user as any).id as string;

  // Get verified sessions + org names
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('hours, date, org_id, organizations(name)')
    .eq('user_id', userId)
    .eq('status', 'verified')
    .eq('self_reported', false)
    .is('deleted_at', null);

  const verifiedHours = (sessions ?? []).reduce(
    (sum: number, s: any) => sum + ((s.hours as number) ?? 0),
    0,
  );

  // Top orgs
  const orgHoursMap = new Map<string, number>();
  for (const s of sessions ?? []) {
    const orgName = ((s as any).organizations as any)?.name as string | undefined;
    if (orgName) orgHoursMap.set(orgName, (orgHoursMap.get(orgName) ?? 0) + ((s as any).hours ?? 0));
  }
  const topOrgs = Array.from(orgHoursMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, hours]) => ({ name, hours }));

  // Global all-time rank
  const globalResult = await getLeaderboard({
    type: 'global',
    period: 'all',
    currentUserId: userId,
    limit: 1,
  });

  // Monthly rank
  const monthlyResult = await getLeaderboard({
    type: 'global',
    period: 'month',
    currentUserId: userId,
    limit: 1,
  });

  // School rank
  let schoolRank: number | null = null;
  let schoolTotal: number | null = null;
  const userSchool = (user as any).school as string | null;
  if (userSchool) {
    const schoolResult = await getLeaderboard({
      type: 'school',
      period: 'all',
      currentUserId: userId,
      school: userSchool,
      limit: 1,
    });
    schoolRank = schoolResult.currentUserRank;
    schoolTotal = schoolResult.totalParticipants;
  }

  // Badges
  const { data: userBadges } = await supabaseAdmin
    .from('user_badges')
    .select('badges(id, name, tier, icon_name, condition_type)')
    .eq('user_id', userId);

  const badges = (userBadges ?? [])
    .map((ub: any) => ub.badges)
    .filter(Boolean);

  return {
    user: {
      name: (user as any).name as string,
      username: (user as any).username as string,
      avatarUrl: (user as any).avatar_url as string | null,
      school: userSchool,
      isPrivate: !((user as any).profile_public ?? true),
    },
    stats: {
      verifiedHours,
      sessionCount: sessions?.length ?? 0,
      globalRank: globalResult.currentUserRank,
      globalTotal: globalResult.totalParticipants,
      monthlyRank: monthlyResult.currentUserRank,
      schoolRank,
      schoolTotal,
    },
    badges,
    topOrgs,
  };
}

// ─── Nightly leaderboard badge computation ────────────────────────────────────

export async function computeLeaderboardBadges(): Promise<void> {
  if (SUPABASE_MODE === 'mock') {
    logger.info('leaderboard_badges_skipped_mock_mode');
    return;
  }

  logger.info('leaderboard_badges_computation_started');

  // Get all leaderboard badge definitions
  const { data: lbBadges } = await supabaseAdmin
    .from('badges')
    .select('id, name, condition_type, condition_value')
    .in('condition_type', ['leaderboard_global_rank', 'leaderboard_monthly_rank']);

  if (!lbBadges?.length) {
    logger.warn('leaderboard_badges_not_found_in_db');
    return;
  }

  // Get global all-time top 3
  const globalResult = await getLeaderboard({
    type: 'global',
    period: 'all',
    limit: 3,
  });

  // Get monthly top 3
  const monthlyResult = await getLeaderboard({
    type: 'global',
    period: 'month',
    limit: 3,
  });

  // Remove ALL existing leaderboard badges first (so rotating badges reset)
  const lbBadgeIds = lbBadges.map((b: any) => b.id);
  await supabaseAdmin.from('user_badges').delete().in('badge_id', lbBadgeIds);

  // Award global all-time top 3
  for (const entry of globalResult.entries.slice(0, 3)) {
    if (!entry.userId || entry.isPrivate) continue;
    const badge = lbBadges.find(
      (b: any) =>
        b.condition_type === 'leaderboard_global_rank' &&
        (b.condition_value as unknown as number) === entry.rank,
    );
    if (!badge) continue;

    const { error } = await supabaseAdmin.from('user_badges').upsert({
      user_id: entry.userId,
      badge_id: badge.id,
      earned_at: new Date().toISOString(),
    });
    if (error) {
      logger.error({ error, userId: entry.userId, rank: entry.rank }, 'leaderboard_badge_upsert_error');
    } else {
      logger.info(
        { userId: entry.userId, rank: entry.rank, badge: badge.name },
        'leaderboard_global_badge_awarded',
      );
    }
  }

  // Award monthly top 3
  for (const entry of monthlyResult.entries.slice(0, 3)) {
    if (!entry.userId || entry.isPrivate) continue;
    const badge = lbBadges.find(
      (b: any) =>
        b.condition_type === 'leaderboard_monthly_rank' &&
        (b.condition_value as unknown as number) === entry.rank,
    );
    if (!badge) continue;

    await supabaseAdmin.from('user_badges').upsert({
      user_id: entry.userId,
      badge_id: badge.id,
      earned_at: new Date().toISOString(),
    });
  }

  // Cache top-100 global ranks on users table for quick reads
  for (const entry of globalResult.entries.slice(0, 100)) {
    if (!entry.userId) continue;
    await supabaseAdmin
      .from('users')
      .update({
        leaderboard_rank_global: entry.rank,
        leaderboard_updated_at: new Date().toISOString(),
      })
      .eq('id', entry.userId);
  }

  logger.info(
    {
      globalEntries: globalResult.entries.length,
      monthlyEntries: monthlyResult.entries.length,
    },
    'leaderboard_badges_computation_complete',
  );
}
