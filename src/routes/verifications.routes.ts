import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { confirmMagicLinkSchema } from '../schemas/verifications.schema';
import * as verificationsService from '../services/verifications.service';
import { success } from '../utils/shape';

const router = Router();

// GET /verifications/:sessionId
router.get(
  '/verifications/:sessionId',
  requireAuth,
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
