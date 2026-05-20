import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { z } from 'zod';
import * as notificationsService from '../services/notifications.service';
import { success, paginated } from '../utils/shape';

const router = Router();

router.use('/notifications', requireAuth);

// GET /notifications?unreadOnly=true&page=1&perPage=20
router.get('/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = z
      .object({
        unreadOnly: z.coerce.boolean().optional().default(false),
        page: z.coerce.number().int().min(1).default(1),
        perPage: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);

    const result = await notificationsService.getNotifications(req.user!.id, query);
    res.json(paginated(result.notifications, result.meta));
  } catch (err) {
    next(err);
  }
});

// GET /notifications/unread-count
router.get('/notifications/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await notificationsService.getUnreadCount(req.user!.id);
    res.json(success({ count }));
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/read-all
router.patch('/notifications/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await notificationsService.markAllRead(req.user!.id);
    res.json(success({ updated: true }));
  } catch (err) {
    next(err);
  }
});

// DELETE /notifications/read — clear all read notifications
router.delete('/notifications/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await notificationsService.deleteAllRead(req.user!.id);
    res.json(success({ deleted: true }));
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/:id/read
router.patch(
  '/notifications/:id/read',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notificationsService.markRead(req.params.id as string, req.user!.id);
      res.json(success({ updated: true }));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /notifications/:id
router.delete(
  '/notifications/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notificationsService.deleteNotification(req.params.id as string, req.user!.id);
      res.json(success({ deleted: true }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
