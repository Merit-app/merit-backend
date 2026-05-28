import * as React from 'react';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { sendEmail } from '../services/resend.service';
import { WeeklyDigest } from '../templates/emails/weekly-digest';

export async function sendWeeklyDigest(): Promise<void> {
  logger.info('weekly_digest_started');
  try {
    // Get all active users (weekly digest is a service email, not marketing — no consent gate)
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, email, goal_hours, goal_program')
      .is('deleted_at', null)
      .is('deletion_scheduled_for', null);

    const userList = (users as any[]) ?? [];

    const weekAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    let sent = 0;
    let skipped = 0;

    for (const user of userList) {
      try {
        // Last week's sessions
        const { data: weekSessions } = await supabaseAdmin
          .from('sessions')
          .select('hours, status')
          .eq('user_id', user.id)
          .gte('date', weekAgoStr)
          .is('deleted_at', null);

        const weekList = (weekSessions as any[]) ?? [];
        if (weekList.length === 0) {
          skipped++;
          continue;
        }

        const hoursThisWeek = weekList.reduce((s: number, r: any) => s + Number(r.hours), 0);

        // All-time verified hours for goal progress
        const { data: allVerified } = await supabaseAdmin
          .from('sessions')
          .select('hours')
          .eq('user_id', user.id)
          .eq('status', 'verified')
          .is('deleted_at', null);

        const totalHours = ((allVerified as any[]) ?? []).reduce(
          (s: number, r: any) => s + Number(r.hours),
          0,
        );

        const goalHours = Number(user.goal_hours ?? 0);
        const percentToGoal =
          goalHours > 0 ? Math.min(100, Math.round((totalHours / goalHours) * 100)) : 0;

        await sendEmail({
          to: user.email,
          subject: 'Your week in service — Merit',
          react: React.createElement(WeeklyDigest, {
            name: user.name,
            hoursThisWeek: Math.round(hoursThisWeek * 10) / 10,
            sessionsThisWeek: weekList.length,
            totalHours: Math.round(totalHours * 10) / 10,
            goalHours,
            goalProgram: user.goal_program ?? 'Community Service',
            percentToGoal,
          }),
        });

        sent++;
      } catch (err) {
        logger.error({ err, userId: user.id }, 'weekly_digest_user_failed');
      }
    }

    logger.info({ sent, skipped, total: userList.length }, 'weekly_digest_completed');
  } catch (err) {
    logger.error({ err }, 'weekly_digest_failed');
    throw err;
  }
}
