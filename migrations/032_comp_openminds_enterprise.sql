-- Migration: 032_comp_openminds_enterprise.sql
-- Run in Supabase SQL Editor.
-- Comps w-ran@openmindsfnd.org (Open Minds Foundation): personal plan -> institutional
-- (max), and his organization's org_plan -> enterprise (max). Unlocks every
-- paywalled feature on both the personal account and the org dashboard.
--
-- SAFE BY DESIGN: the org upgrade only touches organizations this user is an
-- admin/owner of (via org_admins). If he hasn't claimed an org, STEP 2 updates
-- 0 rows and the STEP 0 verification will show why.

-- ── STEP 0: VERIFY — who is this user and what org(s) do they own/admin? ──────
-- Look at this output FIRST. If the org row shows claimed = true and a role of
-- 'owner', the org is registered & claimed and the upgrades below are valid.
SELECT
  u.id              AS user_id,
  u.email,
  u.plan            AS current_personal_plan,
  oa.role           AS org_role,
  o.id              AS org_id,
  o.name            AS org_name,
  o.slug            AS org_slug,
  o.claimed         AS org_claimed,
  o.claimed_at      AS org_claimed_at,
  o.org_plan        AS current_org_plan
FROM public.users u
LEFT JOIN public.org_admins  oa ON oa.user_id = u.id
LEFT JOIN public.organizations o ON o.id = oa.org_id
WHERE lower(u.email) = lower('w-ran@openmindsfnd.org');


-- ── STEP 1: upgrade the PERSONAL plan to the max ('institutional') ───────────
UPDATE public.users
SET plan = 'institutional'
WHERE lower(email) = lower('w-ran@openmindsfnd.org');


-- ── STEP 2: upgrade the ORG plan to the max ('enterprise') ───────────────────
-- Drop any stale CHECK constraint on org_plan first (e.g. 'free'|'institutional'
-- only), so 'enterprise' is accepted. Safe / no-op if no such constraint exists.
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

UPDATE public.organizations o
SET
  org_plan                = 'enterprise',
  subscription_status     = 'active',
  subscription_period_end = now() + interval '10 years'
WHERE o.id IN (
  SELECT oa.org_id
  FROM public.org_admins oa
  JOIN public.users u ON u.id = oa.user_id
  WHERE lower(u.email) = lower('w-ran@openmindsfnd.org')
);


-- ── STEP 3: VERIFY the result — both plans should now read max ───────────────
SELECT
  u.email,
  u.plan                   AS personal_plan,         -- expect: institutional
  o.name                   AS org_name,
  o.org_plan               AS org_plan,              -- expect: enterprise
  o.subscription_status,
  o.subscription_period_end
FROM public.users u
LEFT JOIN public.org_admins  oa ON oa.user_id = u.id
LEFT JOIN public.organizations o ON o.id = oa.org_id
WHERE lower(u.email) = lower('w-ran@openmindsfnd.org');
