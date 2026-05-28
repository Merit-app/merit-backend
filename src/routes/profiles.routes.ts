import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { rateLimit, ipRateLimit } from '../middleware/rate-limit.middleware';
import { updateProfileSchema, checkUsernameSchema } from '../schemas/profiles.schema';
import * as profilesService from '../services/profiles.service';
import * as badgesService from '../services/badges.service';
import { supabaseAdmin } from '../config/supabase';
import { success } from '../utils/shape';

const router = Router();

// ─── Profile routes ───────────────────────────────────────────────────────

// GET /profiles/me
router.get(
  '/profiles/me',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await profilesService.getMyProfile(req.user!.id);
      res.json(success({ profile }));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /profiles/me
router.patch(
  '/profiles/me',
  requireAuth,
  rateLimit('profile_update', { max: 10, windowHours: 1 }),
  validate(updateProfileSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await profilesService.updateMyProfile(req.user!.id, req.body);
      res.json(success({ profile }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /profiles/check-username  — no auth required
router.post(
  '/profiles/check-username',
  ipRateLimit('username_check', 30, 1),
  validate(checkUsernameSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await profilesService.checkUsernameAvailable(
        req.body.username as string,
        req.user?.id,
      );
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /profiles/:username  — public, no auth required
// NOTE: must be registered AFTER /profiles/me and /profiles/check-username
router.get(
  '/profiles/:username',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await profilesService.getPublicProfile(req.params.username as string);
      res.json(success({ profile }));
    } catch (err) {
      next(err);
    }
  },
);

// GET /profiles/:username/badges — public
router.get(
  '/profiles/:username/badges',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await profilesService.getPublicProfile(req.params.username as string);
      if (profile.isPrivate) {
        return res.json(success({ badges: [] }));
      }
      const badges = await badgesService.getEarnedBadgesForUser(profile.id);
      res.json(success({ badges }));
    } catch (err) {
      next(err);
    }
  },
);

// GET /profiles/:username/orgs — public
router.get(
  '/profiles/:username/orgs',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgs = await profilesService.getProfileOrgs(req.params.username as string);
      res.json(success({ orgs }));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Badge routes ─────────────────────────────────────────────────────────

// GET /badges — all badge definitions
router.get(
  '/badges',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { data } = await supabaseAdmin
        .from('badges')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      res.json(success({ badges: data ?? [] }));
    } catch (err) {
      next(err);
    }
  },
);

// GET /badges/me — my earned badges + progress on all badges
router.get(
  '/badges/me',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const badges = await badgesService.getAllBadgesWithProgress(req.user!.id);
      res.json(success({ badges }));
    } catch (err) {
      next(err);
    }
  },
);

// GET /badges/stats — rarity stats for all badges
router.get(
  '/badges/stats',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await badgesService.getBadgeStats();
      res.json(success({ stats }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /badges/refresh — force badge recompute for current user
router.post(
  '/badges/refresh',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const earned = await badgesService.computeBadgesForUser(req.user!.id);
      res.json(success({ earned: earned.length, badges: earned }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
