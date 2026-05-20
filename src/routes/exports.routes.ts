import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireFeature } from '../middleware/plan-gate.middleware';
import { z } from 'zod';
import * as exportsService from '../services/exports.service';
import { success } from '../utils/shape';

const router = Router();

router.use('/exports', requireAuth);

// GET /exports/sessions/pdf  — plan-gated to pro+
router.get(
  '/exports/sessions/pdf',
  requireFeature('export_pdf'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await exportsService.exportSessionsPdf(req.user!.id);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /exports/grant-report/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD  — institutional only
router.get(
  '/exports/grant-report/pdf',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = z
        .object({
          from: z.string().date().optional(),
          to: z.string().date().optional(),
        })
        .parse(req.query);

      const result = await exportsService.exportGrantReportPdf(req.user!.id, query);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
