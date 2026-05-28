import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';
import { extractEmailDomain, isPersonalDomain, isBlockedDomain, classifyDomainType } from '../lib/email-domain';

export async function resolveOrCreateAuthenticator(input: {
  name: string;
  email?: string;
  phone?: string;
  orgId?: string;
}) {
  let authenticator: any = null;

  // 1. Try to find existing authenticator by email, then phone
  if (input.email) {
    const { data } = await supabaseAdmin
      .from('authenticators')
      .select('*')
      .eq('email_lower', input.email.toLowerCase())
      .maybeSingle();
    authenticator = data;
  }

  if (!authenticator && input.phone) {
    const { data } = await supabaseAdmin
      .from('authenticators')
      .select('*')
      .eq('phone', input.phone)
      .maybeSingle();
    authenticator = data;
  }

  // 2. Determine tier
  const tier = await classifyAuthenticatorTier(input);

  // 3. Create or update
  if (!authenticator) {
    const { data, error } = await supabaseAdmin
      .from('authenticators')
      .insert({
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        org_id: input.orgId ?? null,
        tier,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, input }, 'authenticator_create_failed');
      throw error;
    }
    authenticator = data;
  } else if (authenticator.tier !== tier) {
    await supabaseAdmin
      .from('authenticators')
      .update({ tier })
      .eq('id', authenticator.id);
    authenticator = { ...authenticator, tier };
  }

  // 4. Touch the domain record
  if (input.email) {
    await touchEmailDomain(input.email, input.orgId);
  }

  return authenticator;
}

async function classifyAuthenticatorTier(input: {
  email?: string;
  phone?: string;
  orgId?: string;
}): Promise<string> {
  if (!input.email) return 'unverified';

  const domain = extractEmailDomain(input.email);
  if (!domain) return 'unverified';

  if (isBlockedDomain(domain)) return 'unverified';
  if (isPersonalDomain(domain)) return 'personal_email';

  // Look up domain trust record
  const { data: domainRecord } = await supabaseAdmin
    .from('org_email_domains')
    .select('*')
    .eq('domain', domain)
    .maybeSingle();

  if (!domainRecord) return 'org_email_unverified';
  if (domainRecord.manually_blocked) return 'unverified';
  if (domainRecord.domain_type === 'personal') return 'personal_email';
  if (domainRecord.trust_score >= 0.5) return 'org_email_verified';

  return 'org_email_unverified';
}

async function touchEmailDomain(email: string, orgId?: string) {
  const domain = extractEmailDomain(email);
  if (!domain) return;

  const { data: existing } = await supabaseAdmin
    .from('org_email_domains')
    .select('id, domain_type')
    .eq('domain', domain)
    .maybeSingle();

  if (!existing) {
    const domainType = classifyDomainType(domain);
    await supabaseAdmin.from('org_email_domains').insert({
      domain,
      org_id: orgId ?? null,
      domain_type: domainType,
      trust_score: domainType === 'personal' ? 0.1 : 0.0,
    });
  } else {
    await supabaseAdmin
      .from('org_email_domains')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('domain', domain);
  }
}

export async function recalculateDomainTrust(domain: string) {
  const { data: domainRecord } = await supabaseAdmin
    .from('org_email_domains')
    .select('*')
    .eq('domain', domain)
    .single();

  if (!domainRecord || domainRecord.manually_blocked) return;

  // Count unique authenticators on this domain
  const { count: uniqueAuths } = await supabaseAdmin
    .from('authenticators')
    .select('id', { count: 'exact', head: true })
    .eq('email_domain', domain);

  // Count successful/total verifications via RPC
  const { data: stats } = await supabaseAdmin.rpc('domain_verification_stats', {
    p_domain: domain,
  });

  const successCount = (stats as any)?.[0]?.success_count ?? 0;
  const totalCount = (stats as any)?.[0]?.total_count ?? 0;

  // Domain ↔ org website match
  let matchesWebsite = false;
  if (domainRecord.org_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('website_domain')
      .eq('id', domainRecord.org_id)
      .single();
    matchesWebsite = org?.website_domain === domain;
  }

  const trustScore = Math.min(
    1.0,
    0.3 * (matchesWebsite ? 1 : 0) +
    0.3 * (domainRecord.matches_propublica_ein_holder ? 1 : 0) +
    0.3 * (domainRecord.manually_verified ? 1 : 0) +
    0.2 * Math.min(1.0, (uniqueAuths ?? 0) / 5) +
    0.1 * (totalCount > 0 ? successCount / totalCount : 0),
  );

  await supabaseAdmin
    .from('org_email_domains')
    .update({
      unique_authenticator_count: uniqueAuths ?? 0,
      successful_verification_count: successCount,
      trust_score: trustScore,
      matches_org_website: matchesWebsite,
      trust_score_updated_at: new Date().toISOString(),
      domain_type: trustScore >= 0.5 ? 'org_verified' : 'org_unverified',
    })
    .eq('id', domainRecord.id);

  logger.info({ domain, trustScore, uniqueAuths }, 'domain_trust_recalculated');
}

export async function incrementAuthenticatorStats(
  authenticatorId: string,
  outcome: 'success' | 'failure',
  studentId: string,
) {
  const { data: auth } = await supabaseAdmin
    .from('authenticators')
    .select('total_verifications, successful_verifications, failed_verifications, unique_students_verified')
    .eq('id', authenticatorId)
    .single();

  if (!auth) return;

  // Check if this student is new for this authenticator
  const { count: existingStudent } = await supabaseAdmin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('authenticator_id', authenticatorId)
    .eq('user_id', studentId)
    .eq('status', 'verified');

  const isNewStudent = (existingStudent ?? 0) === 0;

  await supabaseAdmin
    .from('authenticators')
    .update({
      total_verifications: auth.total_verifications + 1,
      successful_verifications: outcome === 'success'
        ? auth.successful_verifications + 1
        : auth.successful_verifications,
      failed_verifications: outcome === 'failure'
        ? auth.failed_verifications + 1
        : auth.failed_verifications,
      unique_students_verified: isNewStudent && outcome === 'success'
        ? auth.unique_students_verified + 1
        : auth.unique_students_verified,
      last_verified_at: new Date().toISOString(),
    })
    .eq('id', authenticatorId);
}

export function determineVerificationTier(
  authenticatorTier: string,
  isWhitelisted: boolean,
): 'verified_basic' | 'verified_institutional' {
  if (isWhitelisted || authenticatorTier === 'org_email_verified') {
    return 'verified_institutional';
  }
  return 'verified_basic';
}
