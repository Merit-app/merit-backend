import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { updateUserSchema } from '../schemas/users.schema';
import * as usersService from '../services/users.service';
import { success } from '../utils/shape';
import { safeSecretEqual } from '../lib/crypto';

const router = Router();

// All users routes require auth
router.use('/users', requireAuth);

// GET /users/me
router.get('/users/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usersService.getUser(req.user!.id);
    res.json(success({ user }));
  } catch (err) {
    next(err);
  }
});

// PATCH /users/me
router.patch(
  '/users/me',
  validate(updateUserSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await usersService.updateUser(req.user!.id, req.body);
      res.json(success({ user }));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /users/me
router.delete('/users/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await usersService.scheduleAccountDeletion(req.user!.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /users/me/cancel-deletion
router.post('/users/me/cancel-deletion', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await usersService.cancelAccountDeletion(req.user!.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// PATCH /users/me/notifications — update notification preferences (merges with existing)
router.patch('/users/me/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prefs = z
      .object({
        smsVerification: z.boolean().optional(),
        weeklyProgress: z.boolean().optional(),
        goalMilestones: z.boolean().optional(),
        productUpdates: z.boolean().optional(),
        marketingEmails: z.boolean().optional(),
      })
      .parse(req.body);

    const notifications = await usersService.updateUserNotifications(req.user!.id, prefs);
    res.json(success({ notifications }));
  } catch (err) {
    next(err);
  }
});

// GET /users/me/export
router.get('/users/me/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await usersService.exportUserData(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// POST /users/internal/purge-expired
// Internal-only endpoint — requires x-purge-secret header matching PURGE_SECRET env var.
// Called by a scheduled cron job to hard-delete accounts past their 30-day grace period.
router.post('/users/internal/purge-expired', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!process.env.PURGE_SECRET || !safeSecretEqual(req.headers['x-purge-secret'], process.env.PURGE_SECRET)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await usersService.purgeExpiredAccounts();
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

export default router;
