import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import * as orgClaimsService from '../services/org-claims.service';
import { success } from '../utils/shape';
import { logger } from '../lib/logger';
import { env } from '../config/env';

const router = Router();

const VALID_ROLES = ['employee', 'coordinator', 'owner', 'board_member', 'other'] as const;

// POST /org-claims — submit a claim for an org
router.post(
  '/org-claims',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          orgId: z.string().uuid(),
          role: z.enum(VALID_ROLES),
          workEmail: z.string().email(),
        })
        .parse(req.body);

      const result = await orgClaimsService.submitOrgClaim({
        userId: req.user!.id,
        orgId: body.orgId,
        role: body.role,
        workEmail: body.workEmail,
      });

      return res.status(201).json(success(result));
    } catch (err: any) {
      if (err.message?.includes('already been claimed')) {
        return res.status(409).json({ error: err.message });
      }
      if (err.message?.includes('already have a pending')) {
        return res.status(409).json({ error: err.message });
      }
      if (err.message === 'Organization not found') {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  },
);

// GET /org-claims/status/:orgId — get this user's claim status for an org
router.get(
  '/org-claims/status/:orgId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.params;
      const status = await orgClaimsService.getClaimStatus({
        userId: req.user!.id,
        orgId: orgId as string,
      });
      return res.json(success({ status }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /org-claims/:claimId/approve — admin only
router.post(
  '/org-claims/:claimId/approve',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminEmail = env.ADMIN_EMAIL ?? 'kai@meritco.app';
      if (req.user!.email !== adminEmail) {
        return res.status(403).json({ error: 'Admin only' });
      }
      await orgClaimsService.approveClaim(req.params.claimId as string);
      return res.json(success({ approved: true }));
    } catch (err: any) {
      if (err.message === 'Claim not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

// POST /org-claims/:claimId/reject — admin only
router.post(
  '/org-claims/:claimId/reject',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminEmail = env.ADMIN_EMAIL ?? 'kai@meritco.app';
      if (req.user!.email !== adminEmail) {
        return res.status(403).json({ error: 'Admin only' });
      }
      const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
      await orgClaimsService.rejectClaim(req.params.claimId as string, reason);
      return res.json(success({ rejected: true }));
    } catch (err: any) {
      if (err.message === 'Claim not found') return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

export default router;
