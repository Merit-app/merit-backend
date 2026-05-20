import { render } from '@react-email/render';
import * as React from 'react';
import { resendClient, RESEND_MODE } from '../config/resend';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { WelcomeEmail } from '../templates/emails/welcome';
import { PasswordResetEmail } from '../templates/emails/password-reset';
import { ParentalConsentEmail } from '../templates/emails/parental-consent';
import { AccountDeletionEmail } from '../templates/emails/account-deletion';
import { VerificationRequestEmail } from '../templates/emails/verification-request';
import { VerificationConfirmedEmail } from '../templates/emails/verification-confirmed';
import { VerificationDisputedEmail } from '../templates/emails/verification-disputed';
import { MagicLinkEmail } from '../templates/emails/magic-link';

interface SendEmailOpts {
  to: string | string[];
  subject: string;
  html?: string;
  react?: React.ReactElement;
  replyTo?: string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  const from = `${env.RESEND_FROM_NAME ?? 'Merit'} <${env.RESEND_FROM_EMAIL ?? 'hello@merit.app'}>`;

  let html = opts.html;
  if (opts.react && !html) {
    html = await render(opts.react);
  }

  try {
    const result = await resendClient.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html,
      reply_to: opts.replyTo ?? env.RESEND_REPLY_TO,
    });

    if (RESEND_MODE === 'real') {
      logger.info({ to: opts.to, subject: opts.subject, id: (result as any)?.data?.id }, 'email_sent');
    }
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, 'email_send_failed');
    // Don't throw — email failures should not break the request flow
  }
}

export async function sendWelcomeEmail(opts: {
  name: string;
  email: string;
  confirmationUrl: string;
}) {
  await sendEmail({
    to: opts.email,
    subject: 'Welcome to Merit — confirm your email',
    react: React.createElement(WelcomeEmail, { name: opts.name, confirmationUrl: opts.confirmationUrl }),
  });
}

export async function sendPasswordResetEmail(opts: {
  name: string;
  email: string;
  resetUrl: string;
  ipAddress: string;
}) {
  await sendEmail({
    to: opts.email,
    subject: 'Reset your Merit password',
    react: React.createElement(PasswordResetEmail, {
      name: opts.name,
      resetUrl: opts.resetUrl,
      ipAddress: opts.ipAddress,
    }),
  });
}

export async function sendParentalConsentEmail(opts: {
  parentEmail: string;
  studentName: string;
  consentUrl: string;
}) {
  await sendEmail({
    to: opts.parentEmail,
    subject: `${opts.studentName} wants to use Merit — parental approval needed`,
    react: React.createElement(ParentalConsentEmail, {
      parentEmail: opts.parentEmail,
      studentName: opts.studentName,
      consentUrl: opts.consentUrl,
    }),
  });
}

export async function sendAccountDeletionEmail(opts: {
  name: string;
  email: string;
  deletionDate: string;
  cancelUrl: string;
}) {
  await sendEmail({
    to: opts.email,
    subject: 'Your Merit account is scheduled for deletion',
    react: React.createElement(AccountDeletionEmail, {
      name: opts.name,
      deletionDate: opts.deletionDate,
      cancelUrl: opts.cancelUrl,
    }),
  });
}

export async function sendVerificationRequestEmail(opts: {
  supervisorEmail: string;
  supervisorName: string;
  studentName: string;
  hours: number;
  orgName: string;
  date: string;
  verifyUrl: string;
  disputeUrl: string;
  unsubscribeUrl: string;
}) {
  await sendEmail({
    to: opts.supervisorEmail,
    subject: `Verify ${opts.studentName}'s volunteer hours at ${opts.orgName}`,
    react: React.createElement(VerificationRequestEmail, {
      supervisorName: opts.supervisorName,
      studentName: opts.studentName,
      hours: opts.hours,
      orgName: opts.orgName,
      date: opts.date,
      verifyUrl: opts.verifyUrl,
      disputeUrl: opts.disputeUrl,
      unsubscribeUrl: opts.unsubscribeUrl,
    }),
  });
}

export async function sendVerificationConfirmedEmail(opts: {
  studentEmail: string;
  studentName: string;
  supervisorName: string;
  hours: number;
  orgName: string;
  tier: string;
  sessionUrl: string;
}) {
  await sendEmail({
    to: opts.studentEmail,
    subject: `Your hours at ${opts.orgName} have been verified`,
    react: React.createElement(VerificationConfirmedEmail, {
      studentName: opts.studentName,
      supervisorName: opts.supervisorName,
      hours: opts.hours,
      orgName: opts.orgName,
      tier: opts.tier,
      sessionUrl: opts.sessionUrl,
    }),
  });
}

export async function sendVerificationDisputedEmail(opts: {
  studentEmail: string;
  studentName: string;
  supervisorName: string;
  hours: number;
  orgName: string;
  sessionUrl: string;
}) {
  await sendEmail({
    to: opts.studentEmail,
    subject: `Your hours at ${opts.orgName} were disputed`,
    react: React.createElement(VerificationDisputedEmail, {
      studentName: opts.studentName,
      supervisorName: opts.supervisorName,
      hours: opts.hours,
      orgName: opts.orgName,
      sessionUrl: opts.sessionUrl,
    }),
  });
}

export async function sendSupervisorMagicLinkEmail(opts: {
  supervisorEmail: string;
  pendingCount: number;
  dashUrl: string;
}) {
  await sendEmail({
    to: opts.supervisorEmail,
    subject: 'Your Merit supervisor dashboard',
    react: React.createElement(MagicLinkEmail, {
      supervisorEmail: opts.supervisorEmail,
      pendingCount: opts.pendingCount,
      dashUrl: opts.dashUrl,
    }),
  });
}
