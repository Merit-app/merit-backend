import { Worker, type Job } from 'bullmq';
import { makeConnection } from './index';
import { logger } from '../lib/logger';
import { sendVerificationSMS, sendVerificationEmail } from '../services/verifications.service';

export type SmsJobData =
  | { type: 'verification_sms'; session: any; user: { id: string; name: string; plan: string } }
  | { type: 'verification_email'; session: any; user: { id: string; name: string; plan: string } };

async function processSms(job: Job<SmsJobData>): Promise<void> {
  const { data } = job;
  logger.debug({ type: data.type, jobId: job.id }, 'sms_job_processing');

  switch (data.type) {
    case 'verification_sms':
      await sendVerificationSMS(data.session, data.user);
      break;
    case 'verification_email':
      await sendVerificationEmail(data.session, data.user);
      break;
  }
}

export function startSmsWorker(): Worker<SmsJobData> {
  const worker = new Worker<SmsJobData>('sms', processSms, {
    connection: makeConnection(),
    concurrency: 10,
  });

  worker.on('completed', (job) => {
    logger.info({ type: job.data.type, jobId: job.id }, 'sms_job_done');
  });

  worker.on('failed', (job, err) => {
    logger.error({ type: job?.data.type, jobId: job?.id, err: err.message }, 'sms_job_failed');
  });

  return worker;
}
