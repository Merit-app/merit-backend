import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validate.middleware';
import { orgSearchSchema, createOrgSchema, createPublicOrgSchema, updateOrgSchema } from '../schemas/organizations.schema';
import * as orgsService from '../services/organizations.service';
import * as orgFollowsService from '../services/org-follows.service';
import { logger } from '../lib/logger';
import { success } from '../utils/shape';

const router = Router();

// ─── GET /organizations/search ────────────────────────────────────────────────
router.get(
  '/organizations/search',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = orgSearchSchema.parse(req.query);
      const results = await orgsService.searchOrganizations(parsed.q, parsed.limit);
      res.json(success(results));
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /organizations/me ────────────────────────────────────────────────────
router.get('/organizations/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = await orgsService.getUserOrganizations(req.user!.id);
    res.json(success(orgs));
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/following ─────────────────────────────────────────────
// Must come BEFORE /organizations/:id
router.get('/organizations/following', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = await orgFollowsService.getFollowedOrgs(req.user!.id);
    res.json(success(orgs));
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/discover ──────────────────────────────────────────────
// Must come BEFORE /organizations/:id
router.get('/organizations/discover', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 60) : 30;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const orgs = await orgFollowsService.discoverOrgs(req.user!.id, { category, q, limit, offset });
    res.json(success(orgs));
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/admin/mine ────────────────────────────────────────────
// Must come BEFORE /organizations/:id so "admin" isn't matched as an orgId
router.get('/organizations/admin/mine', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = await orgsService.getAdminOrgs(req.user!.id);
    res.json(success(orgs));
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/:orgId/volunteers ─────────────────────────────────────
router.get('/organizations/:orgId/volunteers', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const volunteers = await orgsService.getOrgVolunteers(req.params.orgId as string, req.user!.id);
    res.json(success({ volunteers }));
  } catch (err) {
    next(err);
  }
});

// ─── POST /organizations/:orgId/sessions/:sessionId/verify ────────────────────
router.post('/organizations/:orgId/sessions/:sessionId/verify', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgsService.verifySessionAsOrg(
      req.params.orgId as string,
      req.params.sessionId as string,
      req.user!.id,
    );
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── POST /organizations/:orgId/sessions/:sessionId/dispute ───────────────────
router.post('/organizations/:orgId/sessions/:sessionId/dispute', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgsService.disputeSessionAsOrg(
      req.params.orgId as string,
      req.params.sessionId as string,
      req.user!.id,
    );
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── POST /organizations/:orgId/volunteers/:userId/adjust-hours ───────────────
// Org admin manually adds (positive) or subtracts (negative) verified hours for
// a volunteer. Writes one verified session under the org — shows on both sides.
router.post(
  '/organizations/:orgId/volunteers/:userId/adjust-hours',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        hours: z
          .number()
          .refine((n) => Number.isFinite(n) && n !== 0, 'Enter a non-zero number of hours')
          .refine((n) => Math.abs(n) <= 1000, 'Hours must be between -1000 and 1000'),
        reason: z.string().max(200).optional(),
      });
      const body = schema.parse(req.body);
      const result = await orgsService.adjustVolunteerHours(
        req.params.orgId as string,
        req.user!.id,
        req.params.userId as string,
        body.hours,
        body.reason,
      );
      res.status(201).json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /organizations/:orgId/team/invite ───────────────────────────────────
router.post('/organizations/:orgId/team/invite', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      email: z.string().email('Invalid email address'),
      role: z.enum(['coordinator', 'admin']).default('coordinator'),
    });
    const body = schema.parse(req.body);
    const result = await orgsService.inviteTeamMember(
      req.params.orgId as string,
      req.user!.id,
      body.email,
      body.role,
    );
    res.status(201).json(success(result));
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.issues });
    }
    if (err?.message === 'NO_ACCOUNT') {
      return res.status(404).json({ error: 'No Merit account found with that email. They need to sign up first.' });
    }
    if (err?.message === 'ALREADY_MEMBER') {
      return res.status(409).json({ error: 'Already a team member' });
    }
    next(err);
  }
});

// ─── DELETE /organizations/:orgId/team/:userId ────────────────────────────────
router.delete('/organizations/:orgId/team/:userId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgsService.removeTeamMember(
      req.params.orgId as string,
      req.user!.id,
      req.params.userId as string,
    );
    res.json(success(result));
  } catch (err: any) {
    if (err?.message === 'SELF_REMOVE') {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }
    next(err);
  }
});

// ─── GET /organizations/:orgId/export ─────────────────────────────────────────
router.get('/organizations/:orgId/export', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { csv, filename } = await orgsService.exportVolunteerCSV(
      req.params.orgId as string,
      req.user!.id,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/:id ───────────────────────────────────────────────────
router.get('/organizations/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const org = await orgsService.getOrganization(req.params.id as string);
    res.json(success({ org }));
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/:id/dashboard ────────────────────────────────────────
router.get('/organizations/:id/dashboard', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await orgsService.getOrgDashboard(req.params.id as string, req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /organizations/:id ─────────────────────────────────────────────────
router.patch('/organizations/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateOrgSchema.parse(req.body);
    const result = await orgsService.updateOrg(req.params.id as string, req.user!.id, parsed);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /organizations/:id ────────────────────────────────────────────────
// Permanently delete an org. Owner only (enforced in the service).
router.delete('/organizations/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgsService.deleteOrg(req.params.id as string, req.user!.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── POST /organizations/:id/follow ──────────────────────────────────────────
router.post('/organizations/:id/follow', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgFollowsService.toggleFollow(req.user!.id, req.params.id as string);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/:id/stats ────────────────────────────────────────────
// Public — no auth required
router.get('/organizations/:id/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await orgFollowsService.getOrgStats(req.params.id as string);
    res.json(success(stats));
  } catch (err) {
    next(err);
  }
});

// ─── GET /organizations/:id/similar ──────────────────────────────────────────
// Public — no auth required
router.get('/organizations/:id/similar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const similar = await orgFollowsService.getSimilarOrgs(req.params.id as string);
    res.json(success(similar));
  } catch (err) {
    next(err);
  }
});

// ─── POST /organizations ──────────────────────────────────────────────────────
// Any authenticated user can create an org — they become the owner/admin
router.post(
  '/organizations',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createPublicOrgSchema.parse(req.body);
      const org = await orgsService.createOrgByUser(parsed, req.user!.id, req.user!.email ?? '');
      res.status(201).json(success({ org }));
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid org data', details: err.errors });
      }
      next(err);
    }
  },
);

// ─── PATCH /organizations/:orgId/profile ──────────────────────────────────────
// Full profile update including name — org admins only
router.patch(
  '/organizations/:orgId/profile',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(200).optional(),
        description: z.string().max(1000).optional(),
        website_url: z.string().url().optional().or(z.literal('')),
        contact_email: z.string().email().optional().or(z.literal('')),
        contact_phone: z.string().max(30).optional().or(z.literal('')),
        is_recruiting: z.boolean().optional(),
      });
      const body = schema.parse(req.body);
      const updated = await orgsService.updateOrgProfile(
        req.params.orgId as string,
        req.user!.id,
        body,
      );
      return res.json(success(updated));
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Invalid input' });
      }
      if (err?.message === 'Not authorized to edit this organization') {
        return res.status(403).json({ error: err.message });
      }
      if (err?.message === 'No fields to update') {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  },
);

// ─── POST /organizations/:orgId/logo?type=logo|cover ──────────────────────────
// Upload a logo or cover image — org admins only
router.post(
  '/organizations/:orgId/logo',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = req.query.type === 'cover' ? 'cover' : 'logo';
      const schema = z.object({
        base64: z.string().min(1),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
      });
      const body = schema.parse(req.body);
      const result = await orgsService.uploadOrgImage({
        orgId: req.params.orgId as string,
        userId: req.user!.id,
        kind,
        base64: body.base64,
        mimeType: body.mimeType,
      });
      return res.json(success(result));
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Invalid input' });
      }
      if (err?.message === 'Not authorized to edit this organization') {
        return res.status(403).json({ error: err.message });
      }
      if (err?.message?.includes('Only JPEG') || err?.message?.includes('under 5 MB')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  },
);

// ─── POST /organizations/:orgId/interest — student registers as volunteer ─────
router.post('/organizations/:orgId/interest', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgsService.registerInterest(
      req.params.orgId as string,
      req.user!.id,
    );
    res.json(success(result));
  } catch (err: any) {
    if (err?.name === 'NotFoundError') {
      return res.status(404).json({ error: 'Organization not found' });
    }
    logger.error(err, 'register_interest_failed');
    next(err);
  }
});

// ─── DELETE /organizations/:orgId/interest — student unregisters ──────────────
router.delete('/organizations/:orgId/interest', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgsService.unregisterInterest(
      req.params.orgId as string,
      req.user!.id,
    );
    res.json(success(result));
  } catch (err) {
    logger.error(err, 'unregister_interest_failed');
    next(err);
  }
});

// ─── GET /organizations/:orgId/interest/status ────────────────────────────────
router.get('/organizations/:orgId/interest/status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await orgsService.getInterestStatus(
      req.params.orgId as string,
      req.user!.id,
    );
    res.json(success(result));
  } catch (err) {
    logger.error(err, 'interest_status_failed');
    next(err);
  }
});

export default router;
