import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface GoalMilestoneProps {
  name: string;
  milestone: 25 | 50 | 75 | 100;
  totalHours: number;
  goalHours: number;
  goalProgram: string;
}

const messages: Record<number, string> = {
  25: "You're a quarter of the way there.",
  50: "Halfway. You're crushing it.",
  75: 'Three-quarters done. The finish line is close.',
  100: 'You hit your goal.',
};

export function GoalMilestone({
  name,
  milestone,
  totalHours,
  goalHours,
  goalProgram,
}: GoalMilestoneProps) {
  return (
    <BaseLayout preview={`${milestone}% of your ${goalProgram} goal reached!`}>
      <Text style={styles.h1}>{messages[milestone]}</Text>
      <Text style={styles.p}>Hi {name},</Text>
      <Text style={styles.p}>
        You've logged <strong>{totalHours} hours</strong> toward your {goalProgram} goal of{' '}
        {goalHours}.
      </Text>
      {milestone === 100 ? (
        <Text style={{ ...styles.p, color: '#16a34a', fontWeight: '600' }}>
          Your hours are verified and ready to share. Well done.
        </Text>
      ) : (
        <Text style={styles.p}>
          Keep it up — {Math.round((goalHours - totalHours) * 10) / 10} hours left to go.
        </Text>
      )}
      <Section style={{ margin: '24px 0' }}>
        <Link href="https://merit.app/dashboard" style={styles.btn}>
          See your progress
        </Link>
      </Section>
    </BaseLayout>
  );
}

export default GoalMilestone;
