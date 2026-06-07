-- Migration: 020_sessions_org_id_nullable_on_delete.sql
-- Run in Supabase SQL Editor.
--
-- Lets an organization be deleted without losing data: make the org_id FKs on
-- sessions and authenticators SET NULL on org delete, so those rows stay
-- (volunteers' hours preserved) but detach from the deleted org.

-- ── sessions.org_id → nullable + ON DELETE SET NULL ──
ALTER TABLE public.sessions ALTER COLUMN org_id DROP NOT NULL;

DO $$
DECLARE fk text;
BEGIN
  SELECT conname INTO fk FROM pg_constraint
  WHERE conrelid = 'public.sessions'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%organizations%';
  IF fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sessions DROP CONSTRAINT %I', fk);
  END IF;
  ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
END$$;

-- ── authenticators.org_id → ON DELETE SET NULL (column already nullable) ──
DO $$
DECLARE fk text;
BEGIN
  -- Only if the authenticators table + an org FK exist
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.authenticators'::regclass AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%organizations%'
  ) THEN
    SELECT conname INTO fk FROM pg_constraint
    WHERE conrelid = 'public.authenticators'::regclass AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%organizations%';
    EXECUTE format('ALTER TABLE public.authenticators DROP CONSTRAINT %I', fk);
    ALTER TABLE public.authenticators
      ADD CONSTRAINT authenticators_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'authenticators table not found — skipped';
END$$;
