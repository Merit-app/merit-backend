import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { optionalAuth } from '../middleware/auth.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { success } from '../utils/shape';
import { logger } from '../lib/logger';
import { supabaseAdmin } from '../config/supabase';
import * as leaderboardService from '../services/leaderboard.service';

const router = Router();

// ─── Main leaderboard ─────────────────────────────────────────────────────────

// GET /leaderboard — public with optional auth (shows own rank when logged in)
router.get(
  '/leaderboard',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        type: z.enum(['global', 'local', 'school']).default('global'),
        period: z.enum(['all', 'month', 'week']).default('all'),
        school: z.string().optional(),
        city: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).default(50),
        offset: z.coerce.number().min(0).default(0),
      });

      const params = schema.parse(req.query);

      const result = await leaderboardService.getLeaderboard({
        type: params.type,
        period: params.period,
        currentUserId: req.user?.id,
        school: params.school,
        city: params.city,
        limit: params.limit,
        offset: params.offset,
      });

      res.json(success(result));
    } catch (err) {
      logger.error(err, 'leaderboard_fetch_error');
      next(err);
    }
  },
);

// GET /leaderboard/u/:username — public personal stats card
// Must be registered BEFORE /:groupId
router.get(
  '/leaderboard/u/:username',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username } = req.params as { username: string };
      const stats = await leaderboardService.getUserLeaderboardStats(username);

      if (!stats) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (stats.user.isPrivate) {
        return res.json(
          success({
            user: { username: stats.user.username, isPrivate: true },
            stats: null,
            badges: [],
            topOrgs: [],
          }),
        );
      }

      res.json(success(stats));
    } catch (err) {
      logger.error(err, 'personal_leaderboard_stats_error');
      next(err);
    }
  },
);

// ─── Leaderboard groups ───────────────────────────────────────────────────────

// POST /leaderboard/groups — create a private group
router.post(
  '/leaderboard/groups',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(100),
        type: z.enum(['school', 'custom']).default('custom'),
        isPrivate: z.boolean().default(true),
      });

      const body = schema.parse(req.body);
      const userId = req.user!.id;

      // Generate a short readable invite code
      const code = nanoid(8).toUpperCase();

      const { data: group, error: insertErr } = await supabaseAdmin
        .from('leaderboard_groups')
        .insert({
          name: body.name,
          type: body.type,
          code,
          created_by: userId,
          is_private: body.isPrivate,
        })
        .select('id, name, code, type, created_at')
        .single();

      if (insertErr || !group) {
        logger.error(insertErr, 'leaderboard_group_create_error');
        return res.status(500).json({ error: 'Failed to create group' });
      }

      // Auto-join creator as admin
      await supabaseAdmin.from('leaderboard_group_members').insert({
        group_id: (group as any).id,
        user_id: userId,
        role: 'admin',
      });

      res.status(201).json(success(group));
    } catch (err) {
      logger.error(err, 'leaderboard_group_create_error');
      next(err);
    }
  },
);

// POST /leaderboard/groups/join — join by invite code
router.post(
  '/leaderboard/groups/join',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = z.object({ code: z.string().min(1) }).parse(req.body);
      const userId = req.user!.id;

      const { data: group } = await supabaseAdmin
        .from('leaderboard_groups')
        .select('id, name, code, type')
        .eq('code', code.toUpperCase())
        .maybeSingle();

      if (!group) {
        return res.status(404).json({ error: 'Invalid invite code' });
      }

      // Check if already a member
      const { data: existing } = await supabaseAdmin
        .from('leaderboard_group_members')
        .select('id')
        .eq('group_id', (group as any).id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        return res.json(success({ group, alreadyMember: true }));
      }

      await supabaseAdmin.from('leaderboard_group_members').insert({
        group_id: (group as any).id,
        user_id: userId,
        role: 'member',
      });

      res.json(success({ group, alreadyMember: false }));
    } catch (err) {
      logger.error(err, 'leaderboard_group_join_error');
      next(err);
    }
  },
);

// GET /leaderboard/groups/mine — list groups the current user belongs to
router.get(
  '/leaderboard/groups/mine',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;

      const { data: memberships } = await supabaseAdmin
        .from('leaderboard_group_members')
        .select('role, leaderboard_groups(id, name, code, type, created_at)')
        .eq('user_id', userId);

      const groups = (memberships ?? []).map((m: any) => ({
        ...m.leaderboard_groups,
        role: m.role,
      }));

      res.json(success({ groups }));
    } catch (err) {
      logger.error(err, 'leaderboard_groups_mine_error');
      next(err);
    }
  },
);

// GET /leaderboard/groups/:groupId — ranked group leaderboard
router.get(
  '/leaderboard/groups/:groupId',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { groupId } = req.params as { groupId: string };

      // Get group info
      const { data: group } = await supabaseAdmin
        .from('leaderboard_groups')
        .select('id, name, code, type, is_private')
        .eq('id', groupId)
        .maybeSingle();

      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      // If private, verify the requester is a member
      if ((group as any).is_private) {
        if (!req.user?.id) {
          return res.status(403).json({
            error: 'This is a private group. Sign in to access it.',
          });
        }
        const { data: membership } = await supabaseAdmin
          .from('leaderboard_group_members')
          .select('id')
          .eq('group_id', groupId)
          .eq('user_id', req.user.id)
          .maybeSingle();
        if (!membership) {
          return res.status(403).json({
            error: 'You are not a member of this group.',
          });
        }
      }

      // Get members with user info
      const { data: members } = await supabaseAdmin
        .from('leaderboard_group_members')
        .select('user_id, role')
        .eq('group_id', groupId);

      if (!members?.length) {
        return res.json(success({ group, entries: [], totalParticipants: 0 }));
      }

      const userIds = members.map((m: any) => m.user_id as string);

      // Get user details
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, name, username, avatar_url, school, profile_public')
        .in('id', userIds)
        .is('deleted_at', null);

      // Get verified hours for group members
      const { data: sessions } = await supabaseAdmin
        .from('sessions')
        .select('user_id, hours')
        .in('user_id', userIds)
        .eq('status', 'verified')
        .is('deleted_at', null);

      // Aggregate hours
      const hoursMap = new Map<string, number>();
      for (const s of sessions ?? []) {
        const uid = (s as any).user_id as string;
        hoursMap.set(uid, (hoursMap.get(uid) ?? 0) + ((s as any).hours ?? 0));
      }

      const userMap = new Map<string, any>();
      for (const u of users ?? []) {
        userMap.set((u as any).id as string, u);
      }

      // Build ranked entries
      const entries = members
        .map((m: any) => {
          const u = userMap.get(m.user_id as string);
          const isPrivate = !(u?.profile_public ?? true);
          return {
            userId: isPrivate ? null : (m.user_id as string),
            name: isPrivate ? 'Anonymous Student' : ((u?.name as string) ?? 'Student'),
            username: isPrivate ? null : ((u?.username as string | null) ?? null),
            avatarUrl: isPrivate ? null : ((u?.avatar_url as string | null) ?? null),
            school: isPrivate ? null : ((u?.school as string | null) ?? null),
            verifiedHours: hoursMap.get(m.user_id as string) ?? 0,
            isCurrentUser: (m.user_id as string) === req.user?.id,
            isPrivate,
          };
        })
        .sort((a: any, b: any) => b.verifiedHours - a.verifiedHours)
        .map((e: any, i: number) => ({ ...e, rank: i + 1, badges: [], sessionCount: 0 }));

      res.json(success({ group, entries, totalParticipants: entries.length }));
    } catch (err) {
      logger.error(err, 'leaderboard_group_get_error');
      next(err);
    }
  },
);

export default router;
