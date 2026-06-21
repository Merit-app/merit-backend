import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import { logger } from '../lib/logger';
import { getCoordinatorChapterId } from './admin.service';
import { assertPermission } from './chapter-team.service';
import { logChapterAction } from './chapter-audit.service';
import { createManyNotifications, createNotification } from './notifications.service';

const BUCKET = 'assignment-files';
const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB per submission (stays under the route's 50 MB body cap)

// Permissive but safe: docs, PDFs, images, archives, plain text.
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/rtf',
  'application/zip', 'application/x-zip-compressed',
]);

export interface IncomingFile {
  name: string;
  contentType: string;
  /** base64 (optionally a data-URL); decoded server-side. */
  dataBase64: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getStudentChapterId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('chapter_id')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.chapter_id ?? null;
}

function sanitizeFileName(name: string): string {
  const base = (name || 'file').split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}

/** Sign a set of file rows for download. Best-effort — a failed sign yields null. */
async function signFiles(files: any[]): Promise<any[]> {
  return Promise.all(
    (files ?? []).map(async (f) => {
      const { data } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(f.storage_path, 3600)
        .catch(() => ({ data: null }) as any);
      return {
        id: f.id,
        name: f.file_name,
        contentType: f.content_type ?? null,
        sizeBytes: f.size_bytes ?? null,
        url: (data as any)?.signedUrl ?? null,
      };
    }),
  );
}

// ─── Coordinator ───────────────────────────────────────────────────────────────

export async function createAssignment(
  userId: string,
  input: { title: string; instructions?: string; dueDate?: string | null },
) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_assignments');

  const title = input.title?.trim();
  if (!title || title.length < 2) throw new AppError('invalid_title', 'Give the assignment a title.', 400);

  const { data: assignment, error } = await supabaseAdmin
    .from('chapter_assignments')
    .insert({
      chapter_id: chapterId,
      title: title.slice(0, 200),
      instructions: input.instructions?.trim()?.slice(0, 5000) || null,
      due_date: input.dueDate || null,
      created_by: userId,
    })
    .select('id, title, instructions, due_date, created_at')
    .single();

  if (error || !assignment) {
    logger.error({ error, chapterId }, 'create_assignment_failed');
    throw new AppError('create_failed', 'Could not create the assignment.', 500);
  }

  // Notify every student in the chapter.
  const { data: students } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('chapter_id', chapterId);
  const ids = (students as any[] | null)?.map((s) => s.id) ?? [];
  await createManyNotifications(ids, {
    type: 'assignment',
    title: `New assignment: ${title}`,
    body: input.dueDate ? `Due ${new Date(input.dueDate).toLocaleDateString()}.` : 'Open it to submit your work.',
    actionUrl: '/my-chapter/assignments',
  });

  void logChapterAction(chapterId, userId, 'create_assignment', { assignmentId: (assignment as any).id, title });
  return assignment;
}

export async function listAssignments(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'view_roster');

  const { data: assignments } = await supabaseAdmin
    .from('chapter_assignments')
    .select('id, title, instructions, due_date, created_at')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });

  const list = (assignments as any[] | null) ?? [];
  const ids = list.map((a) => a.id);

  // Submission tallies in one query.
  const counts = new Map<string, { submitted: number; reviewed: number }>();
  if (ids.length) {
    const { data: subs } = await supabaseAdmin
      .from('assignment_submissions')
      .select('assignment_id, status')
      .in('assignment_id', ids);
    for (const s of (subs as any[] | null) ?? []) {
      const c = counts.get(s.assignment_id) ?? { submitted: 0, reviewed: 0 };
      c.submitted += 1;
      if (s.status === 'reviewed' || s.status === 'approved') c.reviewed += 1;
      counts.set(s.assignment_id, c);
    }
  }

  const { count: studentCount } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('chapter_id', chapterId);

  return list.map((a) => ({
    id: a.id,
    title: a.title,
    instructions: a.instructions,
    dueDate: a.due_date,
    createdAt: a.created_at,
    submissionCount: counts.get(a.id)?.submitted ?? 0,
    reviewedCount: counts.get(a.id)?.reviewed ?? 0,
    studentCount: studentCount ?? 0,
  }));
}

export async function getAssignmentDetail(userId: string, assignmentId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'view_roster');

  const { data: assignment } = await supabaseAdmin
    .from('chapter_assignments')
    .select('id, chapter_id, title, instructions, due_date, created_at')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!assignment || (assignment as any).chapter_id !== chapterId) throw new NotFoundError('Assignment');

  // Submissions (two plain queries — assignment_submissions has two FKs to users).
  const { data: subs } = await supabaseAdmin
    .from('assignment_submissions')
    .select('id, user_id, note, status, submitted_at, reviewed_at')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: false });
  const subRows = (subs as any[] | null) ?? [];

  const submitterIds = [...new Set(subRows.map((s) => s.user_id))];
  const userById = new Map<string, any>();
  if (submitterIds.length) {
    const { data: us } = await supabaseAdmin
      .from('users')
      .select('id, name, email, graduation_year, avatar_url')
      .in('id', submitterIds);
    for (const u of (us as any[] | null) ?? []) userById.set(u.id, u);
  }

  // Files for all submissions, grouped + signed.
  const filesBySub = new Map<string, any[]>();
  if (subRows.length) {
    const { data: files } = await supabaseAdmin
      .from('assignment_submission_files')
      .select('id, submission_id, storage_path, file_name, content_type, size_bytes')
      .in('submission_id', subRows.map((s) => s.id));
    for (const f of (files as any[] | null) ?? []) {
      const arr = filesBySub.get(f.submission_id) ?? [];
      arr.push(f);
      filesBySub.set(f.submission_id, arr);
    }
  }

  const submissions = await Promise.all(
    subRows.map(async (s) => {
      const u = userById.get(s.user_id);
      return {
        id: s.id,
        student: {
          id: s.user_id,
          name: u?.name ?? 'Student',
          email: u?.email ?? null,
          graduationYear: u?.graduation_year ?? null,
          avatarUrl: u?.avatar_url ?? null,
        },
        note: s.note,
        status: s.status,
        submittedAt: s.submitted_at,
        reviewedAt: s.reviewed_at,
        files: await signFiles(filesBySub.get(s.id) ?? []),
      };
    }),
  );

  // Who hasn't submitted yet.
  const submittedIds = new Set(subRows.map((s) => s.user_id));
  const { data: roster } = await supabaseAdmin
    .from('users')
    .select('id, name, email')
    .eq('chapter_id', chapterId);
  const notSubmitted = ((roster as any[] | null) ?? [])
    .filter((u) => !submittedIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));

  return {
    assignment: {
      id: (assignment as any).id,
      title: (assignment as any).title,
      instructions: (assignment as any).instructions,
      dueDate: (assignment as any).due_date,
      createdAt: (assignment as any).created_at,
    },
    submissions,
    notSubmitted,
  };
}

export async function reviewSubmission(
  userId: string,
  submissionId: string,
  status: 'submitted' | 'reviewed' | 'approved' | 'returned',
) {
  const chapterId = await getCoordinatorChapterId(userId);

  const { data: sub } = await supabaseAdmin
    .from('assignment_submissions')
    .select('id, assignment_id, user_id')
    .eq('id', submissionId)
    .maybeSingle();
  if (!sub) throw new NotFoundError('Submission');

  const { data: assignment } = await supabaseAdmin
    .from('chapter_assignments')
    .select('id, chapter_id, title')
    .eq('id', (sub as any).assignment_id)
    .maybeSingle();
  if (!assignment || (assignment as any).chapter_id !== chapterId) throw new NotFoundError('Submission');

  await assertPermission(userId, chapterId, 'manage_assignments');

  const { error } = await supabaseAdmin
    .from('assignment_submissions')
    .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: userId })
    .eq('id', submissionId);
  if (error) throw error;

  if (status === 'approved' || status === 'returned') {
    await createNotification({
      userId: (sub as any).user_id,
      type: 'assignment',
      title: status === 'approved'
        ? `Submission approved: ${(assignment as any).title}`
        : `Submission returned: ${(assignment as any).title}`,
      body: status === 'approved'
        ? 'Your coordinator approved your submission.'
        : 'Your coordinator asked you to take another look and resubmit.',
      actionUrl: '/my-chapter/assignments',
    });
  }

  void logChapterAction(chapterId, userId, 'review_submission', { submissionId, status });
  return { reviewed: true, status };
}

export async function deleteAssignment(userId: string, assignmentId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_assignments');

  const { data: assignment } = await supabaseAdmin
    .from('chapter_assignments')
    .select('id, chapter_id')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!assignment || (assignment as any).chapter_id !== chapterId) throw new NotFoundError('Assignment');

  // Best-effort: remove stored files first (DB cascade only drops rows).
  const { data: subs } = await supabaseAdmin
    .from('assignment_submissions')
    .select('id')
    .eq('assignment_id', assignmentId);
  const subIds = (subs as any[] | null)?.map((s) => s.id) ?? [];
  if (subIds.length) {
    const { data: files } = await supabaseAdmin
      .from('assignment_submission_files')
      .select('storage_path')
      .in('submission_id', subIds);
    const paths = (files as any[] | null)?.map((f) => f.storage_path) ?? [];
    if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths).catch(() => {});
  }

  await supabaseAdmin.from('chapter_assignments').delete().eq('id', assignmentId);
  void logChapterAction(chapterId, userId, 'delete_assignment', { assignmentId });
  return { deleted: true };
}

// ─── Student ─────────────────────────────────────────────────────────────────

export async function listMyAssignments(userId: string) {
  const chapterId = await getStudentChapterId(userId);
  if (!chapterId) return [];

  const { data: assignments } = await supabaseAdmin
    .from('chapter_assignments')
    .select('id, title, instructions, due_date, created_at')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });
  const list = (assignments as any[] | null) ?? [];
  if (!list.length) return [];

  const { data: mySubs } = await supabaseAdmin
    .from('assignment_submissions')
    .select('id, assignment_id, status, submitted_at')
    .eq('user_id', userId)
    .in('assignment_id', list.map((a) => a.id));
  const subByAssignment = new Map<string, any>();
  for (const s of (mySubs as any[] | null) ?? []) subByAssignment.set(s.assignment_id, s);

  // File counts per submission for the list view.
  const subIds = ((mySubs as any[] | null) ?? []).map((s) => s.id);
  const fileCount = new Map<string, number>();
  if (subIds.length) {
    const { data: files } = await supabaseAdmin
      .from('assignment_submission_files')
      .select('submission_id')
      .in('submission_id', subIds);
    for (const f of (files as any[] | null) ?? []) {
      fileCount.set(f.submission_id, (fileCount.get(f.submission_id) ?? 0) + 1);
    }
  }

  return list.map((a) => {
    const sub = subByAssignment.get(a.id);
    return {
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      dueDate: a.due_date,
      createdAt: a.created_at,
      submission: sub
        ? { id: sub.id, status: sub.status, submittedAt: sub.submitted_at, fileCount: fileCount.get(sub.id) ?? 0 }
        : null,
    };
  });
}

export async function getMyAssignment(userId: string, assignmentId: string) {
  const chapterId = await getStudentChapterId(userId);
  if (!chapterId) throw new NotFoundError('Assignment');

  const { data: assignment } = await supabaseAdmin
    .from('chapter_assignments')
    .select('id, chapter_id, title, instructions, due_date, created_at')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!assignment || (assignment as any).chapter_id !== chapterId) throw new NotFoundError('Assignment');

  const { data: sub } = await supabaseAdmin
    .from('assignment_submissions')
    .select('id, note, status, submitted_at, reviewed_at')
    .eq('assignment_id', assignmentId)
    .eq('user_id', userId)
    .maybeSingle();

  let submission: any = null;
  if (sub) {
    const { data: files } = await supabaseAdmin
      .from('assignment_submission_files')
      .select('id, storage_path, file_name, content_type, size_bytes')
      .eq('submission_id', (sub as any).id);
    submission = {
      id: (sub as any).id,
      note: (sub as any).note,
      status: (sub as any).status,
      submittedAt: (sub as any).submitted_at,
      reviewedAt: (sub as any).reviewed_at,
      files: await signFiles((files as any[] | null) ?? []),
    };
  }

  return {
    assignment: {
      id: (assignment as any).id,
      title: (assignment as any).title,
      instructions: (assignment as any).instructions,
      dueDate: (assignment as any).due_date,
      createdAt: (assignment as any).created_at,
    },
    submission,
  };
}

export async function submitAssignment(
  userId: string,
  assignmentId: string,
  input: { note?: string; files: IncomingFile[] },
) {
  const chapterId = await getStudentChapterId(userId);
  if (!chapterId) throw new ForbiddenError('You are not in a chapter.');

  const { data: assignment } = await supabaseAdmin
    .from('chapter_assignments')
    .select('id, chapter_id, title, created_by')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!assignment || (assignment as any).chapter_id !== chapterId) throw new NotFoundError('Assignment');

  const files = input.files ?? [];
  if (files.length === 0) throw new AppError('no_files', 'Attach at least one file to submit.', 400);
  if (files.length > MAX_FILES) throw new AppError('too_many_files', `Attach at most ${MAX_FILES} files.`, 400);

  // Decode + validate everything up front so a bad file fails before we write.
  const decoded = files.map((f) => {
    const ct = (f.contentType || '').toLowerCase();
    if (!ALLOWED_TYPES.has(ct)) {
      throw new AppError('invalid_file_type', `"${f.name}" is not an accepted file type.`, 400);
    }
    const raw = f.dataBase64.includes(',') ? f.dataBase64.split(',')[1] : f.dataBase64;
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0) throw new AppError('empty_file', `"${f.name}" appears to be empty.`, 400);
    if (buffer.length > MAX_FILE_BYTES) {
      throw new AppError('file_too_large', `"${f.name}" is larger than 10 MB.`, 400);
    }
    return { name: sanitizeFileName(f.name), contentType: ct, buffer };
  });

  const totalBytes = decoded.reduce((sum, f) => sum + f.buffer.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new AppError('submission_too_large', 'Your files total more than 25 MB. Remove some and try again.', 400);
  }

  // Upsert the submission row (resubmitting reuses it, status back to 'submitted').
  const now = new Date().toISOString();
  const { data: sub, error: subErr } = await supabaseAdmin
    .from('assignment_submissions')
    .upsert(
      {
        assignment_id: assignmentId,
        user_id: userId,
        note: input.note?.trim()?.slice(0, 2000) || null,
        status: 'submitted',
        submitted_at: now,
        reviewed_at: null,
        reviewed_by: null,
      },
      { onConflict: 'assignment_id,user_id' },
    )
    .select('id')
    .single();
  if (subErr || !sub) {
    logger.error({ subErr, assignmentId, userId }, 'submit_assignment_upsert_failed');
    throw new AppError('submit_failed', 'Could not save your submission.', 500);
  }
  const submissionId = (sub as any).id;

  // Replace any previous files (resubmission): drop old storage objects + rows.
  const { data: oldFiles } = await supabaseAdmin
    .from('assignment_submission_files')
    .select('storage_path')
    .eq('submission_id', submissionId);
  const oldPaths = (oldFiles as any[] | null)?.map((f) => f.storage_path) ?? [];
  if (oldPaths.length) {
    await supabaseAdmin.storage.from(BUCKET).remove(oldPaths).catch(() => {});
    await supabaseAdmin.from('assignment_submission_files').delete().eq('submission_id', submissionId);
  }

  // Upload each file, then record it.
  for (const f of decoded) {
    const path = `${chapterId}/${assignmentId}/${userId}/${randomUUID()}__${f.name}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, f.buffer, { contentType: f.contentType, upsert: true });
    if (upErr) {
      logger.error({ upErr, assignmentId, userId, name: f.name }, 'assignment_file_upload_failed');
      throw new AppError('upload_failed', `Could not upload "${f.name}". Please try again.`, 500);
    }
    await supabaseAdmin.from('assignment_submission_files').insert({
      submission_id: submissionId,
      storage_path: path,
      file_name: f.name,
      content_type: f.contentType,
      size_bytes: f.buffer.length,
    });
  }

  // Let the coordinator who posted it know.
  if ((assignment as any).created_by) {
    await createNotification({
      userId: (assignment as any).created_by,
      type: 'assignment',
      title: `New submission: ${(assignment as any).title}`,
      body: 'A student submitted their work.',
      actionUrl: '/chapter/assignments',
    });
  }

  return { submitted: true, submissionId, fileCount: decoded.length };
}
