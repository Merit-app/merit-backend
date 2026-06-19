-- Migration: 036_sessions_allow_manual_hours.sql
-- Description: Enable org-side manual hour adjustments to subtract hours by
--              writing a negative-hours verified session (ledger entry). Drops
--              any positivity CHECK on sessions.hours if one exists so negative
--              adjustments can be inserted. Guarded + idempotent; safe to run
--              even if no such constraint exists. Positive (add) adjustments
--              work regardless of this migration.
--
-- Run in Supabase SQL Editor.

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_hours_check;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_hours_positive;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_hours_nonnegative;
