import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validateUuidParam } from '../middleware/validate-uuid.middleware';
import * as scholarshipsService from '../services/scholarships.service';
import { syncScholarshipFeeds } from '../services/scholarships-sync.service';
import { success } from '../utils/shape';
import { logger } from '../lib/logger';
import { safeSecretEqual } from '../lib/crypto';

const router = Router();

// ── POST /scholarships/sync — manual RSS sync trigger (admin only) ────────────
// Protected by a static sync secret so it can be called from Railway cron or
// a webhook without exposing it to regular users.
router.post('/scholarships/sync', async (req: Request, res: Response) => {
  // Fail closed: if SYNC_SECRET is not configured, the endpoint is disabled
  // entirely rather than left open to anonymous callers.
  if (!process.env.SYNC_SECRET || !safeSecretEqual(req.headers['x-sync-secret'], process.env.SYNC_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Run in background — respond immediately
  syncScholarshipFeeds()
    .then((r) => logger.info(r, 'manual_scholarship_sync_done'))
    .catch((e) => logger.warn({ err: e }, 'manual_scholarship_sync_error'));
  return res.json(success({ message: 'Sync started in background' }));
});

// ── GET /scholarships — list / search all ──────────────────────────────────────
router.get('/scholarships', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Coerce to a single string (ignore array/object query injection) and clamp numerics.
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length ? v.slice(0, 200) : undefined;
    const clampNum = (v: unknown, def: number, min: number, max: number): number => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.min(Math.max(Math.trunc(n), min), max);
    };

    const search = str(req.query.search);

    const scholarships = await scholarshipsService.listScholarships({
      search,
      category: str(req.query.category),
      location: str(req.query.location),
      limit:    clampNum(req.query.limit, 30, 1, 100),
      offset:   clampNum(req.query.offset, 0, 0, 100000),
    });

    // Kick off RapidAPI background refresh — non-blocking, fails silently
    scholarshipsService
      .fetchAndCacheFromRapidAPI(search)
      .catch(() => { /* swallowed — background task */ });

    // Also return saved IDs so the client can highlight bookmarked cards
    const savedIds = await scholarshipsService.getSavedIds(req.user!.id);

    res.json(success({ scholarships, savedIds }));
  } catch (err) {
    next(err);
  }
});

// ── GET /scholarships/for-me — personalized recommendations ───────────────────
router.get('/scholarships/for-me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await scholarshipsService.getScholarshipsForUser(req.user!.id);
    const savedIds = await scholarshipsService.getSavedIds(req.user!.id);
    res.json(success({ ...result, savedIds }));
  } catch (err) {
    next(err);
  }
});

// ── GET /scholarships/saved — student's saved list ────────────────────────────
router.get('/scholarships/saved', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scholarships = await scholarshipsService.getSavedScholarships(req.user!.id);
    res.json(success({ scholarships }));
  } catch (err) {
    next(err);
  }
});

// ── POST /scholarships/:id/save — toggle bookmark ─────────────────────────────
router.post(
  '/scholarships/:id/save',
  requireAuth,
  validateUuidParam('id'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await scholarshipsService.toggleSavedScholarship(
        req.user!.id,
        req.params.id as string,
      );
      res.json(success(result));
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /scholarships/:id — single scholarship ────────────────────────────────
// Must come AFTER the named routes above so '/for-me' isn't caught as a UUID
router.get(
  '/scholarships/:id',
  requireAuth,
  validateUuidParam('id'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scholarship = await scholarshipsService.getScholarship(req.params.id as string);
      if (!scholarship) return res.status(404).json({ error: 'Scholarship not found' });

      const savedIds = await scholarshipsService.getSavedIds(req.user!.id);
      const isSaved = savedIds.includes(req.params.id as string);

      res.json(success({ scholarship, isSaved }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
