import { z } from 'zod';

// Coerce empty strings → undefined so optional().url() validators don't reject blank .env values
const coerceEmptyStrings = (obj: unknown) =>
  Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, v === '' ? undefined : v]),
  );

const envSchema = z.preprocess(coerceEmptyStrings, z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_PROJECT_ID: z.string().optional(),

  // Auth
  MAGIC_LINK_SECRET: z.string().optional(),
  COOKIE_SECRET: z.string().optional(),
  JWT_SECRET: z.string().optional(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_WEBHOOK_AUTH_TOKEN: z.string().optional(),

  // Resend
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_FROM_NAME: z.string().optional(),
  RESEND_REPLY_TO: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
  STRIPE_PRICE_PREMIUM_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PREMIUM_YEARLY: z.string().optional(),
  STRIPE_PRICE_INSTITUTIONAL: z.string().optional(),
  STRIPE_TAX_ENABLED: z.coerce.boolean().default(false),

  // Sentry
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // PostHog
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().optional(),

  // Redis
  REDIS_URL: z.string().url().optional(),

  // CORS
  ALLOWED_ORIGINS: z.string().optional(),

  // Feature flags
  ENABLE_TRUST_SCORING: z.coerce.boolean().default(true),
  ENABLE_FRAUD_DETECTION: z.coerce.boolean().default(true),
  ENABLE_WEEKLY_DIGEST: z.coerce.boolean().default(true),

  // App
  FRONTEND_URL: z.string().url().optional(),
  APP_NAME: z.string().default('Merit'),
  API_BASE_URL: z.string().url().optional(),
  ADMIN_EMAIL: z.string().email().optional(), // Required in prod — set in Railway env vars

  // Internal secrets (not in prodRequiredKeys because they disable features gracefully if absent)
  HEALTH_SECRET_TOKEN: z.string().optional(),
  PURGE_SECRET: z.string().optional(),

  // External APIs
  PROPUBLICA_API_BASE: z.string().url().optional(),
}));

const prodRequiredKeys: (keyof z.infer<typeof envSchema>)[] = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'MAGIC_LINK_SECRET',
  'COOKIE_SECRET',
  'ADMIN_EMAIL',
];

function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const data = parsed.data;
  if (data.NODE_ENV === 'production') {
    const missing = prodRequiredKeys.filter((k) => !data[k]);
    if (missing.length > 0) {
      console.error(`Missing required env vars in production: ${missing.join(', ')}`);
      process.exit(1);
    }
  }
  return data;
}

export const env = parseEnv();
export type Env = typeof env;
