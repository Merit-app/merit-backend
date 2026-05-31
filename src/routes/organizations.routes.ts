import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validate.middleware';
import { orgSearchSchema, createOrgSchema, createPublicOrgSchema, updateOrgSchema } from '../schemas/organizations.schema';
import * as orgsService from '../services/organizations.service';
import * as orgFollowsService from '../services/org-follows.service';
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

// ─── POST /organizations/:orgId/team/invite ───────────────────────────────────
router.post('/organizations/:orgId/team/invite', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role } = req.body as { email?: string; role?: string };
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    const validRole = role === 'admin' ? 'admin' : 'coordinator';
    const result = await orgsService.inviteTeamMember(
      req.params.orgId as string,
      req.user!.id,
      email,
      validRole as 'coordinator' | 'admin',
    );
    res.status(201).json(success(result));
  } catch (err: any) {
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

export default router;
