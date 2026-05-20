import { supabaseAdmin } from '../config/supabase';

interface SessionRow {
  id?: string;
  hours: number | string;
  status: string;
  verification_tier?: string;
  date: string;
  org_id?: string;
  org?: unknown;
}

// ─── Dashboard summary ────────────────────────────────────────────────────

export async function getDashboardStats(userId: string) {
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('id, hours, status, verification_tier, date, org_id')
    .eq('user_id', userId)
    .is('deleted_at', null);

  const all: SessionRow[] = (sessions as SessionRow[] | null) ?? [];

  const totalHours = all.reduce((sum, s) => sum + Number(s.hours), 0);
  const verifiedHours = all
    .filter((s) => s.status === 'verified')
    .reduce((sum, s) => sum + Number(s.hours), 0);
  const pendingCount = all.filter((s) => s.status === 'pending').length;
  const disputedCount = all.filter((s) => s.status === 'disputed').length;
  const verifiedCount = all.filter((s) => s.status === 'verified').length;
  const uniqueOrgs = new Set(all.map((s) => s.org_id)).size;

  const institutionalHours = all
    .filter((s) => s.verification_tier === 'verified_institutional')
    .reduce((sum, s) => sum + Number(s.hours), 0);

  // Current activity streak: consecutive weeks with at least one session
  const streak = calculateStreak(all.map((s) => s.date));

  return {
    totalHours,
    verifiedHours,
    pendingCount,
    disputedCount,
    verifiedCount,
    uniqueOrgs,
    institutionalHours,
    streak,
    verificationRate: all.length > 0 ? Math.round((verifiedCount / all.length) * 100) : 0,
  };
}

// ─── Weekly hours (last N weeks) ──────────────────────────────────────────

export async function getWeeklyStats(userId: string, weeks = 12) {
  const from = new Date();
  from.setDate(from.getDate() - weeks * 7);
  const fromStr = from.toISOString().split('T')[0];

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('date, hours, status')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', fromStr)
    .order('date', { ascending: true });

  const buckets: Record<string, { week: string; hours: number; verifiedHours: number; count: number }> = {};

  for (const s of (sessions as SessionRow[] | null) ?? []) {
    const week = getWeekStart(s.date);
    if (!buckets[week]) buckets[week] = { week, hours: 0, verifiedHours: 0, count: 0 };
    buckets[week].hours += Number(s.hours);
    buckets[week].count += 1;
    if (s.status === 'verified') buckets[week].verifiedHours += Number(s.hours);
  }

  // Fill in empty weeks so chart has continuous x-axis
  const result = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (weeks - 1 - i) * 7);
    const week = getWeekStart(d.toISOString().split('T')[0]);
    result.push(buckets[week] ?? { week, hours: 0, verifiedHours: 0, count: 0 });
  }

  return result;
}

// ─── By-organization breakdown ────────────────────────────────────────────

export async function getOrgStats(userId: string) {
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('hours, status, org:organizations(id, name, city, state)')
    .eq('user_id', userId)
    .is('deleted_at', null);

  const orgMap: Record<
    string,
    { orgId: string; orgName: string; city: string | null; state: string | null; totalHours: number; verifiedHours: number; sessionCount: number }
  > = {};

  for (const s of (sessions as SessionRow[] | null) ?? []) {
    const org = s.org as any;
    if (!org) continue;
    const key = org.id;
    if (!orgMap[key]) {
      orgMap[key] = { orgId: org.id, orgName: org.name, city: org.city ?? null, state: org.state ?? null, totalHours: 0, verifiedHours: 0, sessionCount: 0 };
    }
    orgMap[key].totalHours += Number(s.hours);
    orgMap[key].sessionCount += 1;
    if (s.status === 'verified') orgMap[key].verifiedHours += Number(s.hours);
  }

  return Object.values(orgMap).sort((a, b) => b.totalHours - a.totalHours);
}

// ─── Monthly breakdown ────────────────────────────────────────────────────

export async function getMonthlyStats(userId: string, months = 12) {
  const from = new Date();
  from.setMonth(from.getMonth() - months + 1);
  from.setDate(1);
  const fromStr = from.toISOString().split('T')[0];

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('date, hours, status')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', fromStr)
    .order('date', { ascending: true });

  const buckets: Record<string, { month: string; hours: number; verifiedHours: number; count: number }> = {};

  for (const s of (sessions as SessionRow[] | null) ?? []) {
    const month = s.date.slice(0, 7); // YYYY-MM
    if (!buckets[month]) buckets[month] = { month, hours: 0, verifiedHours: 0, count: 0 };
    buckets[month].hours += Number(s.hours);
    buckets[month].count += 1;
    if (s.status === 'verified') buckets[month].verifiedHours += Number(s.hours);
  }

  // Fill in empty months
  const result = [];
  for (let i = 0; i < months; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - (months - 1 - i));
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result.push(buckets[month] ?? { month, hours: 0, verifiedHours: 0, count: 0 });
  }

  return result;
}

// ─── Goal progress ────────────────────────────────────────────────────────

export async function getGoalProgress(userId: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('goal_hours, goal_program')
    .eq('id', userId)
    .maybeSingle();

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('hours, status')
    .eq('user_id', userId)
    .is('deleted_at', null);

  const goalHours = (user as any)?.goal_hours ?? 75;
  const rows: SessionRow[] = (sessions as SessionRow[] | null) ?? [];
  const totalHours = rows.reduce((sum: number, s: SessionRow) => sum + Number(s.hours), 0);
  const verifiedHours = rows
    .filter((s: SessionRow) => s.status === 'verified')
    .reduce((sum: number, s: SessionRow) => sum + Number(s.hours), 0);

  return {
    goalHours,
    goalProgram: (user as any)?.goal_program ?? null,
    totalHours,
    verifiedHours,
    percentComplete: goalHours > 0 ? Math.min(100, Math.round((verifiedHours / goalHours) * 100)) : 0,
    remaining: Math.max(0, goalHours - verifiedHours),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  // ISO week starts Monday
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function calculateStreak(dates: string[]): number {
  if (!dates.length) return 0;
  const weeks = new Set(dates.map(getWeekStart));
  const sorted = Array.from(weeks).sort().reverse();

  const thisWeek = getWeekStart(new Date().toISOString().split('T')[0]);
  const lastWeek = getWeekStart(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  );

  // Streak only counts if there's an entry this week or last week
  if (sorted[0] !== thisWeek && sorted[0] !== lastWeek) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (prev.getTime() - curr.getTime()) / (7 * 24 * 60 * 60 * 1000);
    if (Math.round(diff) === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
