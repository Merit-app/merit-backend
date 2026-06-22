import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { getCoordinatorChapterId } from './admin.service';
import { createManyNotifications } from './notifications.service';
import { assertPermission } from './chapter-team.service';
import { logChapterAction } from './chapter-audit.service';

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

  const { data: student, error: studentErr } = await supabaseAdmin
    .from('users')
    .select('id, name, email, graduation_year, school, chapter_goal_override, chapter_id, avatar_url, username')
    .eq('id', studentId)
    .maybeSingle();

  // A failed query (e.g. a missing column → 42703) is NOT the same as "no such
  // student" — don't let it masquerade as a 404. Surface it so it's diagnosable.
  if (studentErr) {
    logger.error({ studentErr, studentId, ctxId: ctx.id }, 'student_detail_query_failed');
    throw new AppError('query_failed', 'Could not load the student.', 500);
  }

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

export async function removeStudent(userId: string, studentId: string) {
  const ctx = await loadChapterCtx(userId);
  await assertPermission(userId, ctx.id, 'manage_team');
  await assertStudentInChapter(ctx.id, studentId);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ chapter_id: null, chapter_consent_at: null, chapter_goal_override: null })
    .eq('id', studentId)
    .eq('chapter_id', ctx.id); // guard: only unlink if still in THIS chapter
  if (error) throw new AppError('update_failed', 'Failed to remove student.', 500);
  void logChapterAction(ctx.id, userId, 'remove_student', { targetUserId: studentId });
  return { removed: true };
}

export async function setStudentOverride(userId: string, studentId: string, hours: number | null) {
  const ctx = await loadChapterCtx(userId);
  await assertPermission(userId, ctx.id, 'edit_goals');
  await assertStudentInChapter(ctx.id, studentId);
  const value = hours == null ? null : Math.max(0, Math.trunc(hours));
  const { error } = await supabaseAdmin
    .from('users')
    .update({ chapter_goal_override: value })
    .eq('id', studentId);
  if (error) throw new AppError('update_failed', 'Failed to set goal.', 500);
  void logChapterAction(ctx.id, userId, 'set_student_goal', { targetUserId: studentId, detail: value == null ? 'cleared override' : `${value} hrs` });
  return { goalOverride: value };
}

export async function setCohortGoal(userId: string, graduationYear: number, requiredHours: number) {
  const ctx = await loadChapterCtx(userId);
  await assertPermission(userId, ctx.id, 'edit_goals');
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
  await assertPermission(userId, ctx.id, 'approve_hours');
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
  void logChapterAction(ctx.id, userId, 'adjust_hours', { targetUserId: studentId, detail: `${hours >= 0 ? '+' : ''}${hours} hrs${reason ? ` — ${reason}` : ''}` });
  return { ok: true };
}

export async function updateSettings(
  userId: string,
  input: { requiredHours?: number; requirementDeadline?: string | null; riskWindowDays?: number; remindersEnabled?: boolean },
) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_settings');
  const patch: Record<string, any> = {};
  if (input.requiredHours !== undefined) patch.required_hours = Math.max(0, Math.trunc(input.requiredHours));
  if (input.requirementDeadline !== undefined) patch.requirement_deadline = input.requirementDeadline || null;
  if (input.riskWindowDays !== undefined) patch.risk_window_days = Math.max(1, Math.trunc(input.riskWindowDays));
  if (input.remindersEnabled !== undefined) patch.reminders_enabled = input.remindersEnabled;
  if (Object.keys(patch).length === 0) return { updated: false };

  const { error } = await supabaseAdmin.from('chapters').update(patch).eq('id', chapterId);
  if (error) throw new AppError('update_failed', 'Failed to update settings.', 500);
  void logChapterAction(chapterId, userId, 'update_settings', { detail: Object.keys(patch).join(', ') });
  return { updated: true };
}

// ─── Student data control (consent + leave) ─────────────────────────────────

export async function acknowledgeConsent(userId: string) {
  await supabaseAdmin.from('users').update({ chapter_consent_at: new Date().toISOString() }).eq('id', userId);
  return { acknowledged: true };
}

export async function leaveChapter(userId: string) {
  // Student-initiated exit: detach from the chapter and clear chapter-scoped fields.
  await supabaseAdmin
    .from('users')
    .update({ chapter_id: null, chapter_consent_at: null, chapter_goal_override: null })
    .eq('id', userId);
  return { left: true };
}

// ─── Member-status helper (shared by announcements + reminders) ──────────────

interface MemberStatus {
  id: string;
  name: string;
  goal: number;
  hours: number;
  remaining: number;
  status: StudentStatus;
}

async function membersWithStatus(ctx: ChapterCtx): Promise<MemberStatus[]> {
  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, name, graduation_year, chapter_goal_override')
    .eq('chapter_id', ctx.id)
    .is('deleted_at', null);
  const list = (members as any[] | null) ?? [];
  const ids = list.map((m) => m.id as string);
  const hours = await hoursByMember(ids, ctx.id);
  return list.map((m) => {
    const h = hours.get(m.id) ?? 0;
    const goal = effectiveGoal(ctx, m.graduation_year, m.chapter_goal_override);
    return {
      id: m.id,
      name: m.name ?? 'Student',
      goal,
      hours: h,
      remaining: Math.max(0, goal - h),
      status: computeStatus(ctx, h, goal),
    };
  });
}

function audienceFilter(students: MemberStatus[], audience: string): MemberStatus[] {
  switch (audience) {
    case 'met': return students.filter((s) => s.status === 'met');
    case 'incomplete': return students.filter((s) => s.status !== 'met' && s.status !== 'no_goal');
    case 'at_risk': return students.filter((s) => s.status === 'at_risk' || s.status === 'overdue');
    default: return students;
  }
}

// ─── Announcements (mass messaging) ─────────────────────────────────────────

export async function sendAnnouncement(
  userId: string,
  input: { title: string; body: string; audience: string },
): Promise<{ sent: number }> {
  const ctx = await loadChapterCtx(userId);
  await assertPermission(userId, ctx.id, 'message_students');
  const students = audienceFilter(await membersWithStatus(ctx), input.audience);
  const ids = students.map((s) => s.id);

  const sent = await createManyNotifications(ids, {
    type: 'chapter_announcement',
    title: input.title.slice(0, 140),
    body: input.body.slice(0, 1000),
    actionUrl: '/my-chapter',
  });

  logger.info({ chapterId: ctx.id, audience: input.audience, sent }, 'chapter_announcement_sent');
  return { sent };
}

/** Manual "remind everyone who's behind" — coordinator-triggered. */
export async function remindBehind(userId: string): Promise<{ sent: number }> {
  const ctx = await loadChapterCtx(userId);
  await assertPermission(userId, ctx.id, 'message_students');
  const behind = (await membersWithStatus(ctx)).filter(
    (s) => s.status !== 'met' && s.status !== 'no_goal',
  );

  let sent = 0;
  // Personalised remaining-hours line per student.
  for (const s of behind) {
    const due = ctx.deadline ? ` by ${new Date(ctx.deadline).toLocaleDateString()}` : '';
    const ok = await createManyNotifications([s.id], {
      type: 'chapter_reminder',
      title: `${s.remaining} hours left to meet your requirement`,
      body: `You have ${s.hours}/${s.goal} verified hours. Log ${s.remaining} more${due} to stay on track. Tap to see your progress.`,
      actionUrl: '/my-chapter',
    });
    sent += ok;
  }
  logger.info({ chapterId: ctx.id, sent }, 'chapter_remind_behind');
  return { sent };
}

// ─── Automated weekly reminders (cron) ──────────────────────────────────────

/** Notify at-risk students in every chapter that has reminders enabled and a
 *  deadline inside its risk window. Run weekly to avoid spamming. */
export async function runWeeklyChapterReminders(): Promise<{ chapters: number; sent: number }> {
  const { data: chapters } = await supabaseAdmin
    .from('chapters')
    .select('id, name, required_hours, requirement_deadline, risk_window_days, reminders_enabled')
    .eq('active', true)
    .eq('reminders_enabled', true)
    .not('requirement_deadline', 'is', null);

  let totalSent = 0;
  let touched = 0;

  for (const c of (chapters as any[] | null) ?? []) {
    const deadline = c.requirement_deadline as string;
    const daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    const riskWindow = Number(c.risk_window_days ?? 60);
    if (daysLeft < 0 || daysLeft > riskWindow) continue; // only nudge inside the window

    // Build a minimal ctx for this chapter
    const { data: goals } = await supabaseAdmin
      .from('chapter_cohort_goals')
      .select('graduation_year, required_hours')
      .eq('chapter_id', c.id);
    const cohortGoals = new Map<number, number>();
    for (const g of (goals as any[] | null) ?? []) cohortGoals.set(Number(g.graduation_year), Number(g.required_hours));

    const ctx: ChapterCtx = {
      id: c.id,
      name: c.name,
      requiredHours: Number(c.required_hours ?? 0),
      deadline,
      riskWindowDays: riskWindow,
      cohortGoals,
    };

    const atRisk = (await membersWithStatus(ctx)).filter(
      (s) => s.status === 'at_risk' || s.status === 'overdue',
    );
    for (const s of atRisk) {
      totalSent += await createManyNotifications([s.id], {
        type: 'chapter_reminder',
        title: `Reminder: ${s.remaining} hours left`,
        body: `${daysLeft} days until your ${ctx.name} deadline. You have ${s.hours}/${s.goal} verified hours.`,
        actionUrl: '/my-chapter',
      });
    }
    touched++;
  }

  logger.info({ chapters: touched, sent: totalSent }, 'weekly_chapter_reminders_done');
  return { chapters: touched, sent: totalSent };
}

// ─── Student-facing: "My Chapter" ───────────────────────────────────────────

export async function getMyChapter(userId: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, chapter_id, graduation_year, chapter_goal_override, chapter_consent_at, is_minor')
    .eq('id', userId)
    .maybeSingle();

  const u = user as any;
  if (!u?.chapter_id) return null; // not in a chapter

  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('id, name, required_hours, requirement_deadline, risk_window_days')
    .eq('id', u.chapter_id)
    .maybeSingle();
  if (!chapter) return null;

  const { data: goals } = await supabaseAdmin
    .from('chapter_cohort_goals')
    .select('graduation_year, required_hours')
    .eq('chapter_id', u.chapter_id);
  const cohortGoals = new Map<number, number>();
  for (const g of (goals as any[] | null) ?? []) cohortGoals.set(Number(g.graduation_year), Number(g.required_hours));

  const ctx: ChapterCtx = {
    id: (chapter as any).id,
    name: (chapter as any).name,
    requiredHours: Number((chapter as any).required_hours ?? 0),
    deadline: (chapter as any).requirement_deadline ?? null,
    riskWindowDays: Number((chapter as any).risk_window_days ?? 60),
    cohortGoals,
  };

  const hoursMap = await hoursByMember([userId], ctx.id);
  const hours = hoursMap.get(userId) ?? 0;
  const goal = effectiveGoal(ctx, u.graduation_year, u.chapter_goal_override);
  const status = computeStatus(ctx, hours, goal);

  const daysToDeadline = ctx.deadline
    ? Math.ceil((new Date(ctx.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    chapterName: ctx.name,
    goal,
    verifiedHours: Math.round(hours * 10) / 10,
    remaining: Math.max(0, goal - hours),
    status,
    deadline: ctx.deadline,
    daysToDeadline,
    consentGiven: u.chapter_consent_at != null,
    isMinor: !!u.is_minor,
  };
}
