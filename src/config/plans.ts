export type Plan = 'free' | 'pro' | 'premium' | 'institutional';

export const PLANS: Plan[] = ['free', 'pro', 'premium', 'institutional'];

/** Plan hierarchy for minimum-plan comparisons (higher = more features). */
export const PLAN_HIERARCHY: Record<Plan, number> = {
  free: 0,
  pro: 1,
  premium: 2,
  institutional: 3,
};

/** Returns true if userPlan meets or exceeds requiredPlan. */
export function meetsMinimum(userPlan: Plan, requiredPlan: Plan): boolean {
  return (PLAN_HIERARCHY[userPlan] ?? 0) >= (PLAN_HIERARCHY[requiredPlan] ?? 0);
}

export const PLAN_FEATURES: Record<string, Plan[]> = {
  // ── Core — all plans ───────────────────────────────────────────────
  log_sessions:        ['free', 'pro', 'premium', 'institutional'],
  sms_verification:    ['free', 'pro', 'premium', 'institutional'],
  public_profile:      ['free', 'pro', 'premium', 'institutional'],
  badges:              ['free', 'pro', 'premium', 'institutional'],
  org_follow:          ['free', 'pro', 'premium', 'institutional'],
  /** PDF export is available to all plans; service enforces date/watermark limits. */
  export_pdf:          ['free', 'pro', 'premium', 'institutional'],

  // ── Pro+ ──────────────────────────────────────────────────────────
  export_csv:          ['pro', 'premium', 'institutional'],
  unlimited_orgs:      ['pro', 'premium', 'institutional'],
  /** Full-history PDF with no date restriction and no free-tier watermark. */
  full_history_pdf:    ['pro', 'premium', 'institutional'],

  // ── Premium+ ──────────────────────────────────────────────────────
  custom_pdf_brand:    ['premium', 'institutional'],
  api_access:          ['premium', 'institutional'],
  analytics_advanced:  ['premium', 'institutional'],

  // ── Institutional only ────────────────────────────────────────────
  grant_report:        ['institutional'],
  admin_dashboard:     ['institutional'],
  org_claim:           ['institutional'],
};

export const PLAN_LIMITS: Record<Plan, Record<string, number>> = {
  free: {
    sms_per_day:           5,
    orgs_max:              5,
    /** Free users can only export sessions from the last N days (0 = unlimited). */
    pdf_lookback_days:     30,
    sessions_max:          999,
  },
  pro: {
    sms_per_day:           15,
    orgs_max:              999,
    pdf_lookback_days:     0,
    sessions_max:          999,
  },
  premium: {
    sms_per_day:           999,
    orgs_max:              999,
    pdf_lookback_days:     0,
    sessions_max:          999,
  },
  institutional: {
    sms_per_day:           999,
    orgs_max:              999,
    pdf_lookback_days:     0,
    sessions_max:          999,
  },
};
