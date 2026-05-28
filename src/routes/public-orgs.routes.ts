import { Router, type Request, type Response, type NextFunction } from 'express';
import { ipRateLimit } from '../middleware/rate-limit.middleware';
import { getPublicOrg } from '../services/public-orgs.service';
import { success } from '../utils/shape';

const router = Router();

/**
 * GET /orgs/:slug
 * Public org profile — no auth required.
 * Works with both the org `slug` and UUID `id` (fallback for slug backfill period).
 */
router.get(
  '/orgs/:slug',
  ipRateLimit('public_org_page', 120, 1),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await getPublicOrg(req.params.slug as string);
      res.json(success({ org }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
