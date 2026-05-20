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
app.use('/', healthRouter);
app.use('/', authRouter);
app.use('/', usersRouter);
app.use('/', orgsRouter);
app.use('/', sessionsRouter);
app.use('/', verificationsRouter);
app.use('/', magicLinkRouter);
app.use('/', webhooksRouter);

// 404 & error handling
app.use(notFound);

const sentryError = getSentryErrorHandler();
if (sentryError) app.use(sentryError);

app.use(errorHandler);

export { app };
