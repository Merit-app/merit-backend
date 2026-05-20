import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { z } from 'zod';
import * as billingService from '../services/billing.service';
import { success } from '../utils/shape';

const router = Router();

router.use('/billing', requireAuth);

const checkoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

// POST /billing/checkout
router.post(
  '/billing/checkout',
  validate(checkoutSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await billingService.createCheckoutSession(
        req.user!.id,
        req.body.priceId,
        req.body.successUrl,
        req.body.cancelUrl,
      );
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// POST /billing/portal
router.post('/billing/portal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await billingService.createPortalSession(req.user!.id, req.body?.returnUrl);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /billing/subscription
router.get('/billing/subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await billingService.getSubscription(req.user!.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// POST /billing/cancel
router.post('/billing/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await billingService.cancelSubscription(req.user!.id);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

export default router;
