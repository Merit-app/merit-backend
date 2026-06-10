import { supabaseAdmin } from '../config/supabase';
import { getCoordinatorChapterId } from './admin.service';
import { assertPermission } from './chapter-team.service';

/**
 * Record a coordinator action on a chapter for accountability. Best-effort —
 * never throws, never blocks the action it's logging.
 */
export async function logChapterAction(
  chapterId: string,
  actorId: string,
  action: string,
  opts: { targetUserId?: string | null; detail?: string } = {},
): Promise<void> {
  try {
    // Resolve actor + target display names (best-effort).
    const ids = [actorId, opts.targetUserId].filter(Boolean) as string[];
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data } = await supabaseAdmin.from('users').select('id, name').in('id', ids);
      for (const u of (data as any[] | null) ?? []) nameMap.set(u.id, u.name ?? '');
    }
    await supabaseAdmin.from('chapter_audit_log').insert({
      chapter_id: chapterId,
      actor_user_id: actorId,
      actor_name: nameMap.get(actorId) ?? null,
      action,
      target_user_id: opts.targetUserId ?? null,
      target_name: opts.targetUserId ? (nameMap.get(opts.targetUserId) ?? null) : null,
      detail: opts.detail ?? null,
    });
  } catch {
    /* non-fatal */
  }
}

export async function getAuditLog(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_team');

  const { data } = await supabaseAdmin
    .from('chapter_audit_log')
    .select('id, actor_name, action, target_name, detail, created_at')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false })
    .limit(100);
  return (data as any[] | null) ?? [];
}
