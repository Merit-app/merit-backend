-- Migration: 016_fix_modiv_admins.sql
-- Run in Supabase SQL Editor
-- Description: Ensures contact@modivadvisors.com is in org_admins as owner
--              for Modiv Advisors. Idempotent — safe to run multiple times.

DO $$
DECLARE
  v_user_id uuid;
  v_org_id  uuid := '1aedf3b4-1ea0-4fb6-a719-d7f55ea0f258';
BEGIN
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = 'contact@modivadvisors.com';

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User contact@modivadvisors.com not found in users table — nothing to fix';
    RETURN;
  END IF;

  INSERT INTO public.org_admins (org_id, user_id, role, onboarding_completed)
  VALUES (v_org_id, v_user_id, 'owner', false)
  ON CONFLICT (org_id, user_id)
  DO UPDATE SET role = 'owner';

  RAISE NOTICE 'Fixed: user % is owner of org %', v_user_id, v_org_id;
END;
$$;
