-- 028_chapter_roles.sql
-- Custom roles & permissions for chapter coordinators. The primary coordinator
-- (chapters.primary_coordinator_id) is the owner and always has every permission.

CREATE TABLE IF NOT EXISTS public.chapter_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  name        text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  is_default  boolean NOT NULL DEFAULT false, -- seeded defaults can't be deleted
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, name)
);
CREATE INDEX IF NOT EXISTS idx_chapter_roles_chapter ON public.chapter_roles (chapter_id);
ALTER TABLE public.chapter_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapter_roles_service ON public.chapter_roles;
CREATE POLICY chapter_roles_service ON public.chapter_roles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Link a coordinator to a role (null = full access, for legacy/owner-added rows).
ALTER TABLE public.chapter_coordinators ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.chapter_roles(id) ON DELETE SET NULL;
