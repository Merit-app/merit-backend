-- Migration: 035_org_events_timezone.sql
-- Run in Supabase SQL Editor BEFORE deploying the code that reads/writes it.
--
-- Event times are stored as UTC (timestamptz). Emails/SMS are formatted on the
-- server, which runs in UTC — so an event set for 11:45 (Pacific) was rendered
-- as 18:45/6:45 in the invite. We now capture the organizer's IANA timezone
-- (e.g. "America/Los_Angeles") at create time and format all notifications in it,
-- so the displayed wall-clock time always matches what the organizer entered.
--
-- NULL = legacy event (created before this column); notifications fall back to a
-- default zone. New events always carry their timezone.

ALTER TABLE public.org_events
  ADD COLUMN IF NOT EXISTS timezone text;
