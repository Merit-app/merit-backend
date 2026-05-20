import { resendClient, RESEND_MODE } from '../config/resend';
import { env } from '../config/env';
import { logger } from '../lib/logger';

interface SendEmailOpts {
  to: string | string[];
  subject: string;
  html?: string;
  react?: any;
  replyTo?: string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  const from = `${env.RESEND_FROM_NAME ?? 'Merit'} <${env.RESEND_FROM_EMAIL ?? 'hello@merit.app'}>`;

  try {
    const result = await resendClient.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      react: opts.react,
    });

    if (RESEND_MODE === 'real') {
      logger.info({ to: opts.to, subject: opts.subject, id: result?.data?.id }, 'email_sent');
    }
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, 'email_send_failed');
    // Don't throw — email failures should not break the request flow
  }
}

export async function sendWelcomeEmail(opts: { name: string; email: string; confirmationUrl: string }) {
  await sendEmail({
    to: opts.email,
    subject: 'Welcome to Merit — confirm your email',
    html: `<p>Hi ${opts.name},</p><p>Confirm your email: <a href="${opts.confirmationUrl}">${opts.confirmationUrl}</a></p>`,
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
    html: `<p>Hi ${opts.name},</p><p>Reset your password: <a href="${opts.resetUrl}">${opts.resetUrl}</a></p><p>Request from ${opts.ipAddress}. Ignore if this wasn't you.</p>`,
  });
}

export async function sendParentalConsentEmail(opts: {
  parentEmail: string;
  studentName: string;
  consentUrl: string;
}) {
  await sendEmail({
    to: opts.parentEmail,
    subject: `Your child wants to use Merit`,
    html: `<p>${opts.studentName} signed up for Merit. <a href="${opts.consentUrl}">Approve their account</a>.</p>`,
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
    html: `<p>Hi ${opts.name},</p><p>Your account will be deleted on ${opts.deletionDate}. <a href="${opts.cancelUrl}">Cancel deletion</a>.</p>`,
  });
}
