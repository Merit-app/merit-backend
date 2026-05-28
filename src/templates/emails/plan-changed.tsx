import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { BaseLayout, styles } from './base';

interface PlanChangedProps {
  name: string;
  newPlan: string;
  effectiveDate: string;
  features: string[];
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function PlanChanged({ name, newPlan, effectiveDate, features }: PlanChangedProps) {
  return (
    <BaseLayout preview={`Welcome to Merit ${capitalize(newPlan)}`}>
      <Text style={styles.h1}>Welcome to Merit {capitalize(newPlan)}</Text>
      <Text style={styles.p}>Hi {name},</Text>
      <Text style={styles.p}>
        Your plan upgrade is active as of {effectiveDate}. Here's what you've unlocked:
      </Text>
      {features.map((feature, i) => (
        <Text key={i} style={{ ...styles.p, marginTop: 0, marginBottom: 4 }}>
          ✓ {feature}
        </Text>
      ))}
      <Section style={{ margin: '24px 0' }}>
        <Link href="https://merit.app/dashboard" style={styles.btn}>
          Start using your new features
        </Link>
      </Section>
      <Text style={{ ...styles.p, ...styles.small }}>
        Questions about your plan?{' '}
        <Link href="mailto:hello@merit.app">Contact us</Link>
      </Text>
    </BaseLayout>
  );
}

export default PlanChanged;
