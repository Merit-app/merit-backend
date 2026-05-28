import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
  Hr,
  Link,
} from '@react-email/components';

interface BaseLayoutProps {
  preview: string;
  children: React.ReactNode;
  footerExtra?: React.ReactNode;
}

const base = {
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
  backgroundColor: '#f4f4f5',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '40px auto',
  padding: '40px',
  borderRadius: '8px',
  maxWidth: '560px',
};

const logo = {
  marginBottom: '24px',
};

const footer = {
  color: '#71717a',
  fontSize: '12px',
  lineHeight: '20px',
  marginTop: '24px',
};

export function BaseLayout({ preview, children, footerExtra }: BaseLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={base}>
        <Container style={container}>
          <Section style={logo}>
            <Text style={{ fontSize: '20px', fontWeight: '700', color: '#09090b', margin: '0' }}>
              Merit
            </Text>
          </Section>
          {children}
          <Hr style={{ borderColor: '#e4e4e7', margin: '32px 0 24px' }} />
          <Text style={footer}>
            © {new Date().getFullYear()} Merit. All rights reserved.
          </Text>
          {footerExtra}
        </Container>
      </Body>
    </Html>
  );
}

// Shared style tokens
export const styles = {
  h1: { fontSize: '24px', fontWeight: '700', color: '#09090b', margin: '0 0 8px' },
  p: { fontSize: '15px', lineHeight: '24px', color: '#3f3f46', margin: '0 0 16px' },
  small: { fontSize: '12px', color: '#71717a' },
  btn: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '6px',
    textDecoration: 'none',
    display: 'inline-block',
    fontWeight: '600',
    fontSize: '14px',
  },
  btnDanger: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '6px',
    textDecoration: 'none',
    display: 'inline-block',
    fontWeight: '600',
    fontSize: '14px',
  },
  btnSuccess: {
    backgroundColor: '#16a34a',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '6px',
    textDecoration: 'none',
    display: 'inline-block',
    fontWeight: '600',
    fontSize: '14px',
  },
};
