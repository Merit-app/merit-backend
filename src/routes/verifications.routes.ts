import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { validateUuidParam } from '../middleware/validate-uuid.middleware';
import { confirmMagicLinkSchema } from '../schemas/verifications.schema';
import * as verificationsService from '../services/verifications.service';
import { success } from '../utils/shape';

const router = Router();

// GET /verifications/lookup?token=…  (public — powers the confirm page)
// MUST be registered before GET /verifications/:sessionId, otherwise the literal
// "lookup" path is captured by the :sessionId param route (which requires auth).
router.get(
  '/verifications/lookup',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) {
        res.status(400).json({ error: 'Missing token' });
        return;
      }
      const result = await verificationsService.getVerificationByToken(token);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /verifications/:sessionId
router.get(
  '/verifications/:sessionId',
  requireAuth,
  validateUuidParam('sessionId'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const verifications = await verificationsService.getSessionVerifications(
        req.params.sessionId as string,
        req.user!.id,
      );
      res.json(success(verifications));
    } catch (err) {
      next(err);
    }
  },
);

// POST /verifications/confirm-magic-link
router.post(
  '/verifications/confirm-magic-link',
  validate(confirmMagicLinkSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verificationsService.processVerificationResponse({
        token: req.body.token,
        response: req.body.response ?? 'YES',
      });
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
