-- Additional composite and covering indexes for common query patterns

-- Sessions: coordinator viewing chapter sessions by date range
create index idx_sessions_date on public.sessions(date desc) where deleted_at is null;

-- Sessions: fast lookup by supervisor phone/email for webhook processing
create index idx_sessions_supervisor_phone on public.sessions(supervisor_phone) where supervisor_phone is not null and deleted_at is null;
create index idx_sessions_supervisor_email on public.sessions(supervisor_email) where supervisor_email is not null and deleted_at is null;

-- Sessions: authenticator lookup
create index idx_sessions_authenticator on public.sessions(authenticator_id) where authenticator_id is not null;

-- Verifications: unanswered by destination (for webhook phone lookup)
create index idx_verifications_unanswered_dest on public.verifications(destination, sent_at desc) where responded_at is null;

-- Rate limits: cleanup old rows
create index idx_rate_limits_date on public.rate_limits(date);

-- Audit log: resource lookups for compliance queries
create index idx_audit_created on public.audit_log(created_at desc);

-- Users: locked accounts (for login check)
create index idx_users_locked on public.users(account_locked_until) where account_locked_until is not null;

-- Users: deletion queue (for data retention job)
create index idx_users_deletion_scheduled on public.users(deletion_scheduled_for) where deletion_scheduled_for is not null;

-- Organizations: trust score (for sorting search results)
create index idx_orgs_trust on public.organizations(internal_trust_score desc);
