import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface ParentalConsentEmailProps {
  parentEmail: string;
  studentName: string;
  consentUrl: string;
}

export function ParentalConsentEmail({ studentName, consentUrl }: ParentalConsentEmailProps) {
  return (
    <BaseLayout preview={`${studentName} wants to use Merit — parent approval needed`}>
      <Text style={styles.h1}>Parental consent required</Text>
      <Text style={styles.p}>
        <strong>{studentName}</strong> created a Merit account to track volunteer hours. Because
        they are under 18, we need a parent or guardian to approve their account before they can
        start using it.
      </Text>
      <Text style={styles.p}>
        Merit is a volunteer-hour tracking platform. We collect only the information needed to log
        and verify hours — name, email, organization, and dates. We do not sell data or show ads.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Link href={consentUrl} style={styles.btnSuccess}>
          Approve account
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        If you did not expect this email, you can ignore it. {studentName}'s account will remain
        inactive until approved.
      </Text>
    </BaseLayout>
  );
}

export default ParentalConsentEmail;
