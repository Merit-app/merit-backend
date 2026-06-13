import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.middleware';
import { ipRateLimit } from '../middleware/rate-limit.middleware';
import { z } from 'zod';
import * as magicLinkService from '../services/magic-link.service';
import { success } from '../utils/shape';

const router = Router();

const supervisorLoginSchema = z.object({
  email: z.string().email(),
});

const verifySchema = z.object({
  token: z.string().min(1),
  response: z.enum(['YES', 'NO', 'STOP']).optional().default('YES'),
});

// POST /magic/supervisor-login — send magic link to supervisor
router.post(
  '/magic/supervisor-login',
  ipRateLimit('magic_link', 5, 1), // anti-abuse: max 5 magic-link emails per IP per hour
  validate(supervisorLoginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await magicLinkService.sendSupervisorMagicLink(req.body.email);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /magic/verify?token=...&response=YES|NO|STOP
router.get(
  '/magic/verify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = verifySchema.parse({ token: req.query.token, response: req.query.response });
      const result = await magicLinkService.verifySupervisorToken(parsed.token, parsed.response);
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
