-- 027_chapter_reminders.sql
-- Toggle for the weekly automated at-risk reminder cron.

ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;
