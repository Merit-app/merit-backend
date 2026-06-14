-- Migration: 033_notifications_drop_type_check.sql
-- Run in Supabase SQL Editor.
--
-- The notifications table had a CHECK constraint (notifications_type_check) that
-- restricted `type` to an allow-list. That list pre-dated the org event/message
-- features, so inserting type='event' or type='org_message' failed with
-- 23514 (check_violation). Because createNotification/createManyNotifications
-- swallow insert errors, this failed SILENTLY — event invites, org broadcasts,
-- and admin confirmations never appeared in users' inboxes.
--
-- Notification types are defined and controlled in application code, so the
-- DB-level allow-list adds little safety and is a recurring footgun (every new
-- feature would need to ALTER it). Drop it.
--
-- (Separately, the service was fixed to use the real `read_at` column instead of
--  a nonexistent boolean `read` column — see commit fdddd49.)

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

-- If you'd rather keep validation, drop the line above and instead recreate the
-- constraint with the full set of types the app uses, e.g.:
--
-- ALTER TABLE public.notifications
--   ADD CONSTRAINT notifications_type_check CHECK (type IN (
--     'verification_received', 'verification_disputed',
--     'chapter_announcement', 'chapter_reminder',
--     'goal_milestone', 'event', 'org_message'
--   ));
