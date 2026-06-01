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

      const { data: user } = await supabaseAdmin
        .from('users')
        .select('id, name, email, plan, avatar_url')
        .eq('id', authData.user.id)
        .single();

      const orgs = orgAdminRecords.map((r: any) => ({
        ...r.organizations,
        role: r.role,
      }));

      return res.json(
        success({
          user,
          orgs,
          defaultOrgId: orgs[0]?.id,
          accessToken: authData.session?.access_token,
          refreshToken: authData.session?.refresh_token,
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

export default router;
