import * as React from 'react';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { sendEmail } from '../services/resend.service';
import { GoalMilestone } from '../templates/emails/milestone';

const MILESTONES = [25, 50, 75, 100] as const;

/**
 * Runs daily at 6 AM PT.
 * Checks every user's goal progress and fires a milestone email
 * the first time they cross each threshold (25 / 50 / 75 / 100 %).
 * Uses the notifications table as a dedupe ledger so each milestone
 * fires exactly once.
 */
export async function processMilestones(): Promise<void> {
  logger.info('milestone_job_started');
  try {
    // Only users who have a goal set
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, email, goal_hours, goal_program')
      .not('goal_hours', 'is', null)
      .gt('goal_hours', 0)
      .is('deleted_at', null)
      .is('deletion_scheduled_for', null);

    const userList = (users as any[]) ?? [];
    let fired = 0;

    for (const user of userList) {
      try {
        // Total verified hours
        const { data: sessions } = await supabaseAdmin
          .from('sessions')
          .select('hours')
          .eq('user_id', user.id)
          .eq('status', 'verified')
          .is('deleted_at', null);

        const totalHours = ((sessions as any[]) ?? []).reduce(
          (s: number, r: any) => s + Number(r.hours),
          0,
        );

        const goalHours = Number(user.goal_hours);
        const pct = (totalHours / goalHours) * 100;

        for (const threshold of MILESTONES) {
          if (pct < threshold) continue;

          // Has this milestone notification already been sent?
          const notifType = `milestone_${threshold}`;
          const { count } = await supabaseAdmin
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('type', notifType);

          if ((count ?? 0) > 0) continue; // already fired

          // Create the notification record (dedupe anchor)
          await supabaseAdmin.from('notifications').insert({
            user_id: user.id,
            type: notifType,
            title: `${threshold}% goal reached!`,
            body: `You've logged ${Math.round(totalHours * 10) / 10} of ${goalHours} hours.`,
          });

          // Send email
          await sendEmail({
            to: user.email,
            subject: `You've reached ${threshold}% of your ${user.goal_program ?? 'goal'}`,
            react: React.createElement(GoalMilestone, {
              name: user.name,
              milestone: threshold,
              totalHours: Math.round(totalHours * 10) / 10,
              goalHours,
              goalProgram: user.goal_program ?? 'Community Service',
            }),
          });

          fired++;
          logger.info({ userId: user.id, threshold }, 'milestone_email_sent');
        }
      } catch (err) {
        logger.error({ err, userId: user.id }, 'milestone_user_failed');
      }
    }

    logger.info({ fired, total: userList.length }, 'milestone_job_completed');
  } catch (err) {
    logger.error({ err }, 'milestone_job_failed');
    throw err;
  }
}
