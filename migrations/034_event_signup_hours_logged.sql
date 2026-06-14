-- Migration: 034_event_signup_hours_logged.sql
-- Run in Supabase SQL Editor.
--
-- Adds a per-signup marker recording WHEN an org confirmed a volunteer's
-- attendance and auto-logged their hours. This lets an org confirm volunteers
-- one-by-one ("yes, this person actually came") and have the assigned hours
-- credited to that student immediately — while making the action idempotent:
-- a second confirm (or a later bulk "Complete event") won't double-log hours.
--
-- NULL  = attendance not yet confirmed / no hours logged.
-- set    = hours were logged at this timestamp.

ALTER TABLE public.event_signups
  ADD COLUMN IF NOT EXISTS hours_logged_at timestamptz;
