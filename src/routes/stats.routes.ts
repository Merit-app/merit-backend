import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { z } from 'zod';
import * as statsService from '../services/stats.service';
import { success } from '../utils/shape';

const router = Router();

router.use('/stats', requireAuth);

// GET /stats/dashboard
router.get('/stats/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await statsService.getDashboardStats(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// GET /stats/weekly?weeks=12
router.get('/stats/weekly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weeks = z.coerce.number().int().min(1).max(52).default(12).parse(req.query.weeks);
    const data = await statsService.getWeeklyStats(req.user!.id, weeks);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// GET /stats/monthly?months=12
router.get('/stats/monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const months = z.coerce.number().int().min(1).max(24).default(12).parse(req.query.months);
    const data = await statsService.getMonthlyStats(req.user!.id, months);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// GET /stats/by-org
router.get('/stats/by-org', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await statsService.getOrgStats(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// GET /stats/by-month?year=YYYY
router.get('/stats/by-month', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()).parse(req.query.year);
    const data = await statsService.getByMonthStats(req.user!.id, year);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

// GET /stats/goal
router.get('/stats/goal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await statsService.getGoalProgress(req.user!.id);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

export default router;
