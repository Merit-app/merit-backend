import { Worker, type Job } from 'bullmq';
import { makeConnection } from './index';
import { logger } from '../lib/logger';

export interface PdfJobData {
  type: 'grant_report' | 'user_export';
  userId: string;
  chapterId?: string;
  period?: string;
  outputKey: string; // S3/Supabase storage path
}

async function processPdf(job: Job<PdfJobData>): Promise<void> {
  // PDF generation wired in Step 23
  logger.info({ type: job.data.type, jobId: job.id, outputKey: job.data.outputKey }, 'pdf_job_processing');
}

export function startPdfWorker(): Worker<PdfJobData> {
  const worker = new Worker<PdfJobData>('pdf', processPdf, {
    connection: makeConnection(),
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    logger.info({ type: job.data.type, jobId: job.id }, 'pdf_job_done');
  });

  worker.on('failed', (job, err) => {
    logger.error({ type: job?.data.type, jobId: job?.id, err: err.message }, 'pdf_job_failed');
  });

  return worker;
}
