import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { ipRateLimit } from '../middleware/rate-limit.middleware';
import { supabaseAdmin, supabaseAuth, SUPABASE_MODE } from '../config/supabase';
import {
  signupSchema,
  loginSchema,
  refreshSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  confirmEmailSchema,
  resendConfirmationSchema,
} from '../schemas/auth.schema';
import * as authService from '../services/auth.service';
import * as orgsService from '../services/organizations.service';
import * as invitesService from '../services/org-invites.service';
import { success } from '../utils/shape';
import { generateUsername } from '../services/usernames.service';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const router = Router();

/**
 * Create a Merit auth user (+ public.users row) with the given credentials.
 * Throws { code: 'EMAIL_EXISTS' } if the email is already registered.
 * One Merit account per email — used by the org-first signup flow.
 */
async function createMeritAccount(email: string, password: string, name: string): Promise<string> {
  const emailLower = email.toLowerCase();

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email_lower', emailLower)
    .maybeSingle();
  if (existing) {
    const e: any = new Error('An account with this email already exists. Please sign in instead.');
    e.code = 'EMAIL_EXISTS';
    throw e;
  }

  let authUserId: string;
  if (SUPABASE_MODE === 'mock') {
    const { data, error } = await supabaseAuth.auth.signUp({ email, password, options: { data: { name } } });
    if (error || !data?.user) throw new Error(error?.message ?? 'Failed to create account');
    authUserId = data.user.id;
  } else {
    const projectUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '').replace(/\/(rest|auth)\/v\d+.*$/, '');
    const r = await fetch(`${projectUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
    });
    const b = await r.json() as any;
    if (!r.ok || !b?.id) throw new Error(b?.msg ?? b?.message ?? 'Failed to create account');
    authUserId = b.id as string;
  }

  const parts = name.trim().split(/\s+/);
  const username = await generateUsername(parts[0] ?? name, parts.slice(1).join(' ') || (parts[0] ?? name));
  const { error: userError } = await supabaseAdmin.from('users').insert({
    id: authUserId,
    email,
    email_lower: emailLower,
    name,
    username,
    plan: 'free',
    onboarding_completed: true,
  });
  if (userError) {
    if (SUPABASE_MODE !== 'mock') await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
    throw new Error('Failed to create user profile');
  }
  return authUserId;
}

// POST /auth/signup
router.post(
  '/auth/signup',
  ipRateLimit('signup', 5, 1),
  validate(signupSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.signup(req.body);
      res.status(201).json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/login
router.post(
  '/auth/login',
  ipRateLimit('login', 10, 1),
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress;
      const result = await authService.login({ ...req.body, ip });
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/logout
router.post(
  '/auth/logout',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Revoke all server-side sessions for this user (best-effort — don't surface errors)
      if (SUPABASE_MODE !== 'mock') {
        const authHeader = req.headers.authorization;
        const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (accessToken) {
          await (supabaseAdmin.auth.admin as any)
            .signOut?.(accessToken, 'global')
            .catch(() => { /* non-fatal */ });
        }
      }
      res.json(success({ loggedOut: true }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/refresh
router.post(
  '/auth/refresh',
  ipRateLimit('token_refresh', 30, 1),
  validate(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.refreshSession(req.body.refreshToken);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/request-password-reset
router.post(
  '/auth/request-password-reset',
  ipRateLimit('password_reset', 3, 1),
  validate(requestPasswordResetSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress;
      await authService.requestPasswordReset(req.body.email, ip);
      res.json(success({ message: 'If that email exists, a reset link has been sent.' }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/reset-password
router.post(
  '/auth/reset-password',
  ipRateLimit('password_reset_submit', 5, 1),
  validate(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.resetPassword(req.body.token, req.body.newPassword);
      res.json(success({ message: 'Password updated.' }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/confirm-email
router.post(
  '/auth/confirm-email',
  validate(confirmEmailSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.confirmEmail(req.body.token);
      res.json(success({ confirmed: true }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/resend-confirmation
router.post(
  '/auth/resend-confirmation',
  ipRateLimit('resend_confirmation', 3, 1),
  validate(resendConfirmationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.resendConfirmation(req.body.email);
      res.json(success({ message: 'Confirmation email sent.' }));
    } catch (err) {
      next(err);
    }
  },
);

// GET /auth/me
router.get(
  '/auth/me',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.getMe(req.user!.id);
      res.json(success({ user }));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /auth/accept-consent — minor self-accepts on /onboarding/consent page
router.patch(
  '/auth/accept-consent',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.acceptConsent(req.user!.id);
      res.json(success({ user }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/login/org — org-admin login; returns orgs the user administers
router.post(
  '/auth/login/org',
  ipRateLimit('login', 10, 1),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(1),
      });
      const { email, password } = schema.parse(req.body);

      // Use the ANON client for sign-in. Calling signInWithPassword on the
      // service-role client contaminates its shared session with the user's JWT,
      // causing all later DB writes in the process to run under RLS as the user
      // (silently affecting 0 rows). See config/supabase.ts.
      const { data: authData, error: authError } =
        await supabaseAuth.auth.signInWithPassword({ email, password });

      if (authError || !authData?.user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const { data: orgAdminRecords } = await supabaseAdmin
        .from('org_admins')
        .select('role, organizations(id, name, slug, logo_url)')
        .eq('user_id', authData.user.id);

      if (!orgAdminRecords?.length) {
        return res.status(403).json({
          error: 'No organization access',
          message:
            'This account does not have access to any organization. ' +
            'Ask your org admin to invite you, or sign up as a student.',
        });
      }

      const { data: user, error: userErr } = await supabaseAdmin
        .from('users')
        .select('id, name, email, plan, avatar_url')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (userErr || !user) {
        // The org_admins row references this user_id, but the public.users row
        // is missing or unreadable. Don't fail the login — fall back to the auth
        // identity so the dashboard still loads. Logged for later data cleanup.
        logger.warn({ userId: authData.user.id, userErr }, 'org_login_user_row_missing');
      }

      const safeUser = user ?? {
        id: authData.user.id,
        name:
          (authData.user.user_metadata as any)?.name ??
          authData.user.email?.split('@')[0] ??
          'Org Admin',
        email: authData.user.email ?? '',
        plan: 'free',
        avatar_url: null,
      };

      const orgs = orgAdminRecords.map((r: any) => ({
        ...r.organizations,
        role: r.role,
      }));

      return res.json(
        success({
          user: safeUser,
          orgs,
          defaultOrgId: orgs[0]?.id,
          accessToken: authData.session?.access_token,
          refreshToken: authData.session?.refresh_token,
          expiresAt: authData.session?.expires_at,
        }),
      );
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input' });
      }
      next(err);
    }
  },
);

// POST /auth/org/signup — create a Merit account and add as org admin
router.post(
  '/auth/org/signup',
  ipRateLimit('signup', 5, 1),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(2).max(100),
        orgId: z.string().uuid(),
        role: z.enum(['owner', 'admin', 'coordinator']).default('owner'),
        token: z.string().optional(),
      });
      const body = schema.parse(req.body);

      // Verify the org exists
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id, name')
        .eq('id', body.orgId)
        .maybeSingle();

      if (!org) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      // Check email not already taken
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email_lower', body.email.toLowerCase())
        .maybeSingle();

      if (existingUser) {
        return res.status(409).json({
          error: 'An account with this email already exists. Please sign in instead.',
          code: 'EMAIL_EXISTS',
        });
      }

      // Create Supabase auth user via GoTrue admin API (same pattern as auth.service.ts)
      let authUserId: string;
      if (SUPABASE_MODE === 'mock') {
        const { data: mockData, error: mockErr } = await supabaseAuth.auth.signUp({
          email: body.email,
          password: body.password,
          options: { data: { name: body.name } },
        });
        if (mockErr || !mockData?.user) {
          return res.status(400).json({ error: mockErr?.message ?? 'Failed to create account' });
        }
        authUserId = mockData.user.id;
      } else {
        const projectUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '').replace(/\/(rest|auth)\/v\d+.*$/, '');
        const gotrueRes = await fetch(`${projectUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY!,
          },
          body: JSON.stringify({
            email: body.email,
            password: body.password,
            email_confirm: true, // auto-confirm for org admin accounts
            user_metadata: { name: body.name },
          }),
        });
        const gotrueBody = await gotrueRes.json() as any;
        if (!gotrueRes.ok || !gotrueBody?.id) {
          return res.status(400).json({ error: gotrueBody?.msg ?? gotrueBody?.message ?? 'Failed to create account' });
        }
        authUserId = gotrueBody.id as string;
      }

      // Generate username and insert user row
      const nameParts = body.name.trim().split(/\s+/);
      const firstName = nameParts[0] ?? body.name;
      const lastName = nameParts.slice(1).join(' ') || firstName;
      const username = await generateUsername(firstName, lastName);

      const { error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authUserId,
          email: body.email,
          email_lower: body.email.toLowerCase(),
          name: body.name,
          username,
          plan: 'free',
          onboarding_completed: true, // skip student onboarding for org admins
        });

      if (userError) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
        return res.status(500).json({ error: 'Failed to create user profile' });
      }

      // Add as org admin (onboarding_completed: false so they see the walkthrough)
      await supabaseAdmin
        .from('org_admins')
        .upsert({
          org_id: body.orgId,
          user_id: authUserId,
          role: body.role,
          onboarding_completed: false,
        })
        .catch((err: unknown) => {
          void err; // non-fatal — account still created
        });

      // Sign in immediately to return tokens (anon client — never the admin client)
      const { data: sessionData, error: signInError } =
        await supabaseAuth.auth.signInWithPassword({
          email: body.email,
          password: body.password,
        });

      if (signInError || !sessionData.session) {
        // Account created but sign-in failed — user can sign in manually
        return res.status(201).json({
          data: {
            user: { id: authUserId, name: body.name, email: body.email, username, plan: 'free' },
            org: { id: org.id, name: org.name, role: body.role },
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
          },
        });
      }

      return res.status(201).json(
        success({
          user: { id: authUserId, name: body.name, email: body.email, username, plan: 'free' },
          org: { id: org.id, name: org.name, slug: '', role: body.role },
          accessToken: sessionData.session.access_token,
          refreshToken: sessionData.session.refresh_token,
          expiresAt: sessionData.session.expires_at,
        }),
      );
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      next(err);
    }
  },
);

// POST /auth/change-password — change password for authenticated user
router.post(
  '/auth/change-password',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const userEmail = req.user!.email;
      if (!userEmail) {
        return res.status(400).json({ error: 'User email not found' });
      }

      // Verify current password by attempting sign-in (anon client — never admin)
      const { error: signInError } = await supabaseAuth.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (signInError) {
        return res.status(401).json({
          error: 'Current password is incorrect',
          code: 'INVALID_CURRENT_PASSWORD',
        });
      }

      // Update to new password
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        req.user!.id,
        { password: newPassword },
      );

      if (updateError) {
        logger.error(updateError, 'change_password_update_failed');
        return res.status(500).json({ error: 'Failed to update password' });
      }

      logger.info({ userId: req.user!.id }, 'password_changed');
      return res.json(success({ changed: true }));
    } catch (err) {
      logger.error(err, 'change_password_error');
      next(err);
    }
  },
);

// POST /auth/org/create — org-first signup: create a Merit account AND an org in
// one step, making the new account the owner. Optionally invites admins by email.
// No student profile/onboarding required — one Merit account works everywhere.
router.post(
  '/auth/org/create',
  ipRateLimit('signup', 5, 1),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        // org details
        name: z.string().min(2).max(100),            // org name
        category: z.string().min(1).max(50),
        city: z.string().min(2).max(100),
        province: z.string().max(50).optional(),
        country: z.string().default('Canada'),
        websiteUrl: z.string().url().optional().or(z.literal('')),
        description: z.string().max(500).optional(),
        contactPhone: z.string().max(20).optional(),
        isRecruiting: z.boolean().default(false),
        adminEmails: z.array(z.string().email()).max(20).optional(),
      });
      const body = schema.parse(req.body);

      // 1) Create the owner's Merit account
      let ownerId: string;
      try {
        ownerId = await createMeritAccount(body.email, body.password, body.name);
      } catch (e: any) {
        if (e?.code === 'EMAIL_EXISTS') {
          return res.status(409).json({ error: e.message, code: 'EMAIL_EXISTS' });
        }
        throw e;
      }

      // 2) Create the org record
      const org = await orgsService.createOrgRecord({
        name: body.name,
        category: body.category,
        city: body.city,
        province: body.province,
        country: body.country,
        websiteUrl: body.websiteUrl,
        description: body.description,
        contactEmail: body.email,
        contactPhone: body.contactPhone,
        isRecruiting: body.isRecruiting,
      });

      // 3) Make the account the owner
      await supabaseAdmin.from('org_admins').insert({
        org_id: org.id,
        user_id: ownerId,
        role: 'owner',
        onboarding_completed: false,
      });

      // 4) Invite any admins (new users are prompted to create a Merit account on accept)
      const invited: string[] = [];
      for (const ae of (body.adminEmails ?? [])) {
        if (ae.toLowerCase() === body.email.toLowerCase()) continue;
        try {
          await invitesService.createInvite({ orgId: org.id, invitedBy: ownerId, email: ae, role: 'admin' });
          invited.push(ae);
        } catch (err) {
          logger.warn({ err, email: ae, orgId: org.id }, 'org_create_invite_failed');
        }
      }

      // 5) Sign the owner in (anon client — never the admin client)
      const { data: session } = await supabaseAuth.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });

      const orgSummary = { id: org.id, name: org.name, slug: org.slug, role: 'owner' as const };
      return res.status(201).json(success({
        user: { id: ownerId, name: body.name, email: body.email, plan: 'free' },
        org: orgSummary,
        orgs: [orgSummary],
        defaultOrgId: org.id,
        invited,
        accessToken: session?.session?.access_token ?? null,
        refreshToken: session?.session?.refresh_token ?? null,
        expiresAt: session?.session?.expires_at ?? null,
      }));
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: err.errors });
      }
      logger.error(err, 'org_create_error');
      return res.status(500).json({ error: 'org_create_failed', message: String(err?.message ?? err) });
    }
  },
);

export default router;
