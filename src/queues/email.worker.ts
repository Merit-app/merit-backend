import { Worker, type Job } from 'bullmq';
import { makeConnection } from './index';
import { logger } from '../lib/logger';
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendParentalConsentEmail,
  sendAccountDeletionEmail,
  sendVerificationRequestEmail,
  sendVerificationConfirmedEmail,
  sendVerificationDisputedEmail,
  sendSupervisorMagicLinkEmail,
} from '../services/resend.service';

export type EmailJobData =
  | { type: 'welcome'; name: string; email: string; confirmationUrl: string }
  | { type: 'password_reset'; name: string; email: string; resetUrl: string; ipAddress: string }
  | { type: 'parental_consent'; parentEmail: string; studentName: string; consentUrl: string }
  | { type: 'account_deletion'; name: string; email: string; deletionDate: string; cancelUrl: string }
  | {
      type: 'verification_request';
      supervisorEmail: string;
      supervisorName: string;
      studentName: string;
      hours: number;
      orgName: string;
      date: string;
      verifyUrl: string;
      disputeUrl: string;
      unsubscribeUrl: string;
    }
  | {
      type: 'verification_confirmed';
      studentEmail: string;
      studentName: string;
      supervisorName: string;
      hours: number;
      orgName: string;
      tier: string;
      sessionUrl: string;
    }
  | {
      type: 'verification_disputed';
      studentEmail: string;
      studentName: string;
      supervisorName: string;
      hours: number;
      orgName: string;
      sessionUrl: string;
    }
  | { type: 'magic_link'; supervisorEmail: string; pendingCount: number; dashUrl: string };

async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const { data } = job;
  logger.debug({ type: data.type, jobId: job.id }, 'email_job_processing');

  switch (data.type) {
    case 'welcome':
      await sendWelcomeEmail(data);
      break;
    case 'password_reset':
      await sendPasswordResetEmail(data);
      break;
    case 'parental_consent':
      await sendParentalConsentEmail(data);
      break;
    case 'account_deletion':
      await sendAccountDeletionEmail(data);
      break;
    case 'verification_request':
      await sendVerificationRequestEmail(data);
      break;
    case 'verification_confirmed':
      await sendVerificationConfirmedEmail(data);
      break;
    case 'verification_disputed':
      await sendVerificationDisputedEmail(data);
      break;
    case 'magic_link':
      await sendSupervisorMagicLinkEmail(data);
      break;
  }
}

export function startEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>('email', processEmail, {
    connection: makeConnection(),
    concurrency: 5,
  });

  worker.on('completed', (job) => {
    logger.info({ type: job.data.type, jobId: job.id }, 'email_job_done');
  });

  worker.on('failed', (job, err) => {
    logger.error({ type: job?.data.type, jobId: job?.id, err: err.message }, 'email_job_failed');
  });

  return worker;
}
