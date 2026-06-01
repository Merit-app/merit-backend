import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────

interface Badge {
  id: string;
  name: string;
  description: string;
  tier: string;
  icon_name: string;
  condition_type: string;
  condition_value: Record<string, number>;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

interface UserStats {
  sessionCount: number;
  verifiedSessionCount: number;
  verifiedHours: number;
  totalHours: number;
  uniqueOrgCount: number;
  weeklyStreak: number;
  monthlyStreak: number;
  dayStreak: number;
}

// ─── Streak helpers ───────────────────────────────────────────────────────

function getStartOfWeekMs(date: Date): number {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // shift to Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getStartOfDayMs(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Count consecutive units (weeks/days) from the most recent backwards. */
function computeFixedUnitStreak(timestamps: number[], unitMs: number): number {
  if (timestamps.length === 0) return 0;
  const unique = [...new Set(timestamps)].sort((a, b) => b - a);
  let streak = 1;
  for (let i = 0; i < unique.length - 1; i++) {
    if (unique[i]! - unique[i + 1]! === unitMs) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/** Monthly streak — months vary in length so we compare year*12+month values. */
function computeMonthlyStreak(dates: Date[]): number {
  if (dates.length === 0) return 0;

  // Unique year*12+month keys, sorted descending
  const monthKeys = [
    ...new Set(dates.map((d) => d.getFullYear() * 12 + d.getMonth())),
  ].sort((a, b) => b - a);

  let streak = 1;
  for (let i = 0; i < monthKeys.length - 1; i++) {
    if (monthKeys[i]! - monthKeys[i + 1]! === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ─── Stats computation ────────────────────────────────────────────────────

async function getUserStats(userId: string): Promise<UserStats> {
  const { data: sessions, error } = await supabaseAdmin
    .from('sessions')
    .select('hours, status, org_id, date')
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error || !sessions || sessions.length === 0) {
    return {
      sessionCount: 0,
      verifiedSessionCount: 0,
      verifiedHours: 0,
      totalHours: 0,
      uniqueOrgCount: 0,
      weeklyStreak: 0,
      monthlyStreak: 0,
      dayStreak: 0,
    };
  }

  const verified = sessions.filter((s: any) => s.status === 'verified');
  const dates = sessions.map((s: any) => new Date(s.date as string));
  const uniqueOrgIds = new Set(
    sessions.map((s: any) => s.org_id).filter(Boolean),
  );

  return {
    sessionCount: sessions.length,
    verifiedSessionCount: verified.length,
    verifiedHours: verified.reduce((sum: number, s: any) => sum + ((s.hours as number) ?? 0), 0),
    totalHours: sessions.reduce((sum: number, s: any) => sum + ((s.hours as number) ?? 0), 0),
    uniqueOrgCount: uniqueOrgIds.size,
    weeklyStreak: computeFixedUnitStreak(dates.map(getStartOfWeekMs), WEEK_MS),
    monthlyStreak: computeMonthlyStreak(dates),
    dayStreak: computeFixedUnitStreak(dates.map(getStartOfDayMs), DAY_MS),
  };
}

async function checkSingleOrgHours(userId: string, minHours: number): Promise<boolean> {
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('org_id, hours')
    .eq('user_id', userId)
    .eq('status', 'verified')
    .is('deleted_at', null);

  if (!sessions || sessions.length === 0) return false;

  const orgHours: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.org_id) continue;
    orgHours[s.org_id as string] = (orgHours[s.org_id as string] ?? 0) + ((s.hours as number) ?? 0);
  }

  return Object.values(orgHours).some((h) => h >= minHours);
}

// ─── Condition checker ────────────────────────────────────────────────────

async function checkCondition(
  badge: Badge,
  stats: UserStats,
  userId: string,
): Promise<boolean> {
  const val = badge.condition_value;
  switch (badge.condition_type) {
    case 'session_count':
      return stats.sessionCount >= val['min']!;
    case 'verified_count':
      return stats.verifiedSessionCount >= val['min']!;
    case 'verified_hours':
      return stats.verifiedHours >= val['min']!;
    case 'total_hours':
      return stats.totalHours >= val['min']!;
    case 'unique_orgs':
      return stats.uniqueOrgCount >= val['min']!;
    case 'weekly_streak':
      return stats.weeklyStreak >= val['min']!;
    case 'monthly_streak':
      return stats.monthlyStreak >= val['min']!;
    case 'day_streak':
      return stats.dayStreak >= val['min']!;
    case 'single_org_hours':
      return checkSingleOrgHours(userId, val['min']!);
    case 'verification_rate': {
      if (stats.sessionCount < val['min_sessions']!) return false;
      const rate = stats.verifiedSessionCount / stats.sessionCount;
      return rate >= val['min_rate']!;
    }
    default:
      return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/** Compute and upsert earned badges for a user. Idempotent — safe to call repeatedly. */
export async function computeBadgesForUser(userId: string): Promise<Badge[]> {
  if (SUPABASE_MODE === 'mock') return [];

  const [stats, badgesResult] = await Promise.all([
    getUserStats(userId),
    supabaseAdmin
      .from('badges')
      .select('*')
      .eq('is_active', true)
      .order('display_order'),
  ]);

  const allBadges = (badgesResult.data ?? []) as Badge[];

  // Run all badge condition checks in parallel instead of serially
  const results = await Promise.all(
    allBadges.map(async (badge) => {
      const passed = await checkCondition(badge, stats, userId);
      return passed ? badge : null;
    }),
  );
  const earned = results.filter((b): b is Badge => b !== null);

  if (earned.length > 0) {
    const rows = earned.map((b) => ({ user_id: userId, badge_id: b.id }));
    const { error } = await supabaseAdmin
      .from('user_badges')
      .upsert(rows, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });

    if (error) {
      logger.error({ userId, error }, 'badge_upsert_failed');
    }
  }

  return earned;
}

/** Return all badges a user has already earned (from user_badges table). */
export async function getEarnedBadgesForUser(
  userId: string,
): Promise<Array<{ badge: Badge; earnedAt: string }>> {
  if (SUPABASE_MODE === 'mock') return [];

  const { data, error } = await supabaseAdmin
    .from('user_badges')
    .select('earned_at, badge:badges(*)')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });

  if (error || !data) return [];

  return (data as Array<{ earned_at: string; badge: Badge }>).map((row) => ({
    badge: row.badge,
    earnedAt: row.earned_at,
  }));
}

/** Return all badge definitions merged with whether the user has earned each one. */
export async function getAllBadgesWithProgress(userId: string): Promise<
  Array<{
    badge: Badge;
    earned: boolean;
    earnedAt?: string;
  }>
> {
  if (SUPABASE_MODE === 'mock') return [];

  const [allBadgesResult, earnedResult] = await Promise.all([
    supabaseAdmin
      .from('badges')
      .select('*')
      .eq('is_active', true)
      .order('display_order'),
    supabaseAdmin
      .from('user_badges')
      .select('badge_id, earned_at')
      .eq('user_id', userId),
  ]);

  const allBadges = (allBadgesResult.data ?? []) as Badge[];
  const earnedMap = new Map<string, string>(
    (earnedResult.data ?? []).map((r: any) => [r.badge_id as string, r.earned_at as string]),
  );

  return allBadges.map((badge) => ({
    badge,
    earned: earnedMap.has(badge.id),
    earnedAt: earnedMap.get(badge.id),
  }));
}

/** Badge rarity stats (refreshed daily by cron). */
export async function getBadgeStats() {
  const { data } = await supabaseAdmin.from('badge_stats').select('*');
  return data ?? [];
}
