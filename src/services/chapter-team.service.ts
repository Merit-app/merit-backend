import { supabaseAdmin } from '../config/supabase';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors';
import { getCoordinatorChapterId } from './admin.service';

// ─── Permission catalogue ───────────────────────────────────────────────────

export const PERMISSIONS = [
  { key: 'view_roster', label: 'View students' },
  { key: 'edit_goals', label: 'Edit goals & requirements' },
  { key: 'approve_hours', label: 'Grant / waive hours' },
  { key: 'message_students', label: 'Send announcements & reminders' },
  { key: 'manage_settings', label: 'Manage chapter settings' },
  { key: 'manage_team', label: 'Manage team & roles' },
  { key: 'manage_partners', label: 'Manage partner organizations' },
  { key: 'post_opportunities', label: 'Post opportunities' },
  { key: 'manage_assignments', label: 'Post & review assignments' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
const ALL_PERMS = PERMISSIONS.map((p) => p.key);

const DEFAULT_ROLES: { name: string; permissions: string[] }[] = [
  { name: 'Coordinator', permissions: ALL_PERMS },
  { name: 'Assistant', permissions: ['view_roster', 'edit_goals', 'approve_hours', 'message_students'] },
  { name: 'Viewer', permissions: ['view_roster'] },
];

// ─── Default-role seeding ───────────────────────────────────────────────────

async function ensureDefaultRoles(chapterId: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('chapter_roles')
    .select('id')
    .eq('chapter_id', chapterId)
    .limit(1);
  if ((existing as any[] | null)?.length) return;

  await supabaseAdmin.from('chapter_roles').insert(
    DEFAULT_ROLES.map((r) => ({
      chapter_id: chapterId,
      name: r.name,
      permissions: r.permissions,
      is_default: true,
    })),
  );
}

// ─── Permission resolution ──────────────────────────────────────────────────

async function isOwner(userId: string, chapterId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('chapters')
    .select('primary_coordinator_id')
    .eq('id', chapterId)
    .maybeSingle();
  return (data as any)?.primary_coordinator_id === userId;
}

/** All permissions a user has on a chapter. Owner = everything. Coordinators
 *  with no assigned role default to full access (legacy-safe, never locks out). */
export async function getPermissions(userId: string, chapterId: string): Promise<Set<string>> {
  if (await isOwner(userId, chapterId)) return new Set(ALL_PERMS);

  const { data: coord } = await supabaseAdmin
    .from('chapter_coordinators')
    .select('role_id')
    .eq('chapter_id', chapterId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!coord) return new Set(); // not on the team
  const roleId = (coord as any).role_id as string | null;
  if (!roleId) return new Set(ALL_PERMS); // no role assigned → full access

  const { data: role } = await supabaseAdmin
    .from('chapter_roles')
    .select('permissions')
    .eq('id', roleId)
    .maybeSingle();
  return new Set(((role as any)?.permissions as string[] | null) ?? []);
}

/** Throw 403 unless the user holds the permission on their chapter. */
export async function assertPermission(userId: string, chapterId: string, perm: PermissionKey): Promise<void> {
  const perms = await getPermissions(userId, chapterId);
  if (!perms.has(perm)) {
    throw new ForbiddenError(`You don't have permission to do this (${perm}).`);
  }
}

export async function getMyPermissions(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  const owner = await isOwner(userId, chapterId);
  const perms = await getPermissions(userId, chapterId);
  return { isOwner: owner, permissions: Array.from(perms), catalogue: PERMISSIONS };
}

// ─── Team management ────────────────────────────────────────────────────────

export async function getTeam(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await ensureDefaultRoles(chapterId);

  const { data: chapter } = await supabaseAdmin
    .from('chapters')
    .select('primary_coordinator_id, primary:users!primary_coordinator_id(id, name, email)')
    .eq('id', chapterId)
    .maybeSingle();

  const { data: coords } = await supabaseAdmin
    .from('chapter_coordinators')
    .select('user_id, role_id, added_at, user:users(id, name, email), role:chapter_roles(id, name)')
    .eq('chapter_id', chapterId)
    .order('added_at');

  const owner = (chapter as any)?.primary
    ? {
        userId: (chapter as any).primary.id,
        name: (chapter as any).primary.name,
        email: (chapter as any).primary.email,
        roleName: 'Owner',
        roleId: null as string | null,
        isOwner: true,
      }
    : null;

  const members = ((coords as any[] | null) ?? []).map((c) => ({
    userId: c.user?.id ?? c.user_id,
    name: c.user?.name ?? 'Coordinator',
    email: c.user?.email ?? '',
    roleName: c.role?.name ?? 'Full access',
    roleId: c.role_id ?? null,
    isOwner: false,
  }));

  return { members: owner ? [owner, ...members] : members };
}

export async function addCoordinator(userId: string, email: string, roleId: string | null) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_team');

  const { data: target } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email_lower', email.toLowerCase())
    .is('deleted_at', null)
    .maybeSingle();

  if (!target) {
    throw new AppError('no_account', 'That email has no Merit account yet. Ask them to sign up first.', 404);
  }
  const targetId = (target as any).id as string;

  if (await isOwner(targetId, chapterId)) {
    throw new AppError('already_owner', 'That person is the chapter owner.', 409);
  }

  // Validate role belongs to this chapter
  if (roleId) {
    const { data: role } = await supabaseAdmin
      .from('chapter_roles').select('id').eq('id', roleId).eq('chapter_id', chapterId).maybeSingle();
    if (!role) throw new NotFoundError('Role');
  }

  const { error } = await supabaseAdmin
    .from('chapter_coordinators')
    .upsert({ chapter_id: chapterId, user_id: targetId, role_id: roleId }, { onConflict: 'chapter_id,user_id' });
  if (error) throw new AppError('add_failed', 'Failed to add coordinator.', 500);
  return { added: true };
}

export async function setCoordinatorRole(userId: string, targetUserId: string, roleId: string | null) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_team');

  if (roleId) {
    const { data: role } = await supabaseAdmin
      .from('chapter_roles').select('id').eq('id', roleId).eq('chapter_id', chapterId).maybeSingle();
    if (!role) throw new NotFoundError('Role');
  }

  const { error } = await supabaseAdmin
    .from('chapter_coordinators')
    .update({ role_id: roleId })
    .eq('chapter_id', chapterId)
    .eq('user_id', targetUserId);
  if (error) throw new AppError('update_failed', 'Failed to update role.', 500);
  return { updated: true };
}

export async function removeCoordinator(userId: string, targetUserId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_team');

  if (await isOwner(targetUserId, chapterId)) {
    throw new AppError('cannot_remove_owner', 'You can’t remove the chapter owner.', 409);
  }

  await supabaseAdmin
    .from('chapter_coordinators')
    .delete()
    .eq('chapter_id', chapterId)
    .eq('user_id', targetUserId);
  return { removed: true };
}

// ─── Role management ────────────────────────────────────────────────────────

export async function listRoles(userId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await ensureDefaultRoles(chapterId);
  const { data } = await supabaseAdmin
    .from('chapter_roles')
    .select('id, name, permissions, is_default')
    .eq('chapter_id', chapterId)
    .order('is_default', { ascending: false })
    .order('name');
  return (data as any[] | null) ?? [];
}

function sanitizePerms(perms: string[]): string[] {
  const valid = new Set(ALL_PERMS as string[]);
  return Array.from(new Set(perms.filter((p) => valid.has(p))));
}

export async function createRole(userId: string, name: string, permissions: string[]) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_team');
  const { data, error } = await supabaseAdmin
    .from('chapter_roles')
    .insert({ chapter_id: chapterId, name: name.trim().slice(0, 60), permissions: sanitizePerms(permissions), is_default: false })
    .select('id')
    .single();
  if (error) {
    if ((error as any).code === '23505') throw new AppError('duplicate', 'A role with that name already exists.', 409);
    throw new AppError('create_failed', 'Failed to create role.', 500);
  }
  return { id: (data as any).id };
}

export async function updateRole(userId: string, roleId: string, input: { name?: string; permissions?: string[] }) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_team');

  const { data: role } = await supabaseAdmin
    .from('chapter_roles').select('id, chapter_id').eq('id', roleId).maybeSingle();
  if (!role || (role as any).chapter_id !== chapterId) throw new NotFoundError('Role');

  const patch: Record<string, any> = {};
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 60);
  if (input.permissions !== undefined) patch.permissions = sanitizePerms(input.permissions);
  if (Object.keys(patch).length === 0) return { updated: false };

  const { error } = await supabaseAdmin.from('chapter_roles').update(patch).eq('id', roleId);
  if (error) throw new AppError('update_failed', 'Failed to update role.', 500);
  return { updated: true };
}

export async function deleteRole(userId: string, roleId: string) {
  const chapterId = await getCoordinatorChapterId(userId);
  await assertPermission(userId, chapterId, 'manage_team');

  const { data: role } = await supabaseAdmin
    .from('chapter_roles').select('id, chapter_id, is_default').eq('id', roleId).maybeSingle();
  if (!role || (role as any).chapter_id !== chapterId) throw new NotFoundError('Role');
  if ((role as any).is_default) throw new AppError('default_role', 'Default roles can’t be deleted.', 409);

  // Coordinators with this role fall back to full access (role_id set null by FK).
  await supabaseAdmin.from('chapter_roles').delete().eq('id', roleId);
  return { deleted: true };
}
