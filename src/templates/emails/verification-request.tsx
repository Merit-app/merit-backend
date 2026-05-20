import * as React from 'react';
import { Link, Row, Column, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface VerificationRequestEmailProps {
  supervisorName: string;
  studentName: string;
  hours: number;
  orgName: string;
  date: string;
  verifyUrl: string;
  disputeUrl: string;
  unsubscribeUrl: string;
}

const card = {
  backgroundColor: '#f4f4f5',
  borderRadius: '6px',
  padding: '16px 20px',
  margin: '16px 0 24px',
};

export function VerificationRequestEmail({
  supervisorName,
  studentName,
  hours,
  orgName,
  date,
  verifyUrl,
  disputeUrl,
  unsubscribeUrl,
}: VerificationRequestEmailProps) {
  return (
    <BaseLayout
      preview={`${studentName} logged ${hours} hours at ${orgName} — please verify`}
      footerExtra={
        <Text style={{ ...styles.small, marginTop: '8px' }}>
          <Link href={unsubscribeUrl} style={{ color: '#71717a' }}>
            Unsubscribe from Merit emails
          </Link>
        </Text>
      }
    >
      <Text style={styles.h1}>Hours verification request</Text>
      <Text style={styles.p}>Hi {supervisorName},</Text>
      <Text style={styles.p}>
        <strong>{studentName}</strong> logged volunteer hours at your organization and listed you as
        their supervisor. Please confirm or dispute the details below.
      </Text>

      <Section style={card}>
        <Text style={{ ...styles.p, margin: '0 0 8px', fontWeight: '600' }}>Session details</Text>
        <Text style={{ ...styles.p, margin: '0 0 4px' }}>
          <strong>Student:</strong> {studentName}
        </Text>
        <Text style={{ ...styles.p, margin: '0 0 4px' }}>
          <strong>Organization:</strong> {orgName}
        </Text>
        <Text style={{ ...styles.p, margin: '0 0 4px' }}>
          <strong>Hours:</strong> {hours}
        </Text>
        <Text style={{ ...styles.p, margin: '0' }}>
          <strong>Date:</strong> {date}
        </Text>
      </Section>

      <Row>
        <Column>
          <Link href={verifyUrl} style={styles.btnSuccess}>
            ✓ Verify hours
          </Link>
        </Column>
        <Column style={{ paddingLeft: '12px' }}>
          <Link href={disputeUrl} style={styles.btnDanger}>
            ✗ Dispute
          </Link>
        </Column>
      </Row>

      <Text style={{ ...styles.p, ...styles.small, marginTop: '24px' }}>
        You are receiving this because {studentName} listed your email as their supervisor. You do
        not need a Merit account to respond.
      </Text>
    </BaseLayout>
  );
}

export default VerificationRequestEmail;
