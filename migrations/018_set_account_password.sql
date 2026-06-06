-- Migration: 018_set_account_password.sql
-- Run in Supabase SQL Editor.
--
-- WHY: kainiu0087@gmail.com was created via Google/magic-link, so it has no
-- password. This sets one directly using pgcrypto (bcrypt) — the exact format
-- GoTrue/Supabase auth expects — so /org/login and /login both work with it.
-- No email or redirect-URL configuration involved.
--
-- 1) CHANGE 'ChangeMe!2026' below to a password you want (keep the quotes).
-- 2) Run it.
-- 3) Log in at meritco.app/org/login with kainiu0087@gmail.com + that password.

UPDATE auth.users
SET
  encrypted_password = crypt('ChangeMe!2026', gen_salt('bf')),
  email_confirmed_at = COALESCE(email_confirmed_at, now()),
  updated_at = now()
WHERE email = 'kainiu0087@gmail.com';

-- Verify exactly one row was updated and the account is confirmed:
SELECT email, (encrypted_password IS NOT NULL) AS has_password, email_confirmed_at
FROM auth.users
WHERE email = 'kainiu0087@gmail.com';
