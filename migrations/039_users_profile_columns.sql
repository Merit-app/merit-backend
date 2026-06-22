-- Migration: 039_users_profile_columns.sql
-- Description: Add profile columns the app has always referenced on public.users
--   (avatar_url, username, city, bio, profile_public, etc.) but which were MISSING
--   from this database — they were never in a captured migration (added ad-hoc on
--   the original DB; a rebuilt/!different project never got them). Any select of
--   them (getStudentDetail, getOrgVolunteers, leaderboard, avatar upload) failed
--   with Postgres 42703 "column does not exist"; the services swallow the query
--   error, so it surfaced as a misleading 404 / empty list (e.g. chapter student
--   detail "Student not found"). IF NOT EXISTS = idempotent and safe to re-run.
--
-- Run in Supabase SQL Editor.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url     text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username       text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS school         text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city           text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bio            text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS grade          integer;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone          text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_public boolean NOT NULL DEFAULT true;

-- Tell PostgREST to pick up the new columns immediately (otherwise the API keeps
-- erroring until its schema cache refreshes).
NOTIFY pgrst, 'reload schema';
