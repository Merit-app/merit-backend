-- Migration: 019_set_test_orgs_enterprise.sql
-- Run in Supabase SQL Editor.
-- Gives Modiv Advisors and Merit the Enterprise plan so all paywalled features
-- (events, messages, reports, certificates, leaderboard, CSV export) unlock for testing.

-- If org_plan has an old CHECK constraint (e.g. only 'free'|'institutional'),
-- this drops it so 'enterprise' is allowed. Safe if the constraint doesn't exist.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%org_plan%'
  LOOP
    EXECUTE format('ALTER TABLE public.organizations DROP CONSTRAINT %I', c);
    RAISE NOTICE 'Dropped org_plan check constraint: %', c;
  END LOOP;
END$$;

UPDATE public.organizations
SET
  org_plan = 'enterprise',
  subscription_status = 'active',
  subscription_period_end = now() + interval '10 years'
WHERE name IN ('Modiv Advisors', 'Merit')
   OR id = 'efbc7999-1ca1-442f-9a01-3a2bc00b0f0c';

-- Verify what was updated:
SELECT id, name, org_plan, subscription_status, subscription_period_end
FROM public.organizations
WHERE name IN ('Modiv Advisors', 'Merit')
   OR id = 'efbc7999-1ca1-442f-9a01-3a2bc00b0f0c';
