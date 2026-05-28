import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface ConfirmEmailProps {
  name: string;
  confirmationUrl: string;
}

export function ConfirmEmail({ name, confirmationUrl }: ConfirmEmailProps) {
  return (
    <BaseLayout preview="Confirm your Merit account">
      <Text style={styles.h1}>Welcome to Merit, {name}!</Text>
      <Text style={styles.p}>
        Merit helps you track and verify volunteer hours so every contribution you make is
        recognized and verifiable.
      </Text>
      <Text style={styles.p}>Confirm your email address to get started:</Text>
      <Section style={{ margin: '24px 0' }}>
        <Link href={confirmationUrl} style={styles.btn}>
          Confirm email address
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        This link expires in 24 hours. If you didn't sign up for Merit, you can safely ignore this
        email.
      </Text>
    </BaseLayout>
  );
}

// Backward-compat alias — resend.service.ts references WelcomeEmail
export { ConfirmEmail as WelcomeEmail };
export default ConfirmEmail;
