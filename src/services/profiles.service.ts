import DOMPurify from 'isomorphic-dompurify';
import { supabaseAdmin } from '../config/supabase';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { isValidUsername, checkUsernameExists } from './usernames.service';
import type { UpdateProfileInput } from '../schemas/profiles.schema';

// ─── Helpers ──────────────────────────────────────────────────────────────

function sanitizeText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

// ─── My profile ───────────────────────────────────────────────────────────

export async function getMyProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(
      'id, name, username, username_changed_at, profile_public, bio, top_badge_ids, onboarding_completed, school, grade, graduation_year, created_at',
    )
    .eq('id', userId)
    .is('deleted_at', null)
    .single();

  if (error || !data) throw new NotFoundError('Profile');
  return data;
}

export async function updateMyProfile(userId: string, input: UpdateProfileInput) {
  const updates: Record<string, unknown> = {};

  if (input.bio !== undefined) {
    updates['bio'] = sanitizeText(input.bio);
  }

  if (input.profilePublic !== undefined) {
    updates['profile_public'] = input.profilePublic;
  }

  if (input.topBadgeIds !== undefined) {
    updates['top_badge_ids'] = input.topBadgeIds;
  }

  if (input.username !== undefined) {
    // Username can only be changed once
    const { data: current } = await supabaseAdmin
      .from('users')
      .select('username, username_changed_at')
      .eq('id', userId)
      .single();

    if (current?.username_changed_at) {
      throw new AppError(
        'username_already_changed',
        'Username can only be changed once. Contact support to change again.',
        400,
      );
    }

    const validation = isValidUsername(input.username);
    if (!validation.valid) {
      throw new AppError('invalid_username', validation.reason ?? 'Invalid username.', 400);
    }

    // Allow keeping the same username (no-op), block taking someone else's
    if (input.username !== current?.username) {
      const taken = await checkUsernameExists(input.username);
      if (taken) {
        throw new AppError('username_taken', 'That username is already taken.', 409);
      }
    }

    updates['username'] = input.username;
    updates['username_changed_at'] = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return getMyProfile(userId);
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select(
      'id, name, username, username_changed_at, profile_public, bio, top_badge_ids, onboarding_completed, school, grade, graduation_year, created_at',
    )
    .single();

  if (error || !data) {
    logger.error({ userId, error }, 'profile_update_failed');
    throw new AppError('update_failed', 'Failed to update profile.', 500);
  }

  return data;
}

// ─── Public profile ───────────────────────────────────────────────────────

export async function getPublicProfile(username: string) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select(
      'id, name, username, profile_public, bio, top_badge_ids, school, grade, graduation_year, goal_program, goal_hours, created_at',
    )
    .eq('username', username)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !user) throw new NotFoundError('Profile');

  // Private profile — return minimal payload so URL still resolves (200, not 404)
  if (!user.profile_public) {
    return { isPrivate: true as const, username };
  }

  // Stats
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('hours, status, org_id, date')
    .eq('user_id', user.id)
    .is('deleted_at', null);

  const allSessions = sessions ?? [];
  const verifiedSessions = allSessions.filter((s: any) => s.status === 'verified');
  const verifiedHours = verifiedSessions.reduce(
    (sum: number, s: any) => sum + ((s.hours as number) ?? 0),
    0,
  );
  const uniqueOrgIds = new Set(
    allSessions.map((s: any) => s.org_id).filter(Boolean),
  );
  const lastActive =
    allSessions.length > 0
      ? allSessions
          .slice()
          .sort(
            (a: any, b: any) =>
              new Date(b.date as string).getTime() -
              new Date(a.date as string).getTime(),
          )[0]?.date ?? null
      : null;

  return {
    isPrivate: false as const,
    id: user.id as string,
    name: user.name as string,
    username: user.username as string,
    bio: user.bio as string | null,
    topBadgeIds: (user.top_badge_ids as string[]) ?? [],
    school: user.school as string | null,
    grade: user.grade as number | null,
    graduationYear: user.graduation_year as number | null,
    memberSince: user.created_at as string,
    goalProgram: user.goal_program as string | null,
    goalHours: user.goal_hours as number | null,
    stats: {
      verifiedHours,
      orgCount: uniqueOrgIds.size,
      lastActive,
    },
  };
}

// ─── Profile orgs ─────────────────────────────────────────────────────────

export async function getProfileOrgs(username: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, profile_public')
    .eq('username', username)
    .is('deleted_at', null)
    .maybeSingle();

  if (!user) throw new NotFoundError('Profile');
  if (!user.profile_public) throw new NotFoundError('Profile');

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('org_id, hours, date')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .not('org_id', 'is', null);

  if (!sessions || sessions.length === 0) return [];

  // Aggregate per org
  const orgMap = new Map<
    string,
    { totalHours: number; sessionCount: number; firstDate: string; lastDate: string }
  >();

  for (const s of sessions) {
    const orgId = s.org_id as string;
    const date = s.date as string;
    const hours = (s.hours as number) ?? 0;
    const existing = orgMap.get(orgId);
    if (!existing) {
      orgMap.set(orgId, { totalHours: hours, sessionCount: 1, firstDate: date, lastDate: date });
    } else {
      existing.totalHours += hours;
      existing.sessionCount += 1;
      if (date < existing.firstDate) existing.firstDate = date;
      if (date > existing.lastDate) existing.lastDate = date;
    }
  }

  const orgIds = [...orgMap.keys()];
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, name, city, state, slug, logo_url, category')
    .in('id', orgIds);

  return (orgs ?? [])
    .map((org: any) => ({ ...org, ...(orgMap.get(org.id as string) ?? {}) }))
    .sort((a: any, b: any) => ((b as any).totalHours ?? 0) - ((a as any).totalHours ?? 0))
    .slice(0, 10);
}

// ─── Avatar upload ────────────────────────────────────────────────────────

const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function uploadAvatar(
  userId: string,
  base64Data: string,
  contentType: string,
): Promise<string> {
  const ext = ALLOWED_AVATAR_TYPES[contentType];
  if (!ext) {
    throw new AppError('invalid_file_type', 'Only JPEG, PNG, WebP and GIF images are allowed.', 400);
  }

  // Strip data-URL prefix if present
  const raw = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const buffer = Buffer.from(raw, 'base64');

  if (buffer.length > 5 * 1024 * 1024) {
    throw new AppError('file_too_large', 'Image must be under 5 MB.', 400);
  }

  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(path, buffer, { contentType, upsert: true });

  if (uploadError) {
    logger.error({ userId, uploadError }, 'avatar_upload_failed');
    // Surface Supabase error detail (e.g. "Bucket not found") for easier diagnosis
    throw new AppError(
      'upload_failed',
      `Failed to upload avatar: ${uploadError.message}`,
      500,
    );
  }

  const { data: urlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ avatar_url: publicUrl })
    .eq('id', userId);

  if (updateError) {
    logger.error({ userId, updateError }, 'avatar_url_update_failed');
    throw new AppError('update_failed', 'Avatar uploaded but failed to save.', 500);
  }

  // Cache-bust so the browser loads the new image
  return `${publicUrl}?t=${Date.now()}`;
}

// ─── Username availability ────────────────────────────────────────────────

export async function checkUsernameAvailable(
  username: string,
  currentUserId?: string,
): Promise<{ available: boolean; reason?: string }> {
  const validation = isValidUsername(username);
  if (!validation.valid) {
    return { available: false, reason: validation.reason };
  }

  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (data && (data as any).id !== currentUserId) {
    return { available: false, reason: 'Username is already taken.' };
  }

  return { available: true };
}
