import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';

export async function calculateFraudScore(session: {
  user_id: string;
  org_id: string;
  date: string;
  hours: number;
  supervisor_phone?: string;
  supervisor_email?: string;
}): Promise<{ score: number; flags: string[] }> {
  const flags: string[] = [];
  let score = 0;

  // 1. Velocity: too many sessions in one day
  const { count: sameDay } = await supabaseAdmin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.user_id)
    .eq('date', session.date)
    .is('deleted_at', null);

  if ((sameDay ?? 0) >= 3) {
    flags.push('velocity_same_day');
    score += 0.2;
  }

  // 2. Total hours that day exceed reasonable (>16h)
  const { data: dayHours } = await supabaseAdmin
    .from('sessions')
    .select('hours')
    .eq('user_id', session.user_id)
    .eq('date', session.date)
    .is('deleted_at', null);

  const totalDayHours =
    (dayHours ?? []).reduce((sum: number, s: any) => sum + Number(s.hours), 0) + session.hours;
  if (totalDayHours > 16) {
    flags.push('impossible_hours');
    score += 0.4;
  }

  // 3. Same supervisor across many unrelated orgs
  if (session.supervisor_phone) {
    const { data: supervisorSessions } = await supabaseAdmin
      .from('sessions')
      .select('org_id')
      .eq('user_id', session.user_id)
      .eq('supervisor_phone', session.supervisor_phone)
      .is('deleted_at', null);

    const uniqueOrgs = new Set((supervisorSessions ?? []).map((s: any) => s.org_id));
    if (uniqueOrgs.size > 3) {
      flags.push('supervisor_too_many_orgs');
      score += 0.2;
    }
  }

  // 4. Future-dated session
  const sessionDate = new Date(session.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (sessionDate > today) {
    flags.push('future_date');
    score += 0.5;
  }

  // 5. Very old session (>1 year)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  if (sessionDate < oneYearAgo) {
    flags.push('very_old_session');
    score += 0.1;
  }

  // 6. Always round numbers (weak signal)
  if (Number(session.hours) % 1 === 0 && Number(session.hours) >= 6) {
    const { data: recentSessions } = await supabaseAdmin
      .from('sessions')
      .select('hours')
      .eq('user_id', session.user_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10);

    const allRound = (recentSessions ?? []).every((s: any) => Number(s.hours) % 1 === 0);
    if (allRound && (recentSessions ?? []).length >= 5) {
      flags.push('always_round_numbers');
      score += 0.05;
    }
  }

  const finalScore = Math.min(1.0, score);
  if (finalScore > 0) {
    logger.info({ userId: session.user_id, score: finalScore, flags }, 'fraud_score_calculated');
  }

  return { score: finalScore, flags };
}

export async function runDailyFraudScan() {
  // Find recent sessions with no fraud review that have moderate scores
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('id, user_id, org_id, date, hours, supervisor_phone, supervisor_email, fraud_score, fraud_flags')
    .is('deleted_at', null)
    .eq('manually_reviewed', false)
    .gte('fraud_score', 0.3)
    .order('fraud_score', { ascending: false })
    .limit(100);

  if (!sessions?.length) return;

  logger.info({ count: sessions.length }, 'fraud_scan_sessions_flagged');

  // Re-score each session with fresh data (scores can change as more data comes in)
  for (const session of sessions) {
    const { score, flags } = await calculateFraudScore({
      user_id: session.user_id,
      org_id: session.org_id,
      date: session.date,
      hours: Number(session.hours),
      supervisor_phone: session.supervisor_phone,
      supervisor_email: session.supervisor_email,
    });

    if (score !== session.fraud_score || JSON.stringify(flags) !== JSON.stringify(session.fraud_flags)) {
      await supabaseAdmin
        .from('sessions')
        .update({ fraud_score: score, fraud_flags: flags })
        .eq('id', session.id);
    }
  }
}
