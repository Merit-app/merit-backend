-- Migration: 040_sessions_verification_sent.sql
-- Description: Adds the "log now, send the supervisor text later" capability.
--   A verified-path session can now be saved WITHOUT immediately texting the
--   supervisor — it sits in a "Not sent yet" state until the student sends it
--   (one row, or a batch, from the By-organization dashboard).
--
--   verification_sent distinguishes the two pending sub-states:
--     status='pending' AND verification_sent=true   -> "Awaiting reply" (text went out)
--     status='pending' AND verification_sent=false  -> "Not sent yet"   (student deferred)
--
--   DEFAULT true is deliberate: every EXISTING row was already sent (the old code
--   always fired the text on create), so backfilling them as "sent" is correct.
--   Self-tracked rows (self_reported=true, status='verified', no phone) are
--   structurally excluded from any send — the batch query also filters
--   self_reported=false — so they can never be texted by accident.
--
--   IF NOT EXISTS = idempotent, safe to re-run. Run in Supabase SQL Editor.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS verification_sent boolean NOT NULL DEFAULT true;

-- Tell PostgREST to pick up the new column immediately (otherwise the API keeps
-- erroring until its schema cache refreshes).
NOTIFY pgrst, 'reload schema';
