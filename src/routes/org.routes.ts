import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOrgPlan } from '../middleware/require-org-plan';
import * as eventsService from '../services/org-events.service';
import * as reportsService from '../services/org-reports.service';
import * as messagesService from '../services/org-messages.service';
import * as invitesService from '../services/org-invites.service';
import * as scholarshipsService from '../services/scholarships.service';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';

const router = Router();

// ── Helper: ensure caller is an org admin ─────────────────────────────────────
async function requireOrgAdmin(orgId: string, userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('org_admins')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();

  if (!data) throw new Error('NOT_ADMIN');
  return data.role as string;
}

function handleNotAdmin(err: any, res: Response): boolean {
  if (err.message === 'NOT_ADMIN') {
    res.status(403).json({ error: 'Not authorized' });
    return true;
  }
  return false;
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

// GET /org/:orgId/events
router.get('/:orgId/events', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const { status, upcoming } = req.query;
    const events = await eventsService.listOrgEvents({
      orgId: req.params.orgId as string,
      status: status as string | undefined,
      upcoming: upcoming === 'true',
    });
    return res.json({ data: events });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'list_events_error');
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// POST /org/:orgId/events
router.post('/:orgId/events', requireAuth, requireOrgPlan('pro'), async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);

    const schema = z.object({
      title: z.string().min(2).max(100),
      description: z.string().max(500).optional(),
      location: z.string().max(200).optional(),
      locationUrl: z.string().url().optional().or(z.literal('')),
      program: z.string().max(100).optional(),
      startTime: z.string().datetime(),
      endTime: z.string().datetime(),
      maxVolunteers: z.number().int().positive().optional(),
      hoursValue: z.number().positive().optional(),
      autoLogHours: z.boolean().default(true),
      timezone: z.string().max(64).optional(),
    });

    const body = schema.parse(req.body);
    const event = await eventsService.createOrgEvent({
      ...body,
      orgId: req.params.orgId as string,
      createdBy: req.user!.id,
    });
    return res.status(201).json({ data: event });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Invalid input', details: err.errors });
    }
    logger.error(err, 'create_event_error');
    return res.status(500).json({ error: err.message ?? 'Failed to create event' });
  }
});

// PATCH /org/:orgId/events/:eventId — edit an event (draft or published)
router.patch('/:orgId/events/:eventId', requireAuth, requireOrgPlan('pro'), async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);

    const schema = z.object({
      title: z.string().min(2).max(100).optional(),
      description: z.string().max(500).optional(),
      location: z.string().max(200).optional(),
      locationUrl: z.string().url().optional().or(z.literal('')),
      program: z.string().max(100).optional(),
      startTime: z.string().datetime().optional(),
      endTime: z.string().datetime().optional(),
      maxVolunteers: z.number().int().positive().optional(),
      hoursValue: z.number().positive().optional(),
      autoLogHours: z.boolean().optional(),
      timezone: z.string().max(64).optional(),
    });

    const body = schema.parse(req.body);
    const event = await eventsService.updateOrgEvent({
      ...body,
      orgId: req.params.orgId as string,
      eventId: req.params.eventId as string,
    });
    return res.json({ data: event });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Event not found' });
    }
    logger.error(err, 'update_event_error');
    return res.status(500).json({ error: 'Failed to update event' });
  }
});

// GET /org/:orgId/events/:eventId
router.get('/:orgId/events/:eventId', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const event = await eventsService.getEventDetail(req.params.eventId as string);
    return res.json({ data: event });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'get_event_error');
    return res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// POST /org/:orgId/events/:eventId/publish
router.post('/:orgId/events/:eventId/publish', requireAuth, requireOrgPlan('pro'), async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const result = await eventsService.publishEvent(
      req.params.eventId as string,
      req.params.orgId as string,
    );
    return res.json({ data: result });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'publish_event_error');
    return res.status(500).json({ error: 'Failed to publish event' });
  }
});

// POST /org/:orgId/events/:eventId/checkin/:userId
router.post('/:orgId/events/:eventId/checkin/:userId', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const result = await eventsService.checkInVolunteer({
      eventId: req.params.eventId as string,
      userId: req.params.userId as string,
      checkedInBy: req.user!.id,
    });
    return res.json({ data: result });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'checkin_error');
    return res.status(500).json({ error: 'Failed to check in volunteer' });
  }
});

// POST /org/:orgId/events/:eventId/confirm  { userIds: string[] }
// Batch-confirm attendance + auto-log hours for the selected volunteers.
router.post('/:orgId/events/:eventId/confirm', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.filter((x: unknown) => typeof x === 'string') : [];
    const result = await eventsService.confirmAttendanceMany({
      eventId: req.params.eventId as string,
      orgId: req.params.orgId as string,
      userIds,
      confirmedBy: req.user!.id,
    });
    return res.json({ data: result });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'confirm_attendance_bulk_error');
    return res.status(500).json({ error: 'Failed to confirm attendance' });
  }
});

// POST /org/:orgId/events/:eventId/confirm/:userId
// Confirm one volunteer attended + auto-log their hours immediately.
router.post('/:orgId/events/:eventId/confirm/:userId', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const result = await eventsService.confirmAttendance({
      eventId: req.params.eventId as string,
      orgId: req.params.orgId as string,
      userId: req.params.userId as string,
      confirmedBy: req.user!.id,
    });
    return res.json({ data: result });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'confirm_attendance_error');
    return res.status(500).json({ error: 'Failed to confirm attendance' });
  }
});

// POST /org/:orgId/events/:eventId/complete
router.post('/:orgId/events/:eventId/complete', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const result = await eventsService.completeEvent(
      req.params.eventId as string,
      req.params.orgId as string,
    );
    return res.json({ data: result });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'complete_event_error');
    return res.status(500).json({ error: 'Failed to complete event' });
  }
});

// POST /org/:orgId/events/:eventId/signup  (student self-signup)
router.post('/:orgId/events/:eventId/signup', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const result = await eventsService.signupForEvent({
      eventId: req.params.eventId as string,
      userId: req.user!.id,
    });
    return res.status(201).json({ data: result });
  } catch (err: any) {
    logger.error(err, 'event_signup_error');
    return res.status(400).json({ error: err.message ?? 'Failed to sign up' });
  }
});

// ── REPORTS ───────────────────────────────────────────────────────────────────

// GET /org/:orgId/reports/grant   → PDF download
router.get('/:orgId/reports/grant', requireAuth, requireOrgPlan('pro'), async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);

    const schema = z.object({
      from: z.string().default(
        new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
      ),
      to: z.string().default(new Date().toISOString().split('T')[0]),
    });
    const { from, to } = schema.parse(req.query);

    const pdfBuffer = await reportsService.generateGrantReport({
      orgId: req.params.orgId as string,
      from,
      to,
    });

    const filename = `grant-report-${from}-to-${to}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'grant_report_error');
    return res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /org/:orgId/reports/impact  → JSON for dashboard charts
router.get('/:orgId/reports/impact', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);

    const { data: sessions } = await supabaseAdmin
      .from('sessions')
      .select('date, hours, activity, user_id, status')
      .eq('org_id', req.params.orgId as string)
      .eq('status', 'verified')
      .is('deleted_at', null)
      .order('date', { ascending: true });

    const allSessions: any[] = sessions ?? [];
    const totalHours = allSessions.reduce((sum, s) => sum + (s.hours ?? 0), 0);
    const uniqueVolunteers = new Set(allSessions.map((s) => s.user_id)).size;

    const monthlyMap = new Map<string, number>();
    for (const s of allSessions) {
      const month = (s.date as string).slice(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (s.hours ?? 0));
    }

    const monthly = Array.from(monthlyMap.entries())
      .map(([month, hours]) => ({ month, hours }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return res.json({
      data: { totalHours, totalSessions: allSessions.length, uniqueVolunteers, monthly },
    });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'impact_report_error');
    return res.status(500).json({ error: 'Failed to fetch impact data' });
  }
});

// ── CERTIFICATES ──────────────────────────────────────────────────────────────

// POST /org/:orgId/certificates
router.post('/:orgId/certificates', requireAuth, requireOrgPlan('pro'), async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);

    const schema = z.object({
      userId: z.string().uuid(),
      coordinatorName: z.string().min(2).max(100),
    });
    const { userId, coordinatorName } = schema.parse(req.body);

    const pdfBuffer = await reportsService.generateVolunteerCertificate({
      orgId: req.params.orgId as string,
      userId,
      coordinatorName,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="volunteer-certificate.pdf"');
    return res.send(pdfBuffer);
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    logger.error(err, 'certificate_error');
    return res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────

// POST /org/:orgId/messages
router.post('/:orgId/messages', requireAuth, requireOrgPlan('pro'), async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);

    const schema = z.object({
      message: z.string().min(1).max(300),
      filter: z.enum(['all', 'event', 'active_30d', 'active_90d']).default('all'),
      eventId: z.string().uuid().optional(),
    });
    const body = schema.parse(req.body);

    const result = await messagesService.sendBulkMessage({
      orgId: req.params.orgId as string,
      sentBy: req.user!.id,
      message: body.message,
      filter: body.filter,
      eventId: body.eventId,
    });

    return res.json({ data: result });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    logger.error(err, 'send_message_error');
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /org/:orgId/messages
router.get('/:orgId/messages', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const messages = await messagesService.getMessageHistory(req.params.orgId as string);
    return res.json({ data: messages });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    logger.error(err, 'get_messages_error');
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ── INVITES ───────────────────────────────────────────────────────────────────

// POST /org/:orgId/invites
router.post('/:orgId/invites', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);

    const schema = z.object({
      email: z.string().email(),
      role: z.enum(['coordinator', 'admin']).default('coordinator'),
    });
    const body = schema.parse(req.body);

    const result = await invitesService.createInvite({
      orgId: req.params.orgId as string,
      invitedBy: req.user!.id,
      email: body.email,
      role: body.role,
    });

    return res.status(201).json({ data: result });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    if (err.message === 'Already a team member') {
      return res.status(409).json({ error: err.message });
    }
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    logger.error(err, 'create_invite_error');
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

// GET /org/invites/:token  (public — no auth needed)
router.get('/invites/:token', async (req: Request, res: Response) => {
  try {
    const invite = await invitesService.getInviteByToken(req.params.token as string);
    if (!invite) {
      return res.status(404).json({ error: 'Invalid or expired invite' });
    }
    return res.json({ data: invite });
  } catch (err) {
    logger.error(err, 'get_invite_error');
    return res.status(500).json({ error: 'Failed to fetch invite' });
  }
});

// POST /org/invites/:token/accept
router.post('/invites/:token/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await invitesService.acceptInvite({
      token: req.params.token as string,
      userId: req.user!.id,
    });
    return res.json({ data: result });
  } catch (err: any) {
    if (['Invalid invite', 'Invite has expired', 'Already accepted'].includes(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error(err, 'accept_invite_error');
    return res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// ── ONBOARDING ────────────────────────────────────────────────────────────────

// GET /org/:orgId/onboarding
router.get('/:orgId/onboarding', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('org_admins')
      .select('onboarding_completed, onboarding_completed_at')
      .eq('org_id', req.params.orgId as string)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Not authorized' });

    return res.json({ data });
  } catch (err) {
    logger.error(err, 'get_onboarding_error');
    return res.status(500).json({ error: 'Failed to check onboarding' });
  }
});

// POST /org/:orgId/onboarding/complete
router.post('/:orgId/onboarding/complete', requireAuth, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const { error } = await supabaseAdmin
      .from('org_admins')
      .update({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq('org_id', req.params.orgId as string)
      .eq('user_id', req.user!.id);

    if (error) throw error;
    return res.json({ data: { completed: true } });
  } catch (err) {
    logger.error(err, 'complete_onboarding_error');
    return res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

// ── ORG SCHOLARSHIPS ──────────────────────────────────────────────────────────

// GET /org/:orgId/scholarships
router.get('/:orgId/scholarships', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    const scholarships = await scholarshipsService.listOrgScholarships(req.params.orgId as string);
    return res.json({ data: scholarships });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    next(err);
  }
});

// POST /org/:orgId/scholarships
router.post('/:orgId/scholarships', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Admin or owner required to post scholarships' });
    }
    // Get org name for provider field
    const { data: org } = await supabaseAdmin
      .from('organizations').select('name').eq('id', req.params.orgId).maybeSingle();

    const schema = z.object({
      title:        z.string().min(3).max(200),
      amount_label: z.string().max(100).optional(),
      deadline:     z.string().optional(),
      is_rolling:   z.boolean().optional().default(false),
      url:          z.string().url(),
      description:  z.string().max(2000).optional(),
      requirements: z.string().max(2000).optional(),
      eligibility:  z.string().max(1000).optional(),
      categories:   z.array(z.string()).min(1),
      renewable:    z.boolean().optional().default(false),
    });

    const body = schema.parse(req.body);
    const scholarship = await scholarshipsService.createOrgScholarship(
      req.params.orgId as string,
      (org as any)?.name ?? 'Organization',
      body,
    );
    return res.status(201).json({ data: scholarship });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    next(err);
  }
});

// DELETE /org/:orgId/scholarships/:scholarshipId
router.delete('/:orgId/scholarships/:scholarshipId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = await requireOrgAdmin(req.params.orgId as string, req.user!.id);
    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Admin or owner required' });
    }
    await scholarshipsService.deleteOrgScholarship(
      req.params.orgId as string,
      req.params.scholarshipId as string,
    );
    return res.json({ data: { deleted: true } });
  } catch (err: any) {
    if (handleNotAdmin(err, res)) return;
    next(err);
  }
});

export default router;
