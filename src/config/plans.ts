export type Plan = 'free' | 'pro' | 'premium' | 'institutional';

export const PLANS: Plan[] = ['free', 'pro', 'premium', 'institutional'];

export const PLAN_FEATURES: Record<string, Plan[]> = {
  // Core
  basic_profile: ['free', 'pro', 'premium', 'institutional'],
  endorsements: ['free', 'pro', 'premium', 'institutional'],
  references: ['free', 'pro', 'premium', 'institutional'],

  // Pro+
  advanced_search: ['pro', 'premium', 'institutional'],
  export_pdf: ['pro', 'premium', 'institutional'],
  bulk_endorsements: ['pro', 'premium', 'institutional'],
  analytics_basic: ['pro', 'premium', 'institutional'],

  // Premium+
  analytics_advanced: ['premium', 'institutional'],
  api_access: ['premium', 'institutional'],
  custom_branding: ['premium', 'institutional'],
  priority_support: ['premium', 'institutional'],
  trust_score_details: ['premium', 'institutional'],

  // Institutional only
  team_management: ['institutional'],
  sso: ['institutional'],
  audit_logs: ['institutional'],
  unlimited_seats: ['institutional'],
  dedicated_support: ['institutional'],
};

export const PLAN_LIMITS: Record<Plan, Record<string, number>> = {
  free: {
    endorsements_per_day: 5,
    references_per_month: 3,
    search_per_day: 20,
    storage_mb: 100,
  },
  pro: {
    endorsements_per_day: 50,
    references_per_month: 25,
    search_per_day: 200,
    storage_mb: 1000,
  },
  premium: {
    endorsements_per_day: 500,
    references_per_month: 100,
    search_per_day: 2000,
    storage_mb: 10000,
  },
  institutional: {
    endorsements_per_day: 99999,
    references_per_month: 99999,
    search_per_day: 99999,
    storage_mb: 99999,
  },
};
