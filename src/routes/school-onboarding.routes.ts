import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { ipRateLimit } from '../middleware/rate-limit.middleware';
import { validate } from '../middleware/validate.middleware';
import { validateUuidParam } from '../middleware/validate-uuid.middleware';
import * as onboarding from '../services/school-onboarding.service';
import { success } from '../utils/shape';
import { env } from '../config/env';

const router = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!env.ADMIN_EMAIL || req.user!.email !== env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// ── Public: submit a school lead (request early access) ──────────────────────
const leadSchema = z.object({
  schoolName: z.string().min(2).max(200),
  coordinatorName: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.string().max(120).optional(),
  studentCount: z.number().int().min(0).max(100000).optional(),
  note: z.string().max(1000).optional(),
});

router.post(
  '/school-leads',
  ipRateLimit('school_lead', 5, 1), // max 5 submissions per IP per hour — anti-spam
  validate(leadSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await onboarding.submitLead(req.body);
      res.status(201).json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ── Admin: review leads ──────────────────────────────────────────────────────
router.get('/admin/schools', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const data = await onboarding.listLeads(status);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// ── Admin: provision a chapter (the "approve" action) ────────────────────────
const provisionSchema = z.object({
  leadId: z.string().uuid().optional(),
  schoolName: z.string().min(2).max(200),
  coordinatorEmail: z.string().email(),
  coordinatorName: z.string().max(120).optional(),
  maxMembers: z.number().int().min(1).max(100000).optional(),
  requiredHours: z.number().int().min(0).max(10000).optional(),
});

router.post(
  '/admin/schools/provision',
  requireAuth,
  requireAdmin,
  validate(provisionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await onboarding.provisionChapter(req.body);
      res.status(201).json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ── Admin: reject a lead ─────────────────────────────────────────────────────
router.post(
  '/admin/schools/:leadId/reject',
  requireAuth,
  requireAdmin,
  validateUuidParam('leadId'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await onboarding.rejectLead(req.params.leadId as string);
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ── Coordinator: claim a provisioned chapter ─────────────────────────────────
const claimSchema = z.object({ token: z.string().min(10).max(200) });

router.post(
  '/chapter/claim',
  requireAuth,
  validate(claimSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await onboarding.claimChapter(req.body.token, req.user!.id, req.user!.email);
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
