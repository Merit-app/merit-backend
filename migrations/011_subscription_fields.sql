-- 011_subscription_fields.sql
-- Adds Stripe subscription tracking columns to users table.
-- Without these, syncSubscription() UPDATE (including plan) fails silently.
-- Run manually in Supabase SQL Editor. Date: 2025-05-28

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status     text,
  ADD COLUMN IF NOT EXISTS subscription_period_end timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription
  ON public.users(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_subscription_status
  ON public.users(subscription_status)
  WHERE subscription_status IS NOT NULL;
