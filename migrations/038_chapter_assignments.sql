-- Migration: 038_chapter_assignments.sql
-- Description: Chapter assignments — a coordinator posts a task; students submit
--              file(s) (docs/PDFs/etc.) and an optional note; the coordinator
--              reviews. Distinct from the hours requirement. Adds three tables
--              plus a PRIVATE storage bucket for the uploaded files. All file
--              access is mediated by the backend (service role), which bypasses
--              storage RLS, so no storage policies are needed here.
--
-- Run in Supabase SQL Editor.

-- ── Assignments (one row per task the coordinator posts) ─────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id    uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  title         text NOT NULL,
  instructions  text,
  due_date      date,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chapter_assignments_chapter
  ON public.chapter_assignments(chapter_id, created_at DESC);

-- ── Submissions (one per student per assignment; resubmitting updates the row) ─
CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.chapter_assignments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note          text,
  status        text NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'reviewed', 'approved', 'returned')),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (assignment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment
  ON public.assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_user
  ON public.assignment_submissions(user_id);

-- ── Files attached to a submission (multiple allowed) ────────────────────────
CREATE TABLE IF NOT EXISTS public.assignment_submission_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.assignment_submissions(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  file_name     text NOT NULL,
  content_type  text,
  size_bytes    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignment_submission_files_submission
  ON public.assignment_submission_files(submission_id);

-- ── Private storage bucket for the uploaded files ────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('assignment-files', 'assignment-files', false)
ON CONFLICT (id) DO NOTHING;
