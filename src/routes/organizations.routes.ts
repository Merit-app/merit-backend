import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validate.middleware';
import { orgSearchSchema, createOrgSchema } from '../schemas/organizations.schema';
import * as orgsService from '../services/organizations.service';
import { success } from '../utils/shape';

const router = Router();

// GET /organizations/search?q=...
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

// GET /organizations/me
router.get('/organizations/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = await orgsService.getUserOrganizations(req.user!.id);
    res.json(success(orgs));
  } catch (err) {
    next(err);
  }
});

// GET /organizations/:id
router.get('/organizations/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const org = await orgsService.getOrganization(req.params.id as string);
    res.json(success({ org }));
  } catch (err) {
    next(err);
  }
});

// POST /organizations
router.post(
  '/organizations',
  requireAuth,
  requireRole('coordinator', 'admin'),
  validate(createOrgSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await orgsService.createOrganization(req.body, req.user!.id, req.user!.role);
      res.status(201).json(success({ org }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
