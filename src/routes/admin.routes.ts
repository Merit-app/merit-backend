import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { validateUuidParam } from '../middleware/validate-uuid.middleware';
import { z } from 'zod';
import * as adminService from '../services/admin.service';
import { success } from '../utils/shape';

const router = Router();

router.use('/admin', requireAuth);

// ─── Chapter ──────────────────────────────────────────────────────────────

// GET /admin/chapter
router.get('/admin/chapter', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await adminService.getChapter(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/chapter
const updateChapterSchema = z.object({
  name: z.string().min(1).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  verifiedEmailDomain: z.string().optional(),
  requiredHours: z.number().int().min(0).max(10000).optional(),
});

router.patch(
  '/admin/chapter',
  validate(updateChapterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.updateChapter(req.user!.id, req.body);
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Members ──────────────────────────────────────────────────────────────

// GET /admin/members
router.get('/admin/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await adminService.getMembers(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/members/:memberId
router.delete(
  '/admin/members/:memberId',
  validateUuidParam('memberId'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.removeMember(req.user!.id, req.params.memberId as string);
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Coordinators ─────────────────────────────────────────────────────────

// GET /admin/coordinators
router.get('/admin/coordinators', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await adminService.getCoordinators(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/coordinators/:userId
router.delete(
  '/admin/coordinators/:userId',
  validateUuidParam('userId'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.removeCoordinator(
        req.user!.id,
        req.params.userId as string,
      );
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Whitelist ────────────────────────────────────────────────────────────

// GET /admin/whitelist
router.get('/admin/whitelist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await adminService.getWhitelist(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

const whitelistEntrySchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  orgId: z.string().uuid().optional(),
});

// POST /admin/whitelist
router.post(
  '/admin/whitelist',
  validate(whitelistEntrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.addToWhitelist(req.user!.id, req.body);
      res.status(201).json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /admin/whitelist/:entryId
router.delete(
  '/admin/whitelist/:entryId',
  validateUuidParam('entryId'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.removeFromWhitelist(
        req.user!.id,
        req.params.entryId as string,
      );
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Invites ──────────────────────────────────────────────────────────────

// GET /admin/invites
router.get('/admin/invites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await adminService.getInvites(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

const inviteSchema = z.object({ email: z.string().email() });

// POST /admin/invites
router.post(
  '/admin/invites',
  validate(inviteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.createInvite(req.user!.id, req.body.email);
      res.status(201).json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /admin/invites/:inviteId
router.delete(
  '/admin/invites/:inviteId',
  validateUuidParam('inviteId'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.revokeInvite(req.user!.id, req.params.inviteId as string);
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// POST /admin/invites/accept
const acceptInviteSchema = z.object({ token: z.string().min(1) });

router.post(
  '/admin/invites/accept',
  validate(acceptInviteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.acceptInvite(req.body.token, req.user!.id);
      res.json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Roster bulk import ─────────────────────────────────────────────────────

const rosterImportSchema = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        email: z.string().email(),
        graduationYear: z.number().int().min(1900).max(2100).nullish(),
      }),
    )
    .min(1)
    .max(1000), // cap batch size — anything larger should be paginated client-side
});

// POST /admin/roster/import
router.post(
  '/admin/roster/import',
  validate(rosterImportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminService.importRoster(req.user!.id, req.body.rows);
      res.status(201).json(success(data));
    } catch (err) {
      next(err);
    }
  },
);

// ─── Cohort compliance ──────────────────────────────────────────────────────

// GET /admin/compliance
router.get('/admin/compliance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await adminService.getCompliance(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// GET /admin/compliance/export — CSV download of the cohort compliance report
router.get('/admin/compliance/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const csv = await adminService.getComplianceCsv(req.user!.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="compliance.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ─── Grant report ─────────────────────────────────────────────────────────

// GET /admin/reports/grant?from=2024-01-01&to=2024-12-31
router.get('/admin/reports/grant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = z
      .object({
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        format: z.enum(['json', 'csv']).optional(),
      })
      .parse(req.query);

    if (query.format === 'csv') {
      const csv = await adminService.getGrantReportCsv(req.user!.id, query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="grant-report.csv"');
      return res.send(csv);
    }

    const data = await adminService.getGrantReport(req.user!.id, query);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

export default router;
