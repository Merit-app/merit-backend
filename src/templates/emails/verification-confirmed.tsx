import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface VerificationConfirmedEmailProps {
  studentName: string;
  supervisorName: string;
  hours: number;
  orgName: string;
  tier: string;
  sessionUrl: string;
}

const badge: Record<string, { label: string; color: string }> = {
  verified_institutional: { label: 'Institutionally Verified', color: '#16a34a' },
  verified_basic: { label: 'Verified', color: '#2563eb' },
};

export function VerificationConfirmedEmail({
  studentName,
  supervisorName,
  hours,
  orgName,
  tier,
  sessionUrl,
}: VerificationConfirmedEmailProps) {
  const b = badge[tier] ?? badge.verified_basic;

  return (
    <BaseLayout preview={`Your ${hours} hours at ${orgName} have been verified`}>
      <Text style={styles.h1}>Hours verified!</Text>
      <Text style={styles.p}>Hi {studentName},</Text>
      <Text style={styles.p}>
        <strong>{supervisorName}</strong> verified your <strong>{hours} hours</strong> at{' '}
        <strong>{orgName}</strong>.
      </Text>
      <Text
        style={{
          display: 'inline-block',
          backgroundColor: b.color,
          color: '#fff',
          padding: '4px 12px',
          borderRadius: '999px',
          fontSize: '13px',
          fontWeight: '600',
          margin: '0 0 24px',
        }}
      >
        {b.label}
      </Text>
      <Section style={{ margin: '8px 0 24px' }}>
        <Link href={sessionUrl} style={styles.btn}>
          View session
        </Link>
      </Section>
    </BaseLayout>
  );
}

export default VerificationConfirmedEmail;
