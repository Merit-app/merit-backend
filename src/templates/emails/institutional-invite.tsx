import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface InstitutionalInviteProps {
  chapterName: string;
  inviteUrl: string;
  invitedBy: string;
}

export function InstitutionalInvite({ chapterName, inviteUrl, invitedBy }: InstitutionalInviteProps) {
  return (
    <BaseLayout preview={`You're invited to join ${chapterName} on Merit`}>
      <Text style={styles.h1}>You're invited to join {chapterName}</Text>
      <Text style={styles.p}>
        <strong>{invitedBy}</strong> invited you to join their chapter on Merit.
      </Text>
      <Text style={styles.p}>
        Merit helps students track verified volunteer hours for NHS, IB, college applications, and
        more. Sign up with this link to be automatically linked to {chapterName}.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Link href={inviteUrl} style={styles.btn}>
          Join {chapterName}
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        This invite expires in 7 days. If you weren't expecting this email, you can safely ignore
        it.
      </Text>
    </BaseLayout>
  );
}

export default InstitutionalInvite;
