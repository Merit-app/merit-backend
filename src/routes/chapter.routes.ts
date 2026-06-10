import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { validateUuidParam } from '../middleware/validate-uuid.middleware';
import * as chapter from '../services/chapter.service';
import { success } from '../utils/shape';

const router = Router();

// All chapter-platform routes require an authenticated coordinator. The service
// layer enforces that the caller actually coordinates the chapter.
router.use('/chapter', requireAuth);

// GET /chapter/overview
router.get('/chapter/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.getOverview(req.user!.id)));
  } catch (err) { next(err); }
});

// GET /chapter/roster?search=&filter=
router.get('/chapter/roster', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    res.json(success(await chapter.getRoster(req.user!.id, { search, filter })));
  } catch (err) { next(err); }
});

// GET /chapter/cohort-goals
router.get('/chapter/cohort-goals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.listCohortGoals(req.user!.id)));
  } catch (err) { next(err); }
});

// PUT /chapter/cohort-goals
const cohortGoalSchema = z.object({
  graduationYear: z.number().int().min(1900).max(2100),
  requiredHours: z.number().int().min(0).max(10000),
});
router.put('/chapter/cohort-goals', validate(cohortGoalSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.setCohortGoal(req.user!.id, req.body.graduationYear, req.body.requiredHours)));
  } catch (err) { next(err); }
});

// PATCH /chapter/settings
const settingsSchema = z.object({
  requiredHours: z.number().int().min(0).max(10000).optional(),
  requirementDeadline: z.string().date().nullable().optional(),
  riskWindowDays: z.number().int().min(1).max(365).optional(),
});
router.patch('/chapter/settings', validate(settingsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.updateSettings(req.user!.id, req.body)));
  } catch (err) { next(err); }
});

// GET /chapter/students/:studentId
router.get('/chapter/students/:studentId', validateUuidParam('studentId'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.getStudentDetail(req.user!.id, req.params.studentId as string)));
  } catch (err) { next(err); }
});

// PATCH /chapter/students/:studentId/goal  { hours: number | null }
const overrideSchema = z.object({ hours: z.number().int().min(0).max(10000).nullable() });
router.patch('/chapter/students/:studentId/goal', validateUuidParam('studentId'), validate(overrideSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.setStudentOverride(req.user!.id, req.params.studentId as string, req.body.hours)));
  } catch (err) { next(err); }
});

// POST /chapter/students/:studentId/adjust  { hours: number, reason?: string }
const adjustSchema = z.object({
  hours: z.number().refine((n) => n !== 0, 'Hours must be non-zero').refine((n) => Math.abs(n) <= 10000, 'Too large'),
  reason: z.string().max(300).optional(),
});
router.post('/chapter/students/:studentId/adjust', validateUuidParam('studentId'), validate(adjustSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.adjustHours(req.user!.id, req.params.studentId as string, req.body.hours, req.body.reason)));
  } catch (err) { next(err); }
});

export default router;
