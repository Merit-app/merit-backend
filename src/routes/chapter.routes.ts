import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { validateUuidParam } from '../middleware/validate-uuid.middleware';
import * as chapter from '../services/chapter.service';
import * as team from '../services/chapter-team.service';
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
  remindersEnabled: z.boolean().optional(),
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

// GET /my-chapter — student-facing view of their own chapter membership (or null)
router.get('/my-chapter', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.getMyChapter(req.user!.id)));
  } catch (err) { next(err); }
});

// POST /chapter/announcements  { title, body, audience }
const announcementSchema = z.object({
  title: z.string().min(1).max(140),
  body: z.string().min(1).max(1000),
  audience: z.enum(['all', 'incomplete', 'at_risk', 'met']).default('all'),
});
router.post('/chapter/announcements', validate(announcementSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.sendAnnouncement(req.user!.id, req.body)));
  } catch (err) { next(err); }
});

// POST /chapter/remind-behind
router.post('/chapter/remind-behind', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(success(await chapter.remindBehind(req.user!.id)));
  } catch (err) { next(err); }
});

// ── Team & roles ─────────────────────────────────────────────────────────────

// GET /chapter/me/permissions — the caller's own permissions (for UI gating)
router.get('/chapter/me/permissions', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(success(await team.getMyPermissions(req.user!.id))); } catch (err) { next(err); }
});

// GET /chapter/team
router.get('/chapter/team', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(success(await team.getTeam(req.user!.id))); } catch (err) { next(err); }
});

const addCoordSchema = z.object({ email: z.string().email(), roleId: z.string().uuid().nullable().optional() });
router.post('/chapter/team', validate(addCoordSchema), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(success(await team.addCoordinator(req.user!.id, req.body.email, req.body.roleId ?? null))); } catch (err) { next(err); }
});

const setRoleSchema = z.object({ roleId: z.string().uuid().nullable() });
router.patch('/chapter/team/:userId/role', validateUuidParam('userId'), validate(setRoleSchema), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(success(await team.setCoordinatorRole(req.user!.id, req.params.userId as string, req.body.roleId))); } catch (err) { next(err); }
});

router.delete('/chapter/team/:userId', validateUuidParam('userId'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(success(await team.removeCoordinator(req.user!.id, req.params.userId as string))); } catch (err) { next(err); }
});

// GET /chapter/roles
router.get('/chapter/roles', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(success(await team.listRoles(req.user!.id))); } catch (err) { next(err); }
});

const roleSchema = z.object({ name: z.string().min(1).max(60), permissions: z.array(z.string()).max(40) });
router.post('/chapter/roles', validate(roleSchema), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(success(await team.createRole(req.user!.id, req.body.name, req.body.permissions))); } catch (err) { next(err); }
});

const roleUpdateSchema = z.object({ name: z.string().min(1).max(60).optional(), permissions: z.array(z.string()).max(40).optional() });
router.patch('/chapter/roles/:roleId', validateUuidParam('roleId'), validate(roleUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(success(await team.updateRole(req.user!.id, req.params.roleId as string, req.body))); } catch (err) { next(err); }
});

router.delete('/chapter/roles/:roleId', validateUuidParam('roleId'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(success(await team.deleteRole(req.user!.id, req.params.roleId as string))); } catch (err) { next(err); }
});

export default router;
