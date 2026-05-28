import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface WeeklyDigestProps {
  name: string;
  hoursThisWeek: number;
  sessionsThisWeek: number;
  totalHours: number;
  goalHours: number;
  goalProgram: string;
  percentToGoal: number;
}

export function WeeklyDigest({
  name,
  hoursThisWeek,
  sessionsThisWeek,
  totalHours,
  goalHours,
  goalProgram,
  percentToGoal,
}: WeeklyDigestProps) {
  const hoursLeft = Math.max(0, goalHours - totalHours);

  return (
    <BaseLayout preview={`Your week in service — ${hoursThisWeek}h logged`}>
      <Text style={styles.h1}>Your week in service</Text>
      <Text style={styles.p}>Hi {name},</Text>
      <Text style={styles.p}>
        Last week you logged <strong>{hoursThisWeek} hours</strong> across{' '}
        {sessionsThisWeek} session{sessionsThisWeek !== 1 ? 's' : ''}.
      </Text>
      <Text style={styles.p}>
        You're at <strong>{totalHours} / {goalHours} hours</strong> toward your{' '}
        {goalProgram} goal — <strong>{percentToGoal}%</strong>.
      </Text>
      {percentToGoal >= 100 ? (
        <Text style={{ ...styles.p, color: '#16a34a', fontWeight: '600' }}>
          You hit your goal. Nice work.
        </Text>
      ) : (
        <Text style={styles.p}>{Math.round(hoursLeft * 10) / 10} hours to go.</Text>
      )}
      <Section style={{ margin: '24px 0' }}>
        <Link href="https://merit.app/dashboard" style={styles.btn}>
          View dashboard
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        You're receiving this because you have an active Merit account.{' '}
        <Link href="https://merit.app/settings">Manage email preferences</Link>
      </Text>
    </BaseLayout>
  );
}

export default WeeklyDigest;
