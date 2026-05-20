-- Auto-update updated_at on row changes
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger trg_sessions_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

create trigger trg_orgs_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- Audit log trigger function (called by service layer, not DB trigger, for flexibility)
-- Domain verification stats RPC (used by trust.service.ts)
create or replace function public.domain_verification_stats(p_domain text)
returns table(success_count bigint, total_count bigint) as $$
begin
  return query
  select
    count(*) filter (where s.status = 'verified') as success_count,
    count(*) as total_count
  from public.sessions s
  join public.authenticators a on a.id = s.authenticator_id
  where a.email_domain = p_domain
    and s.deleted_at is null;
end;
$$ language plpgsql security definer;
