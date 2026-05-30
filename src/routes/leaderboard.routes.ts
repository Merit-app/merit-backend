import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth.middleware';
import { success } from '../utils/shape';
import { logger } from '../lib/logger';
import * as leaderboardService from '../services/leaderboard.service';

const router = Router();

// GET /leaderboard — main leaderboard, public with optional auth
router.get(
  '/leaderboard',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        type: z.enum(['global', 'local', 'school']).default('global'),
        period: z.enum(['all', 'month', 'week']).default('all'),
        school: z.string().optional(),
        city: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).default(50),
        offset: z.coerce.number().min(0).default(0),
      });

      const params = schema.parse(req.query);

      const result = await leaderboardService.getLeaderboard({
        type: params.type,
        period: params.period,
        currentUserId: req.user?.id,
        school: params.school,
        city: params.city,
        limit: params.limit,
        offset: params.offset,
      });

      res.json(success(result));
    } catch (err) {
      logger.error(err, 'leaderboard_fetch_error');
      next(err);
    }
  },
);

// GET /leaderboard/u/:username — public personal stats card
// Must be registered BEFORE any route that could shadow it
router.get(
  '/leaderboard/u/:username',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username } = req.params as { username: string };
      const stats = await leaderboardService.getUserLeaderboardStats(username);

      if (!stats) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Don't expose private user's real data — return minimal payload
      if (stats.user.isPrivate) {
        return res.json(
          success({
            user: { username: stats.user.username, isPrivate: true },
            stats: null,
            badges: [],
            topOrgs: [],
          }),
        );
      }

      res.json(success(stats));
    } catch (err) {
      logger.error(err, 'personal_leaderboard_stats_error');
      next(err);
    }
  },
);

export default router;
