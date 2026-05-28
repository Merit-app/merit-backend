import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface VerificationDisputedEmailProps {
  studentName: string;
  supervisorName: string;
  hours: number;
  orgName: string;
  sessionUrl: string;
}

export function VerificationDisputedEmail({
  studentName,
  supervisorName,
  hours,
  orgName,
  sessionUrl,
}: VerificationDisputedEmailProps) {
  return (
    <BaseLayout preview={`Your hours at ${orgName} were disputed`}>
      <Text style={styles.h1}>Hours disputed</Text>
      <Text style={styles.p}>Hi {studentName},</Text>
      <Text style={styles.p}>
        <strong>{supervisorName}</strong> disputed your <strong>{hours} hours</strong> at{' '}
        <strong>{orgName}</strong>. This session has been marked as disputed.
      </Text>
      <Text style={styles.p}>
        If you believe this is an error, please reach out to your supervisor directly or edit the
        session and resend the verification request.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Link href={sessionUrl} style={styles.btn}>
          View session
        </Link>
      </Section>
    </BaseLayout>
  );
}

export default VerificationDisputedEmail;
