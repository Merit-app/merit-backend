import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import * as orgClaimsService from '../services/org-claims.service';
import { supabaseAdmin } from '../config/supabase';
import { success } from '../utils/shape';
import { logger } from '../lib/logger';
import { env } from '../config/env';

const router = Router();

const VALID_ROLES = ['employee', 'coordinator', 'owner', 'board_member', 'other'] as const;

// GET /org-claims — list all claims (admin only)
router.get(
  '/org-claims',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user!.email !== env.ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Admin only' });
      }
      const { status } = req.query;
      let query = supabaseAdmin
        .from('org_claims')
        .select(`
          id, status, role, email, email_domain, domain_matched,
          created_at, reviewed_at, rejected_reason,
          users:user_id ( id, name, email ),
          organizations:org_id ( id, name, slug, website_url )
        `)
        .order('created_at', { ascending: false });

      if (status && typeof status === 'string') {
        query = query.eq('status', status) as typeof query;
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.json(success({ claims: data ?? [] }));
    } catch (err) {
      next(err);
    }
  },
);

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
      if (!env.ADMIN_EMAIL || req.user!.email !== env.ADMIN_EMAIL) {
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
      if (!env.ADMIN_EMAIL || req.user!.email !== env.ADMIN_EMAIL) {
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
