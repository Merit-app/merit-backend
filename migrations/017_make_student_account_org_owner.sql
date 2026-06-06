-- Migration: 017_make_student_account_org_owner.sql
-- Run in Supabase SQL Editor.
--
-- WHY: contact@modivadvisors.com never had a password set, so it can't log in.
-- The org login endpoint (/auth/login/org) works for ANY user present in
-- org_admins — it just signs in with email+password then checks org_admins
-- membership. So we make Kai's STUDENT account (which already has a known
-- password) the owner of Modiv Advisors. He can then sign in at /org/login
-- using his student credentials. No separate account or password reset needed.
--
-- Idempotent — safe to run multiple times.

DO $$
DECLARE
  v_user_id uuid;
  v_org_id  uuid := '1aedf3b4-1ea0-4fb6-a719-d7f55ea0f258';
BEGIN
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = 'kainiu0087@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Student account kainiu0087@gmail.com not found — check the email';
    RETURN;
  END IF;

  INSERT INTO public.org_admins (org_id, user_id, role, onboarding_completed)
  VALUES (v_org_id, v_user_id, 'owner', true)
  ON CONFLICT (org_id, user_id)
  DO UPDATE SET role = 'owner';

  RAISE NOTICE 'Done: % is now owner of org %', v_user_id, v_org_id;
END;
$$;

-- Verify:
SELECT u.email, oa.role, oa.org_id
FROM public.org_admins oa
JOIN public.users u ON u.id = oa.user_id
WHERE oa.org_id = '1aedf3b4-1ea0-4fb6-a719-d7f55ea0f258';
