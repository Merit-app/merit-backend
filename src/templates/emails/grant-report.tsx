import * as React from 'react';
import { Link, Row, Column, Section, Text, Hr } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface GrantReportSession {
  studentName: string;
  hours: number;
  orgName: string;
  date: string;
  status: string;
  tier: string;
}

interface GrantReportEmailProps {
  chapterName: string;
  reportPeriod: string;
  totalHours: number;
  verifiedHours: number;
  memberCount: number;
  sessions: GrantReportSession[];
  downloadUrl: string;
}

const tableHeader = {
  fontSize: '12px',
  fontWeight: '600',
  color: '#71717a',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  padding: '0 0 8px',
};

const tableCell = {
  fontSize: '13px',
  color: '#3f3f46',
  padding: '8px 0',
  borderBottom: '1px solid #e4e4e7',
};

export function GrantReportEmail({
  chapterName,
  reportPeriod,
  totalHours,
  verifiedHours,
  memberCount,
  sessions,
  downloadUrl,
}: GrantReportEmailProps) {
  return (
    <BaseLayout preview={`Grant report for ${chapterName} — ${reportPeriod}`}>
      <Text style={styles.h1}>Grant Report</Text>
      <Text style={styles.p}>
        {chapterName} · {reportPeriod}
      </Text>

      <Section
        style={{
          backgroundColor: '#f4f4f5',
          borderRadius: '6px',
          padding: '16px 20px',
          margin: '16px 0 24px',
        }}
      >
        <Row>
          <Column>
            <Text style={{ ...styles.p, margin: '0 0 4px', fontWeight: '600' }}>
              {totalHours.toFixed(1)}
            </Text>
            <Text style={{ ...styles.small, margin: '0' }}>Total hours</Text>
          </Column>
          <Column>
            <Text style={{ ...styles.p, margin: '0 0 4px', fontWeight: '600' }}>
              {verifiedHours.toFixed(1)}
            </Text>
            <Text style={{ ...styles.small, margin: '0' }}>Verified hours</Text>
          </Column>
          <Column>
            <Text style={{ ...styles.p, margin: '0 0 4px', fontWeight: '600' }}>
              {memberCount}
            </Text>
            <Text style={{ ...styles.small, margin: '0' }}>Members</Text>
          </Column>
        </Row>
      </Section>

      {sessions.length > 0 && (
        <>
          <Text style={{ ...styles.p, fontWeight: '600', margin: '0 0 8px' }}>Sessions</Text>
          <Row>
            <Column style={tableHeader}>Student</Column>
            <Column style={tableHeader}>Org</Column>
            <Column style={tableHeader}>Hours</Column>
            <Column style={tableHeader}>Status</Column>
          </Row>
          {sessions.slice(0, 20).map((s, i) => (
            <Row key={i}>
              <Column style={tableCell}>{s.studentName}</Column>
              <Column style={tableCell}>{s.orgName}</Column>
              <Column style={tableCell}>{s.hours}</Column>
              <Column style={tableCell}>{s.status}</Column>
            </Row>
          ))}
          {sessions.length > 20 && (
            <Text style={{ ...styles.small, margin: '8px 0 0' }}>
              + {sessions.length - 20} more sessions in the full report
            </Text>
          )}
        </>
      )}

      <Section style={{ margin: '24px 0' }}>
        <Link href={downloadUrl} style={styles.btn}>
          Download full PDF report
        </Link>
      </Section>
    </BaseLayout>
  );
}

export default GrantReportEmail;
