import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import * as eventsService from '../services/org-events.service';
import { success } from '../utils/shape';

const router = Router();

// GET /events/:eventId — student-facing event detail (for the participate page).
// Only needs the event id; resolves the org itself.
router.get('/events/:eventId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await eventsService.getStudentEvent(
      req.params.eventId as string,
      req.user!.id,
    );
    return res.json(success(event));
  } catch (err) {
    next(err);
  }
});

// POST /events/:eventId/signup — student self-signup by event id.
router.post('/events/:eventId/signup', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const result = await eventsService.signupForEvent({
      eventId: req.params.eventId as string,
      userId: req.user!.id,
    });
    return res.json(success(result));
  } catch (err: any) {
    return res.status(400).json({ error: err.message ?? 'Failed to sign up' });
  }
});

export default router;
