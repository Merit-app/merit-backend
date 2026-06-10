import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { getCoordinatorChapterId } from './admin.service';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StudentStatus = 'met' | 'on_track' | 'at_risk' | 'overdue' | 'no_goal';

export interface RosterStudent {
  id: string;
  name: string;
  email: string;
  graduationYear: number | null;
  verifiedHours: number;   // sessions + adjustments
  goal: number;            // effective goal (override > cohort > chapter)
  remaining: number;
  met: boolean;
  status: StudentStatus;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

interface ChapterCtx {
  id: string;
  name: string;
  requiredHours: number;
  deadline: string | null;
  riskWindowDays: number;
  cohortGoals: Map<number, number>;
}

async function loadChapterCtx(userId: string): Promise<ChapterCtx> {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('id, name, required_hours, requirement_deadline, risk_window_days')
    .eq('id', chapterId)
    .single();

  if (!chapter) throw new NotFoundError('Chapter');

  const { data: goals } = await supabaseAdmin
    .from('chapter_cohort_goals')
    .select('graduation_year, required_hours')
    .eq('chapter_id', chapterId);

  const cohortGoals = new Map<number, number>();
  for (const g of (goals as any[] | null) ?? []) {
    cohortGoals.set(Number(g.graduation_year), Number(g.required_hours));
  }

  return {
    id: chapterId,
    name: (chapter as any).name,
    requiredHours: Number((chapter as any).required_hours ?? 0),
    deadline: (chapter as any).requirement_deadline ?? null,
    riskWindowDays: Number((chapter as any).risk_window_days ?? 60),
    cohortGoals,
  };
}

function effectiveGoal(ctx: ChapterCtx, gradYear: number | null, override: number | null): number {
  if (override != null) return override;
  if (gradYear != null && ctx.cohortGoals.has(gradYear)) return ctx.cohortGoals.get(gradYear)!;
  return ctx.requiredHours;
}

function computeStatus(ctx: ChapterCtx, hours: number, goal: number): StudentStatus {
  if (goal <= 0) return 'no_goal';
  if (hours >= goal) return 'met';
  if (ctx.deadline) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysLeft = Math.ceil((new Date(ctx.deadline).getTime() - Date.now()) / msPerDay);
    if (daysLeft < 0) return 'overdue';
    if (daysLeft <= ctx.riskWindowDays) return 'at_risk';
  }
  return 'on_track';
}

/** Verified, non-self-reported session hours per member, plus coordinator adjustments. */
async function hoursByMember(memberIds: string[], chapterId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (memberIds.length === 0) return map;

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('user_id, hours')
    .in('user_id', memberIds)
    .eq('status', 'verified')
    .eq('self_reported', false)
    .is('deleted_at', null);
  for (const s of (sessions as any[] | null) ?? []) {
    map.set(s.user_id, (map.get(s.user_id) ?? 0) + Number(s.hours ?? 0));
  }

  const { data: adj } = await supabaseAdmin
    .from('chapter_hour_adjustments')
    .select('user_id, hours')
    .eq('chapter_id', chapterId)
    .in('user_id', memberIds);
  for (const a of (adj as any[] | null) ?? []) {
    map.set(a.user_id, (map.get(a.user_id) ?? 0) + Number(a.hours ?? 0));
  }

  return map;
}

// ─── Overview ───────────────────────────────────────────────────────────────

export async function getOverview(userId: string) {
  const ctx = await loadChapterCtx(userId);

  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, graduation_year, chapter_goal_override')
    .eq('chapter_id', ctx.id)
    .is('deleted_at', null);

  const memberList = (members as any[] | null) ?? [];
  const ids = memberList.map((m) => m.id as string);
  const hours = await hoursByMember(ids, ctx.id);

  let met = 0, atRisk = 0, totalHours = 0;
  for (const m of memberList) {
    const h = hours.get(m.id) ?? 0;
    totalHours += h;
    const goal = effectiveGoal(ctx, m.graduation_year, m.chapter_goal_override);
    const status = computeStatus(ctx, h, goal);
    if (status === 'met') met++;
    if (status === 'at_risk' || status === 'overdue') atRisk++;
  }

  const daysToDeadline = ctx.deadline
    ? Math.ceil((new Date(ctx.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    chapterName: ctx.name,
    requiredHours: ctx.requiredHours,
    deadline: ctx.deadline,
    daysToDeadline,
    totalStudents: memberList.length,
    metCount: met,
    atRiskCount: atRisk,
    incompleteCount: memberList.length - met,
    avgHours: memberList.length ? Math.round((totalHours / memberList.length) * 10) / 10 : 0,
  };
}

// ─── Roster (search + filter) ───────────────────────────────────────────────

export async function getRoster(
  userId: string,
  opts: { search?: string; filter?: string } = {},
): Promise<{ students: RosterStudent[]; total: number }> {
  const ctx = await loadChapterCtx(userId);

  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, name, email, graduation_year, chapter_goal_override')
    .eq('chapter_id', ctx.id)
    .is('deleted_at', null)
    .order('name');

  const memberList = (members as any[] | null) ?? [];
  const ids = memberList.map((m) => m.id as string);
  const hours = await hoursByMember(ids, ctx.id);

  let students: RosterStudent[] = memberList.map((m) => {
    const h = hours.get(m.id) ?? 0;
    const goal = effectiveGoal(ctx, m.graduation_year, m.chapter_goal_override);
    const status = computeStatus(ctx, h, goal);
    return {
      id: m.id,
      name: m.name ?? 'Student',
      email: m.email ?? '',
      graduationYear: m.graduation_year ?? null,
      verifiedHours: Math.round(h * 10) / 10,
      goal,
      remaining: Math.max(0, goal - h),
      met: status === 'met',
      status,
    };
  });

  const total = students.length;

  // Search by name or email
  const search = (opts.search ?? '').trim().toLowerCase();
  if (search) {
    students = students.filter(
      (s) => s.name.toLowerCase().includes(search) || s.email.toLowerCase().includes(search),
    );
  }

  // Filter chips
  switch (opts.filter) {
    case 'met':
      students = students.filter((s) => s.met);
      break;
    case 'incomplete':
      students = students.filter((s) => !s.met && s.status !== 'no_goal');
      break;
    case 'at_risk':
      students = students.filter((s) => s.status === 'at_risk' || s.status === 'overdue');
      break;
    default:
      break;
  }

  // Sort: most behind first, then met last
  students.sort((a, b) => {
    if (a.met !== b.met) return a.met ? 1 : -1;
    return b.remaining - a.remaining;
  });

  return { students, total };
}

// ─── Student detail ─────────────────────────────────────────────────────────

export async function getStudentDetail(userId: string, studentId: string) {
  const ctx = await loadChapterCtx(userId);

  const { data: student } = await supabaseAdmin
    .from('users')
    .select('id, name, email, graduation_year, school, chapter_goal_override, chapter_id, avatar_url, username')
    .eq('id', studentId)
    .maybeSingle();

  const s = student as any;
  if (!s || s.chapter_id !== ctx.id) throw new NotFoundError('Student');

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('id, hours, date, status, self_reported, org:organizations(name)')
    .eq('user_id', studentId)
    .is('deleted_at', null)
    .order('date', { ascending: false });

  const { data: adjustments } = await supabaseAdmin
    .from('chapter_hour_adjustments')
    .select('id, hours, reason, created_at')
    .eq('chapter_id', ctx.id)
    .eq('user_id', studentId)
    .order('created_at', { ascending: false });

  const verifiedHours =
    ((sessions as any[] | null) ?? [])
      .filter((x: any) => x.status === 'verified' && !x.self_reported)
      .reduce((sum: number, x: any) => sum + Number(x.hours ?? 0), 0) +
    ((adjustments as any[] | null) ?? []).reduce((sum: number, a: any) => sum + Number(a.hours ?? 0), 0);

  const goal = effectiveGoal(ctx, s.graduation_year, s.chapter_goal_override);
  const status = computeStatus(ctx, verifiedHours, goal);

  return {
    student: {
      id: s.id,
      name: s.name,
      email: s.email,
      username: s.username ?? null,
      avatarUrl: s.avatar_url ?? null,
      school: s.school ?? null,
      graduationYear: s.graduation_year ?? null,
      goalOverride: s.chapter_goal_override ?? null,
    },
    goal,
    verifiedHours: Math.round(verifiedHours * 10) / 10,
    remaining: Math.max(0, goal - verifiedHours),
    status,
    deadline: ctx.deadline,
    sessions: ((sessions as any[] | null) ?? []).map((x: any) => ({
      id: x.id,
      hours: Number(x.hours ?? 0),
      date: x.date,
      status: x.status,
      selfReported: !!x.self_reported,
      orgName: x.org?.name ?? null,
    })),
    adjustments: ((adjustments as any[] | null) ?? []).map((a: any) => ({
      id: a.id,
      hours: Number(a.hours ?? 0),
      reason: a.reason ?? null,
      createdAt: a.created_at,
    })),
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

async function assertStudentInChapter(chapterId: string, studentId: string) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, chapter_id')
    .eq('id', studentId)
    .maybeSingle();
  if (!data || (data as any).chapter_id !== chapterId) throw new NotFoundError('Student');
}

export async function setStudentOverride(userId: string, studentId: string, hours: number | null) {
  const ctx = await loadChapterCtx(userId);
  await assertStudentInChapter(ctx.id, studentId);
  const value = hours == null ? null : Math.max(0, Math.trunc(hours));
  const { error } = await supabaseAdmin
    .from('users')
    .update({ chapter_goal_override: value })
    .eq('id', studentId);
  if (error) throw new AppError('update_failed', 'Failed to set goal.', 500);
  return { goalOverride: value };
}

export async function setCohortGoal(userId: string, graduationYear: number, requiredHours: number) {
  const ctx = await loadChapterCtx(userId);
  const { error } = await supabaseAdmin
    .from('chapter_cohort_goals')
    .upsert(
      {
        chapter_id: ctx.id,
        graduation_year: Math.trunc(graduationYear),
        required_hours: Math.max(0, Math.trunc(requiredHours)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chapter_id,graduation_year' },
    );
  if (error) {
    logger.error({ error }, 'cohort_goal_upsert_failed');
    throw new AppError('update_failed', 'Failed to set cohort goal.', 500);
  }
  return { graduationYear, requiredHours };
}

export async function listCohortGoals(userId: string) {
  const ctx = await loadChapterCtx(userId);
  const { data } = await supabaseAdmin
    .from('chapter_cohort_goals')
    .select('graduation_year, required_hours')
    .eq('chapter_id', ctx.id)
    .order('graduation_year');
  return ((data as any[] | null) ?? []).map((g) => ({
    graduationYear: Number(g.graduation_year),
    requiredHours: Number(g.required_hours),
  }));
}

export async function adjustHours(
  userId: string,
  studentId: string,
  hours: number,
  reason: string | undefined,
) {
  const ctx = await loadChapterCtx(userId);
  await assertStudentInChapter(ctx.id, studentId);
  if (!Number.isFinite(hours) || hours === 0) {
    throw new AppError('invalid_hours', 'Adjustment hours must be a non-zero number.', 400);
  }
  const { error } = await supabaseAdmin.from('chapter_hour_adjustments').insert({
    chapter_id: ctx.id,
    user_id: studentId,
    hours,
    reason: reason ? reason.slice(0, 300) : null,
    created_by: userId,
  });
  if (error) throw new AppError('adjust_failed', 'Failed to record adjustment.', 500);
  return { ok: true };
}

export async function updateSettings(
  userId: string,
  input: { requiredHours?: number; requirementDeadline?: string | null; riskWindowDays?: number },
) {
  const chapterId = await getCoordinatorChapterId(userId);
  const patch: Record<string, any> = {};
  if (input.requiredHours !== undefined) patch.required_hours = Math.max(0, Math.trunc(input.requiredHours));
  if (input.requirementDeadline !== undefined) patch.requirement_deadline = input.requirementDeadline || null;
  if (input.riskWindowDays !== undefined) patch.risk_window_days = Math.max(1, Math.trunc(input.riskWindowDays));
  if (Object.keys(patch).length === 0) return { updated: false };

  const { error } = await supabaseAdmin.from('chapters').update(patch).eq('id', chapterId);
  if (error) throw new AppError('update_failed', 'Failed to update settings.', 500);
  return { updated: true };
}
