import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireFeature } from '../middleware/plan-gate.middleware';
import { z } from 'zod';
import * as exportsService from '../services/exports.service';
import { success } from '../utils/shape';

const router = Router();

router.use('/exports', requireAuth);

// POST /exports/pdf
// All plans can export. Free plan: service enforces 30-day lookback + watermark.
// Pro/Premium: full history, no watermark.
// Body: { from?: string (YYYY-MM-DD), to?: string (YYYY-MM-DD), includeSelfReported?: boolean }
router.post(
  '/exports/pdf',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opts = z
        .object({
          from: z.string().date().optional(),
          to: z.string().date().optional(),
          includeSelfReported: z.boolean().optional().default(false),
        })
        .parse(req.body);

      const result = await exportsService.exportSessionsPdf(req.user!.id, opts);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /exports/grant-report/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD  — institutional only
router.get(
  '/exports/grant-report/pdf',
  requireFeature('grant_report'),
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
