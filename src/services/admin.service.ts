import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import { generateUrlSafeToken } from '../lib/crypto';
import { normalizePhone } from '../lib/phone';
import { logger } from '../lib/logger';

// ─── Authorization helpers ────────────────────────────────────────────────

export async function getCoordinatorChapterId(userId: string): Promise<string> {
  // Primary coordinator
  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('id')
    .eq('primary_coordinator_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (chapter) return (chapter as any).id;

  // Additional coordinator
  const { data: coord } = await supabaseAdmin
    .from('chapter_coordinators')
    .select('chapter_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (coord) return (coord as any).chapter_id;

  throw new ForbiddenError('You are not a chapter coordinator.');
}

async function assertCoordinator(userId: string, chapterId: string): Promise<void> {
  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('id, primary_coordinator_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (!chapter) throw new NotFoundError('Chapter');
  const c = chapter as any;
  if (c.primary_coordinator_id === userId) return;

  const { data: coord } = await supabaseAdmin
    .from('chapter_coordinators')
    .select('role')
    .eq('chapter_id', chapterId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!coord) throw new ForbiddenError('You are not a coordinator of this chapter.');
}

// ─── Chapter ──────────────────────────────────────────────────────────────

export async function getChapter(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data } = await supabaseAdmin
    .from('chapters')
    .select('*, primary_coordinator:users!primary_coordinator_id(id, name, email)')
    .eq('id', chapterId)
    .single();

  if (!data) throw new NotFoundError('Chapter');
  return data;
}

export async function updateChapter(
  userId: string,
  updates: {
    name?: string;
    contactEmail?: string;
    contactPhone?: string;
    addressLine?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    logoUrl?: string;
    primaryColor?: string;
    verifiedEmailDomain?: string;
    requiredHours?: number;
  },
) {
  const chapterId = await getCoordinatorChapterId(userId);

  const patch: Record<string, any> = {};
  if (updates.requiredHours !== undefined) patch.required_hours = Math.max(0, Math.trunc(updates.requiredHours));
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.contactEmail !== undefined) patch.contact_email = updates.contactEmail;
  if (updates.contactPhone !== undefined) patch.contact_phone = updates.contactPhone;
  if (updates.addressLine !== undefined) patch.address_line = updates.addressLine;
  if (updates.city !== undefined) patch.city = updates.city;
  if (updates.state !== undefined) patch.state = updates.state;
  if (updates.postalCode !== undefined) patch.postal_code = updates.postalCode;
  if (updates.logoUrl !== undefined) patch.logo_url = updates.logoUrl;
  if (updates.primaryColor !== undefined) patch.primary_color = updates.primaryColor;
  if (updates.verifiedEmailDomain !== undefined) patch.verified_email_domain = updates.verifiedEmailDomain;

  const { data, error } = await supabaseAdmin
    .from('chapters')
    .update(patch)
    .eq('id', chapterId)
    .select()
    .single();

  if (error || !data) throw new AppError('update_failed', 'Failed to update chapter.', 500);
  return data;
}

// ─── Members ──────────────────────────────────────────────────────────────

export async function getMembers(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, name, email, plan, created_at, goal_hours, goal_program')
    .eq('chapter_id', chapterId)
    .is('deleted_at', null)
    .order('name');

  const memberList = (members as any[] | null) ?? [];

  // Fetch aggregate session stats for all members in one query
  const { data: sessionStats } = await supabaseAdmin
    .from('sessions')
    .select('user_id, hours, status')
    .in('user_id', memberList.map((m: any) => m.id))
    .is('deleted_at', null);

  const statsMap: Record<string, { totalHours: number; verifiedHours: number; sessionCount: number }> = {};
  for (const s of (sessionStats as any[] | null) ?? []) {
    if (!statsMap[s.user_id]) statsMap[s.user_id] = { totalHours: 0, verifiedHours: 0, sessionCount: 0 };
    statsMap[s.user_id].totalHours += Number(s.hours);
    statsMap[s.user_id].sessionCount += 1;
    if (s.status === 'verified') statsMap[s.user_id].verifiedHours += Number(s.hours);
  }

  return memberList.map((m: any) => ({
    ...m,
    ...(statsMap[m.id] ?? { totalHours: 0, verifiedHours: 0, sessionCount: 0 }),
  }));
}

export async function removeMember(userId: string, memberId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  // Verify target member belongs to this chapter
  const { data: member } = await supabaseAdmin
    .from('users')
    .select('id, chapter_id')
    .eq('id', memberId)
    .maybeSingle();

  const m = member as any;
  if (!m || m.chapter_id !== chapterId) throw new NotFoundError('Member');

  await supabaseAdmin.from('users').update({ chapter_id: null }).eq('id', memberId);
  logger.info({ userId, memberId, chapterId }, 'member_removed');
  return { removed: true };
}

// ─── Coordinators ─────────────────────────────────────────────────────────

export async function getCoordinators(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data } = await supabaseAdmin
    .from('chapter_coordinators')
    .select('*, user:users(id, name, email)')
    .eq('chapter_id', chapterId)
    .order('added_at');

  return (data as any[] | null) ?? [];
}

export async function removeCoordinator(userId: string, targetUserId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  // Only primary coordinator can remove others
  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('primary_coordinator_id')
    .eq('id', chapterId)
    .maybeSingle();

  if ((chapter as any)?.primary_coordinator_id !== userId) {
    throw new ForbiddenError('Only the primary coordinator can remove coordinators.');
  }

  await supabaseAdmin
    .from('chapter_coordinators')
    .delete()
    .eq('chapter_id', chapterId)
    .eq('user_id', targetUserId);

  return { removed: true };
}

// ─── Supervisor whitelist ─────────────────────────────────────────────────

export async function getWhitelist(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data } = await supabaseAdmin
    .from('supervisor_whitelist')
    .select('*, org:organizations(id, name)')
    .eq('chapter_id', chapterId)
    .order('name');

  return (data as any[] | null) ?? [];
}

export async function addToWhitelist(
  userId: string,
  entry: { name: string; email?: string; phone?: string; orgId?: string },
) {
  const chapterId = await getCoordinatorChapterId(userId);

  if (!entry.email && !entry.phone) {
    throw new AppError('contact_required', 'Email or phone is required.', 400);
  }

  let phone = entry.phone;
  if (phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new AppError('invalid_phone', 'Phone number is not valid.', 400);
    phone = normalized;
  }

  const { data, error } = await supabaseAdmin
    .from('supervisor_whitelist')
    .insert({
      chapter_id: chapterId,
      name: entry.name,
      email: entry.email ?? null,
      phone: phone ?? null,
      org_id: entry.orgId ?? null,
      added_by: userId,
    })
    .select()
    .single();

  if (error || !data) throw new AppError('insert_failed', 'Failed to add to whitelist.', 500);
  return data;
}

export async function removeFromWhitelist(userId: string, entryId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data: entry } = await supabaseAdmin
    .from('supervisor_whitelist')
    .select('id, chapter_id')
    .eq('id', entryId)
    .maybeSingle();

  const e = entry as any;
  if (!e || e.chapter_id !== chapterId) throw new NotFoundError('Whitelist entry');

  await supabaseAdmin.from('supervisor_whitelist').delete().eq('id', entryId);
  return { removed: true };
}

// ─── Invites ──────────────────────────────────────────────────────────────

export async function getInvites(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data } = await supabaseAdmin
    .from('chapter_invites')
    .select('id, email, expires_at, accepted_at, created_at, invited_by_user:users!invited_by(name)')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });

  return (data as any[] | null) ?? [];
}

export async function createInvite(userId: string, email: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  // Check chapter member limit
  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('max_members')
    .eq('id', chapterId)
    .maybeSingle();

  const { count: memberCount } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('chapter_id', chapterId);

  const maxMembers = (chapter as any)?.max_members ?? 100;
  if ((memberCount ?? 0) >= maxMembers) {
    throw new AppError('member_limit', `Chapter has reached its member limit (${maxMembers}).`, 409);
  }

  // Check no pending invite exists for this email
  const { data: existing } = await supabaseAdmin
    .from('chapter_invites')
    .select('id')
    .eq('chapter_id', chapterId)
    .eq('email_lower', email.toLowerCase())
    .is('accepted_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing) throw new AppError('invite_pending', 'A pending invite already exists for this email.', 409);

  const token = generateUrlSafeToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('chapter_invites')
    .insert({
      chapter_id: chapterId,
      email,
      invited_by: userId,
      invite_token: token,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error || !data) throw new AppError('invite_failed', 'Failed to create invite.', 500);
  logger.info({ userId, chapterId, email }, 'chapter_invite_created');
  return data;
}

// ─── Roster bulk import ─────────────────────────────────────────────────────

export interface RosterRow {
  name: string;
  email: string;
  graduationYear?: number | null;
}

export interface RosterImportResult {
  created: number;
  skippedExisting: number;
  errors: { email: string; reason: string }[];
  invites: { email: string; name: string; inviteToken: string }[];
}

/**
 * Bulk-provision a chapter roster from parsed CSV rows. For each row we create a
 * chapter_invite (pre-filled with name + grad year) unless the email is already a
 * chapter member or already has a pending invite. Enforces the chapter member
 * limit across the whole batch. Returns a per-row summary so the coordinator can
 * see exactly what happened.
 */
export async function importRoster(userId: string, rows: RosterRow[]): Promise<RosterImportResult> {
  const chapterId = await getCoordinatorChapterId(userId);

  const result: RosterImportResult = { created: 0, skippedExisting: 0, errors: [], invites: [] };

  // Normalise + de-dupe within the uploaded file itself (last one wins on name).
  const byEmail = new Map<string, RosterRow>();
  for (const r of rows) {
    const email = (r.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      result.errors.push({ email: r.email ?? '(blank)', reason: 'Invalid email address' });
      continue;
    }
    byEmail.set(email, { ...r, email });
  }

  const emails = Array.from(byEmail.keys());
  if (emails.length === 0) return result;

  // Capacity check: current members + this batch must fit under max_members.
  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('max_members')
    .eq('id', chapterId)
    .maybeSingle();
  const maxMembers = (chapter as any)?.max_members ?? 100;

  const { count: memberCount } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('chapter_id', chapterId);

  // Existing members (already joined) — skip these.
  const { data: existingUsers } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('chapter_id', chapterId)
    .in('email', emails);
  const existingMemberEmails = new Set(
    ((existingUsers as any[] | null) ?? []).map((u) => (u.email as string).toLowerCase()),
  );

  // Existing pending invites — skip these too.
  const { data: pendingInvites } = await supabaseAdmin
    .from('chapter_invites')
    .select('email_lower')
    .eq('chapter_id', chapterId)
    .is('accepted_at', null)
    .gte('expires_at', new Date().toISOString());
  const pendingInviteEmails = new Set(
    ((pendingInvites as any[] | null) ?? []).map((i) => (i.email_lower as string)),
  );

  let remainingCapacity = Math.max(0, maxMembers - (memberCount ?? 0));
  const toInsert: any[] = [];
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30-day roster invites

  for (const [email, row] of byEmail.entries()) {
    if (existingMemberEmails.has(email) || pendingInviteEmails.has(email)) {
      result.skippedExisting++;
      continue;
    }
    if (remainingCapacity <= 0) {
      result.errors.push({ email, reason: `Chapter member limit (${maxMembers}) reached` });
      continue;
    }
    const token = generateUrlSafeToken(32);
    const name = (row.name ?? '').trim().slice(0, 120) || email.split('@')[0];
    const gradYear =
      row.graduationYear != null && Number.isFinite(Number(row.graduationYear))
        ? Math.trunc(Number(row.graduationYear))
        : null;

    toInsert.push({
      chapter_id: chapterId,
      email,
      name,
      graduation_year: gradYear,
      invited_by: userId,
      invite_token: token,
      expires_at: expiresAt,
    });
    result.invites.push({ email, name, inviteToken: token });
    remainingCapacity--;
  }

  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from('chapter_invites').insert(toInsert);
    if (error) {
      logger.error({ error, chapterId, count: toInsert.length }, 'roster_import_insert_failed');
      throw new AppError('roster_import_failed', 'Failed to save roster invites.', 500);
    }
    result.created = toInsert.length;
  }

  logger.info(
    { userId, chapterId, created: result.created, skipped: result.skippedExisting, errors: result.errors.length },
    'roster_imported',
  );
  return result;
}

export async function revokeInvite(userId: string, inviteId: string) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data: invite } = await supabaseAdmin
    .from('chapter_invites')
    .select('id, chapter_id')
    .eq('id', inviteId)
    .maybeSingle();

  const i = invite as any;
  if (!i || i.chapter_id !== chapterId) throw new NotFoundError('Invite');

  await supabaseAdmin.from('chapter_invites').delete().eq('id', inviteId);
  return { revoked: true };
}

export async function acceptInvite(token: string, userId: string) {
  const { data: invite } = await supabaseAdmin
    .from('chapter_invites')
    .select('*')
    .eq('invite_token', token)
    .maybeSingle();

  const i = invite as any;
  if (!i) throw new AppError('invalid_token', 'Invite not found or already used.', 400);
  if (i.accepted_at) throw new AppError('already_accepted', 'This invite has already been used.', 409);
  if (new Date(i.expires_at) < new Date()) throw new AppError('expired', 'This invite has expired.', 400);

  // Join the chapter, carrying over any roster-provided details that the
  // student hasn't already set on their own profile.
  const joinPatch: Record<string, any> = { chapter_id: i.chapter_id };
  if (i.graduation_year != null) {
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('graduation_year')
      .eq('id', userId)
      .maybeSingle();
    if (existingUser && (existingUser as any).graduation_year == null) {
      joinPatch.graduation_year = i.graduation_year;
    }
  }
  await supabaseAdmin.from('users').update(joinPatch).eq('id', userId);

  await supabaseAdmin
    .from('chapter_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq('id', i.id);

  return { joined: true, chapterId: i.chapter_id };
}

// ─── Grant report ─────────────────────────────────────────────────────────

export async function getGrantReport(
  userId: string,
  opts: { from?: string; to?: string } = {},
) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('name')
    .eq('id', chapterId)
    .maybeSingle();

  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, name')
    .eq('chapter_id', chapterId)
    .is('deleted_at', null);

  const memberIds = ((members as any[] | null) ?? []).map((m: any) => m.id);
  const memberNameMap: Record<string, string> = {};
  for (const m of (members as any[] | null) ?? []) {
    memberNameMap[(m as any).id] = (m as any).name;
  }

  if (!memberIds.length) {
    return {
      chapterName: (chapter as any)?.name ?? '',
      period: buildPeriod(opts),
      totalHours: 0,
      verifiedHours: 0,
      memberCount: 0,
      sessions: [],
    };
  }

  let query = supabaseAdmin
    .from('sessions')
    .select('user_id, hours, status, verification_tier, date, org:organizations(name)')
    .in('user_id', memberIds)
    .is('deleted_at', null)
    .order('date', { ascending: false });

  if (opts.from) query = query.gte('date', opts.from);
  if (opts.to) query = query.lte('date', opts.to);

  const { data: sessions } = await query;
  const rows = (sessions as any[] | null) ?? [];

  const totalHours = rows.reduce((s: number, r: any) => s + Number(r.hours), 0);
  const verifiedHours = rows
    .filter((r: any) => r.status === 'verified')
    .reduce((s: number, r: any) => s + Number(r.hours), 0);

  return {
    chapterName: (chapter as any)?.name ?? '',
    period: buildPeriod(opts),
    totalHours,
    verifiedHours,
    memberCount: memberIds.length,
    sessions: rows.map((r: any) => ({
      studentName: memberNameMap[r.user_id] ?? 'Unknown',
      hours: Number(r.hours),
      orgName: r.org?.name ?? '',
      date: r.date,
      status: r.status,
      tier: r.verification_tier ?? null,
    })),
  };
}

function buildPeriod(opts: { from?: string; to?: string }): string {
  if (opts.from && opts.to) return `${opts.from} – ${opts.to}`;
  if (opts.from) return `From ${opts.from}`;
  if (opts.to) return `Through ${opts.to}`;
  return 'All time';
}

// ─── Cohort compliance ──────────────────────────────────────────────────────

export interface ComplianceStudent {
  id: string;
  name: string;
  email: string;
  graduationYear: number | null;
  verifiedHours: number;
  requiredHours: number;
  met: boolean;
  remaining: number;
}

export interface ComplianceReport {
  chapterName: string;
  requiredHours: number;
  totalStudents: number;
  metCount: number;
  notMetCount: number;
  byGradYear: { graduationYear: number | null; total: number; met: number }[];
  students: ComplianceStudent[];
}

/**
 * Compliance view for a coordinator: for every chapter member, how many VERIFIED
 * hours they have vs the chapter's required_hours, who has met the requirement,
 * and a breakdown by graduation year. Only org-verified hours count toward the
 * requirement (self-reported hours are excluded).
 */
export async function getCompliance(userId: string): Promise<ComplianceReport> {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('name, required_hours')
    .eq('id', chapterId)
    .maybeSingle();

  const requiredHours = Number((chapter as any)?.required_hours ?? 0);

  const { data: members } = await supabaseAdmin
    .from('users')
    .select('id, name, email, graduation_year')
    .eq('chapter_id', chapterId)
    .is('deleted_at', null)
    .order('name');

  const memberList = (members as any[] | null) ?? [];
  const memberIds = memberList.map((m) => m.id as string);

  // Sum verified, non-self-reported hours per student.
  const hoursByUser = new Map<string, number>();
  if (memberIds.length > 0) {
    const { data: sessions } = await supabaseAdmin
      .from('sessions')
      .select('user_id, hours')
      .in('user_id', memberIds)
      .eq('status', 'verified')
      .eq('self_reported', false)
      .is('deleted_at', null);

    for (const s of (sessions as any[] | null) ?? []) {
      hoursByUser.set(s.user_id, (hoursByUser.get(s.user_id) ?? 0) + Number(s.hours ?? 0));
    }
  }

  const students: ComplianceStudent[] = memberList.map((m) => {
    const verifiedHours = hoursByUser.get(m.id) ?? 0;
    const met = requiredHours > 0 ? verifiedHours >= requiredHours : false;
    return {
      id: m.id,
      name: m.name ?? 'Student',
      email: m.email ?? '',
      graduationYear: m.graduation_year ?? null,
      verifiedHours,
      requiredHours,
      met,
      remaining: Math.max(0, requiredHours - verifiedHours),
    };
  });

  // Sort: not-met first (most behind first), then met.
  students.sort((a, b) => {
    if (a.met !== b.met) return a.met ? 1 : -1;
    return b.remaining - a.remaining;
  });

  const gradMap = new Map<number | null, { total: number; met: number }>();
  for (const s of students) {
    const key = s.graduationYear;
    const g = gradMap.get(key) ?? { total: 0, met: 0 };
    g.total++;
    if (s.met) g.met++;
    gradMap.set(key, g);
  }
  const byGradYear = Array.from(gradMap.entries())
    .map(([graduationYear, v]) => ({ graduationYear, total: v.total, met: v.met }))
    .sort((a, b) => (a.graduationYear ?? 9999) - (b.graduationYear ?? 9999));

  const metCount = students.filter((s) => s.met).length;

  return {
    chapterName: (chapter as any)?.name ?? '',
    requiredHours,
    totalStudents: students.length,
    metCount,
    notMetCount: students.length - metCount,
    byGradYear,
    students,
  };
}

// ─── CSV helpers ────────────────────────────────────────────────────────────

/** Escape a single CSV field per RFC 4180 (quote if it contains comma/quote/newline). */
function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: (unknown[])[]): string {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return lines.join('\r\n');
}

/** Cohort compliance as CSV — one row per student, for transcripts/scholarships. */
export async function getComplianceCsv(userId: string): Promise<string> {
  const report = await getCompliance(userId);
  return toCsv(
    ['Name', 'Email', 'Graduation Year', 'Verified Hours', 'Required Hours', 'Met Requirement', 'Hours Remaining'],
    report.students.map((s) => [
      s.name,
      s.email,
      s.graduationYear ?? '',
      s.verifiedHours,
      s.requiredHours,
      s.met ? 'Yes' : 'No',
      s.remaining,
    ]),
  );
}

/** Detailed session-level grant report as CSV. */
export async function getGrantReportCsv(
  userId: string,
  opts: { from?: string; to?: string } = {},
): Promise<string> {
  const report = await getGrantReport(userId, opts);
  return toCsv(
    ['Student', 'Organization', 'Date', 'Hours', 'Status', 'Verification Tier'],
    report.sessions.map((s: any) => [s.studentName, s.orgName, s.date, s.hours, s.status, s.tier ?? '']),
  );
}
