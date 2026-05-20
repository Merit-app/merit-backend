import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface AccountDeletedProps {
  name: string;
  deletionDate: string;
  cancelUrl: string;
}

export function AccountDeleted({ name, deletionDate, cancelUrl }: AccountDeletedProps) {
  return (
    <BaseLayout preview="Your Merit account is scheduled for deletion">
      <Text style={styles.h1}>Account deletion scheduled</Text>
      <Text style={styles.p}>Hi {name},</Text>
      <Text style={styles.p}>
        Your Merit account has been scheduled for deletion on <strong>{deletionDate}</strong>. All
        your data — sessions, verifications, and profile — will be permanently removed.
      </Text>
      <Text style={styles.p}>
        Changed your mind? You have until {deletionDate} to cancel.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Link href={cancelUrl} style={styles.btn}>
          Cancel deletion
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        If you intended to delete your account, no action is needed. This email was sent to confirm
        your request.
      </Text>
    </BaseLayout>
  );
}

// Backward-compat alias
export { AccountDeleted as AccountDeletionEmail };
export default AccountDeleted;
