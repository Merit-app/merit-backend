import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface SupervisorMagicLinkProps {
  supervisorEmail: string;
  pendingCount: number;
  dashUrl: string;
}

export function SupervisorMagicLink({ pendingCount, dashUrl }: SupervisorMagicLinkProps) {
  return (
    <BaseLayout preview={`You have ${pendingCount} verification${pendingCount !== 1 ? 's' : ''} waiting`}>
      <Text style={styles.h1}>Your Merit supervisor dashboard</Text>
      <Text style={styles.p}>
        You have <strong>{pendingCount} pending verification{pendingCount !== 1 ? 's' : ''}</strong>{' '}
        waiting for your response. Open your dashboard to review and respond to all of them in one
        place.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Link href={dashUrl} style={styles.btn}>
          Open my dashboard
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        This link expires in 24 hours and can only be used once. You do not need a Merit account to
        respond to verifications.
      </Text>
    </BaseLayout>
  );
}

// Backward-compat alias
export { SupervisorMagicLink as MagicLinkEmail };
export default SupervisorMagicLink;
