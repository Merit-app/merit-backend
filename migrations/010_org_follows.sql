-- 010_org_follows.sql
-- User → Organization follows (bookmarks) for the Discover feed
-- Run manually in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.user_org_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  followed_at timestamptz DEFAULT now(),
  UNIQUE (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_user_org_follows_user ON user_org_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_follows_org  ON user_org_follows(org_id);

ALTER TABLE user_org_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_follows"
ON user_org_follows FOR ALL
USING (user_id = auth.uid());
