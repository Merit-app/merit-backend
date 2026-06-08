import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { validateUuidParam } from '../middleware/validate-uuid.middleware';
import { createSessionSchema, updateSessionSchema, sessionQuerySchema } from '../schemas/sessions.schema';
import * as sessionsService from '../services/sessions.service';
import { success, paginated } from '../utils/shape';
import { logger } from '../lib/logger';

const router = Router();

// ─── Public verification endpoint — no auth, registered BEFORE requireAuth ──
// GET /sessions/verify/:sessionId
// Anyone with a session ID can look up verification status.
// Returns only non-sensitive fields (no user_id, email, phone).
router.get('/sessions/verify/:sessionId', validateUuidParam('sessionId'), async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const data = await sessionsService.getSessionForVerification(sessionId);
    if (!data) {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json({ data });
  } catch (err) {
    logger.error(err, 'verify_session_error');
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// GET /sessions/verify/org/:userId/:orgId — public org-level verification.
// Aggregates all of a student's hours at one org (powers the PDF QR code).
router.get(
  '/sessions/verify/org/:userId/:orgId',
  validateUuidParam('userId', 'orgId'),
  async (req: Request, res: Response) => {
    try {
      const data = await sessionsService.getOrgVerificationForUser(
        req.params.userId as string,
        req.params.orgId as string,
      );
      if (!data) return res.status(404).json({ error: 'No records found' });
      return res.json({ data });
    } catch (err) {
      logger.error(err, 'verify_org_error');
      return res.status(500).json({ error: 'Failed to fetch records' });
    }
  },
);

// Apply auth middleware to all other /sessions routes
router.use('/sessions', requireAuth);

// GET /sessions
router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = sessionQuerySchema.parse(req.query);
    const result = await sessionsService.getSessions(req.user!.id, filters);
    res.json(paginated(result.sessions, result.meta));
  } catch (err) {
    next(err);
  }
});

// GET /sessions/:id
router.get('/sessions/:id', validateUuidParam('id'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await sessionsService.getSession(req.params.id as string, req.user!.id);
    res.json(success({ session }));
  } catch (err) {
    next(err);
  }
});

// POST /sessions
router.post(
  '/sessions',
  validate(createSessionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await sessionsService.createSession(req.user!.id, req.body, req.user!.plan, req.user!.name);
      res.status(201).json(success({ session }));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /sessions/:id
router.patch(
  '/sessions/:id',
  validateUuidParam('id'),
  validate(updateSessionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await sessionsService.updateSession(req.params.id as string, req.user!.id, req.body);
      res.json(success({ session }));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /sessions/bulk — soft-delete up to 50 sessions in one call
router.delete('/sessions/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(req.body);
    const result = await sessionsService.bulkDeleteSessions(ids, req.user!.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// DELETE /sessions/:id
router.delete('/sessions/:id', validateUuidParam('id'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await sessionsService.deleteSession(req.params.id as string, req.user!.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /sessions/:id/resend-verification
router.post(
  '/sessions/:id/resend-verification',
  validateUuidParam('id'),
  rateLimit('resend_verification', { max: 10 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await sessionsService.resendVerification(req.params.id as string, req.user!.id, req.user!.plan);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
