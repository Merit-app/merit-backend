import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { success } from '../utils/shape';

const router = Router();

// GET /onboarding/status
router.get(
  '/onboarding/status',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('onboarding_completed, onboarding_skipped_at')
        .eq('id', req.user!.id)
        .single();

      if (error || !data) throw new AppError('not_found', 'User not found.', 404);

      res.json(
        success({
          onboardingCompleted: (data.onboarding_completed as boolean) ?? false,
          skippedAt: (data.onboarding_skipped_at as string) ?? null,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

// POST /onboarding/complete
router.post(
  '/onboarding/complete',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error } = await supabaseAdmin
        .from('users')
        .update({ onboarding_completed: true })
        .eq('id', req.user!.id);

      if (error) {
        throw new AppError('update_failed', 'Failed to mark onboarding complete.', 500);
      }

      logger.info({ userId: req.user!.id }, 'onboarding_completed');
      res.json(success({ onboardingCompleted: true }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /onboarding/skip
router.post(
  '/onboarding/skip',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error } = await supabaseAdmin
        .from('users')
        .update({
          onboarding_completed: true,
          onboarding_skipped_at: new Date().toISOString(),
        })
        .eq('id', req.user!.id);

      if (error) {
        throw new AppError('update_failed', 'Failed to skip onboarding.', 500);
      }

      logger.info({ userId: req.user!.id }, 'onboarding_skipped');
      res.json(success({ onboardingCompleted: true, skipped: true }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
