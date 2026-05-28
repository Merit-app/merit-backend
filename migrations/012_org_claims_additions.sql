-- 012_org_claims_additions.sql
-- Adds reviewed_at tracking column to org_claims.
-- Run manually in Supabase SQL Editor.
-- Date: 2026-05-28

-- org_claims: add reviewed_at for manual/auto approval timestamps
alter table public.org_claims
  add column if not exists reviewed_at timestamptz;
