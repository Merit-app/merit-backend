import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
  ipAddress: string;
}

export function PasswordResetEmail({ name, resetUrl, ipAddress }: PasswordResetEmailProps) {
  return (
    <BaseLayout preview="Reset your Merit password">
      <Text style={styles.h1}>Reset your password</Text>
      <Text style={styles.p}>Hi {name},</Text>
      <Text style={styles.p}>
        We received a request to reset your Merit password. Click the button below to choose a new
        one.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Link href={resetUrl} style={styles.btn}>
          Reset password
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        This link expires in 1 hour. Request came from IP: {ipAddress}. If you didn't request this,
        you can safely ignore this email — your password won't change.
      </Text>
    </BaseLayout>
  );
}

export default PasswordResetEmail;
