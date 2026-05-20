import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { ipRateLimit } from '../middleware/rate-limit.middleware';
import {
  signupSchema,
  loginSchema,
  refreshSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  confirmEmailSchema,
  resendConfirmationSchema,
  parentalConsentSchema,
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
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(success({ loggedOut: true }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/refresh
router.post(
  '/auth/refresh',
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

// POST /auth/parental-consent
router.post(
  '/auth/parental-consent',
  validate(parentalConsentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.processParentalConsent(req.body);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
