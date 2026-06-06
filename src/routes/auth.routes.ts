import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { ipRateLimit } from '../middleware/rate-limit.middleware';
import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
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
import { success } from '../utils/shape';
import { generateUsername } from '../services/usernames.service';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const router = Router();

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

      const { data: authData, error: authError } =
        await supabaseAdmin.auth.signInWithPassword({ email, password });

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
        const { data: mockData, error: mockErr } = await supabaseAdmin.auth.signUp({
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

      // Sign in immediately to return tokens
      const { data: sessionData, error: signInError } =
        await supabaseAdmin.auth.signInWithPassword({
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

      // Verify current password by attempting sign-in
      const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
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

export default router;
