import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Auth
  MAGIC_LINK_SECRET: z.string().optional(),
  COOKIE_SECRET: z.string().optional(),
  JWT_SECRET: z.string().optional(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Resend
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  STRIPE_PREMIUM_PRICE_ID: z.string().optional(),
  STRIPE_INSTITUTIONAL_PRICE_ID: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().url().optional(),

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
});

const prodRequiredKeys: (keyof z.infer<typeof envSchema>)[] = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'MAGIC_LINK_SECRET',
  'COOKIE_SECRET',
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
