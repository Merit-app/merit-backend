import slugify from 'slugify';
import { nanoid } from 'nanoid';
import { supabaseAdmin } from '../config/supabase';

// ─── Reserved words ───────────────────────────────────────────────────────

export const RESERVED_USERNAMES = new Set([
  'admin', 'api', 'app', 'dashboard', 'help', 'login', 'signup',
  'merit', 'support', 'team', 'terms', 'privacy', 'org', 'orgs',
  'u', 'user', 'users', 'static', 'assets', 'public', 'null',
  'undefined', 'root', 'system', 'moderator', 'mod', 'home',
  'about', 'contact', 'health', 'status', 'settings', 'profile',
  'billing', 'notifications', 'auth', 'logout', 'register',
]);

// ─── Validation ───────────────────────────────────────────────────────────

const USERNAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const CONSECUTIVE_HYPHENS_REGEX = /--/;

export function isValidUsername(username: string): { valid: boolean; reason?: string } {
  if (username.length < 3) {
    return { valid: false, reason: 'Username must be at least 3 characters' };
  }
  if (username.length > 30) {
    return { valid: false, reason: 'Username must be at most 30 characters' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      reason: 'Only lowercase letters, numbers, and hyphens allowed. Cannot start or end with a hyphen.',
    };
  }
  if (CONSECUTIVE_HYPHENS_REGEX.test(username)) {
    return { valid: false, reason: 'Cannot contain consecutive hyphens' };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { valid: false, reason: 'That username is reserved' };
  }
  return { valid: true };
}

// ─── DB lookup ────────────────────────────────────────────────────────────

export async function checkUsernameExists(username: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  return !!data;
}

// ─── Generation ───────────────────────────────────────────────────────────

export async function generateUsername(
  firstName: string,
  lastName: string,
): Promise<string> {
  const raw = `${firstName} ${lastName}`.trim();
  const base = slugify(raw, { lower: true, strict: true }) || 'user';
  const suffix = nanoid(4).toLowerCase();

  // Ensure total length ≤ 30 (slugify edge cases with long names)
  const trimmedBase = base.length > 25 ? base.slice(0, 25) : base;
  const candidate = `${trimmedBase}-${suffix}`;

  const exists = await checkUsernameExists(candidate);
  if (exists) return generateUsername(firstName, lastName);
  return candidate;
}
