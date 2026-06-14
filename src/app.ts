import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

import { env } from './config/env';
import { requestId } from './middleware/request-id.middleware';
import { notFound } from './middleware/not-found.middleware';
import { errorHandler } from './middleware/error-handler.middleware';
import { getSentryRequestHandler, getSentryErrorHandler } from './config/sentry';

const app = express();

// Sentry request handler (must be first)
const sentryRequest = getSentryRequestHandler();
if (sentryRequest) app.use(sentryRequest);

// Security & parsing
app.use(helmet());

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Stripe webhook must receive raw body — mount before express.json()
import stripeWebhookRouter from './routes/stripe-webhook.routes';
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

// Avatar upload needs a higher body size limit — must come before the global 1 MB parser
app.use('/profiles/me/avatar', express.json({ limit: '10mb' }));
// Org logo/cover upload also needs the higher limit (base64 of a 5 MB image ≈ 6.7 MB)
app.use('/organizations/:orgId/logo', express.json({ limit: '10mb' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(requestId);

// Routes
import healthRouter from './routes/health.routes';
import authRouter from './routes/auth.routes';
import usersRouter from './routes/users.routes';
import orgsRouter from './routes/organizations.routes';
import sessionsRouter from './routes/sessions.routes';
import verificationsRouter from './routes/verifications.routes';
import magicLinkRouter from './routes/magic-link.routes';
import webhooksRouter from './routes/webhooks.routes';
import statsRouter from './routes/stats.routes';
import notificationsRouter from './routes/notifications.routes';
import billingRouter from './routes/billing.routes';
import adminRouter from './routes/admin.routes';
import exportsRouter from './routes/exports.routes';
import profilesRouter from './routes/profiles.routes';
import onboardingRouter from './routes/onboarding.routes';
import publicOrgsRouter from './routes/public-orgs.routes';
import orgClaimsRouter from './routes/org-claims.routes';
import leaderboardRouter from './routes/leaderboard.routes';
import orgRouter from './routes/org.routes';
import scholarshipsRouter from './routes/scholarships.routes';
import orgBillingRouter from './routes/org-billing.routes';
import schoolOnboardingRouter from './routes/school-onboarding.routes';
import chapterRouter from './routes/chapter.routes';
import eventsRouter from './routes/events.routes';
app.use('/', healthRouter);
app.use('/', authRouter);
app.use('/', usersRouter);
app.use('/', orgsRouter);
app.use('/', sessionsRouter);
app.use('/', verificationsRouter);
app.use('/', magicLinkRouter);
app.use('/', webhooksRouter);
app.use('/', statsRouter);
app.use('/', notificationsRouter);
app.use('/', billingRouter);
app.use('/', adminRouter);
app.use('/', exportsRouter);
app.use('/', profilesRouter);
app.use('/', onboardingRouter);
app.use('/', publicOrgsRouter);
app.use('/', orgClaimsRouter);
app.use('/', leaderboardRouter);
app.use('/org', orgRouter);
app.use('/', scholarshipsRouter);
app.use('/org', orgBillingRouter);
app.use('/', schoolOnboardingRouter);
app.use('/', chapterRouter);
app.use('/', eventsRouter);

// 404 & error handling
app.use(notFound);

// ─── Scholarship RSS sync — runs every Sunday at 3:00 AM UTC ─────────────────
// Non-blocking: any feed failure is logged as a warning, never crashes the app.
import cron from 'node-cron';
import { syncScholarshipFeeds } from './services/scholarships-sync.service';

cron.schedule('0 3 * * 0', async () => {
  const { logger } = await import('./lib/logger');
  logger.info('scholarship_rss_cron_start');
  try {
    const result = await syncScholarshipFeeds();
    logger.info(result, 'scholarship_rss_cron_done');
  } catch (err) {
    logger.warn({ err }, 'scholarship_rss_cron_error');
  }
}, { timezone: 'UTC' });

// ─── Weekly chapter at-risk reminders — Mondays at 14:00 UTC ────────────────
import { runWeeklyChapterReminders } from './services/chapter.service';
cron.schedule('0 14 * * 1', async () => {
  const { logger } = await import('./lib/logger');
  try {
    const result = await runWeeklyChapterReminders();
    logger.info(result, 'weekly_chapter_reminders_cron_done');
  } catch (err) {
    logger.warn({ err }, 'weekly_chapter_reminders_cron_error');
  }
}, { timezone: 'UTC' });

const sentryError = getSentryErrorHandler();
if (sentryError) app.use(sentryError);

app.use(errorHandler);

export { app };
