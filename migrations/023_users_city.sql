-- 023_users_city.sql
-- Adds the `city` column to users, required by the local leaderboard and the
-- Settings → Profile "City" field. Without it, the leaderboard user-detail query
-- (which selects `city`) errors and returns zero entries for ALL leaderboard tabs.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city text;

-- Optional: index to speed up local-leaderboard city matching as the user base grows.
CREATE INDEX IF NOT EXISTS idx_users_city ON public.users (lower(city)) WHERE city IS NOT NULL;
