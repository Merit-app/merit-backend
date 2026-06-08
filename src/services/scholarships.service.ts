import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Scholarship {
  id: string;
  title: string;
  provider: string;
  amount_label: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  is_rolling: boolean;
  url: string;
  description: string | null;
  requirements: string | null;
  eligibility: string | null;
  categories: string[];
  location: string;
  renewable: boolean;
  featured: boolean;
  source: string;
  org_id: string | null;
  active: boolean;
  created_at: string;
}

// ─── List & search ────────────────────────────────────────────────────────────

export async function listScholarships(params: {
  search?: string;
  category?: string;
  location?: string;
  limit?: number;
  offset?: number;
}) {
  const { search, category, location, limit = 30, offset = 0 } = params;

  let query = supabaseAdmin
    .from('scholarships')
    .select('*')
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('deadline', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(
      `title.ilike.%${search}%,provider.ilike.%${search}%,description.ilike.%${search}%`,
    );
  }
  if (category && category !== 'all') {
    query = query.contains('categories', [category]);
  }
  if (location && location !== 'all') {
    query = query.eq('location', location);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Scholarship[];
}

// ─── Get single ───────────────────────────────────────────────────────────────

export async function getScholarship(id: string) {
  const { data, error } = await supabaseAdmin
    .from('scholarships')
    .select('*, organizations(id, name, slug, logo_url)')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ─── Personalized matching ────────────────────────────────────────────────────
// Pulls the student's volunteer history, extracts the top-3 org categories,
// maps them to scholarship categories, then returns matched scholarships.

export async function getScholarshipsForUser(userId: string) {
  // 1. Fetch the user's sessions with their org category
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('org_id, organizations(category)')
    .eq('user_id', userId)
    .not('org_id', 'is', null)
    .is('deleted_at', null)
    .limit(100);

  // 2. Count category frequency
  const categoryCounts: Record<string, number> = {};
  for (const session of sessions ?? []) {
    const org = (session as any).organizations;
    if (org?.category) {
      const normalized = normalizeOrgCategory(org.category);
      categoryCounts[normalized] = (categoryCounts[normalized] ?? 0) + 1;
    }
  }

  // 3. Top 3 categories
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  // 4. No history → return featured scholarships
  if (topCategories.length === 0) {
    const { data } = await supabaseAdmin
      .from('scholarships')
      .select('*')
      .eq('active', true)
      .eq('featured', true)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(6);

    return { scholarships: (data ?? []) as Scholarship[], matchedCategories: [] };
  }

  // 5. Find scholarships overlapping the top categories
  const { data: matched } = await supabaseAdmin
    .from('scholarships')
    .select('*')
    .eq('active', true)
    .overlaps('categories', topCategories)
    .order('featured', { ascending: false })
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(9);

  return {
    scholarships: (matched ?? []) as Scholarship[],
    matchedCategories: topCategories,
  };
}

// Maps org category labels to scholarship category tags
function normalizeOrgCategory(orgCategory: string): string {
  const map: Record<string, string> = {
    'Food & Hunger':        'community',
    'Education & Tutoring': 'education',
    'Environment & Nature': 'environment',
    'Animal Welfare':       'environment',
    'Health & Wellness':    'health',
    'Community & Social':   'community',
    'Youth & Children':     'community',
    'Arts & Culture':       'arts',
    'Emergency & Crisis':   'social-impact',
    'Sports & Recreation':  'athletics',
    'Other':                'community',
  };
  return map[orgCategory] ?? 'community';
}

// ─── RapidAPI (optional) ──────────────────────────────────────────────────────
// If RAPIDAPI_KEY is set, attempt to fetch from a scholarships API and cache
// results into the DB. Designed to be called in the background — any failure
// is non-fatal and logged as a warning, not an error.

export async function fetchAndCacheFromRapidAPI(search?: string): Promise<void> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return; // key not configured — skip silently

  try {
    const { default: axios } = await import('axios');
    const response = await axios.get(
      'https://scholarships3.p.rapidapi.com/scholarships',
      {
        params: { query: search ?? 'Canada volunteer community service', limit: 20 },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'scholarships3.p.rapidapi.com',
        },
        timeout: 6000,
      },
    );

    const results: any[] = response.data?.scholarships ?? response.data ?? [];
    const rows = results
      .filter((s) => s?.title && s?.url)
      .map((s) => ({
        title: s.title ?? s.name,
        provider: s.organization ?? s.sponsor ?? 'Unknown',
        amount_label: s.amount ?? s.award_amount ?? null,
        deadline: s.deadline ?? null,
        url: s.url ?? s.link,
        description: s.description ?? null,
        requirements: s.requirements ?? null,
        eligibility: s.eligibility ?? null,
        categories: ['community'],
        location: 'Canada',
        source: 'rapidapi',
        external_id: String(s.id ?? s.title).slice(0, 255),
        active: true,
      }));

    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from('scholarships')
        .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true });
      if (error) logger.warn({ error }, 'scholarships_rapidapi_upsert_error');
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'scholarships_rapidapi_fetch_failed');
  }
}

// ─── Saved scholarships ───────────────────────────────────────────────────────

export async function getSavedScholarships(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('saved_scholarships')
    .select('scholarship_id, created_at, scholarships(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: any) => row.scholarships as Scholarship);
}

export async function getSavedIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('saved_scholarships')
    .select('scholarship_id')
    .eq('user_id', userId);
  return (data ?? []).map((r: any) => r.scholarship_id as string);
}

export async function toggleSavedScholarship(
  userId: string,
  scholarshipId: string,
): Promise<{ saved: boolean }> {
  // Check if already saved
  const { data: existing } = await supabaseAdmin
    .from('saved_scholarships')
    .select('id')
    .eq('user_id', userId)
    .eq('scholarship_id', scholarshipId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('saved_scholarships')
      .delete()
      .eq('user_id', userId)
      .eq('scholarship_id', scholarshipId);
    return { saved: false };
  }

  await supabaseAdmin
    .from('saved_scholarships')
    .insert({ user_id: userId, scholarship_id: scholarshipId });
  return { saved: true };
}

// ─── Org-posted scholarships ──────────────────────────────────────────────────

export async function listOrgScholarships(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('scholarships')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Scholarship[];
}

export async function createOrgScholarship(
  orgId: string,
  orgName: string,
  data: {
    title: string;
    amount_label?: string;
    deadline?: string;
    is_rolling?: boolean;
    url: string;
    description?: string;
    requirements?: string;
    eligibility?: string;
    categories: string[];
    renewable?: boolean;
  },
) {
  const { data: result, error } = await supabaseAdmin
    .from('scholarships')
    .insert({
      ...data,
      provider: orgName,
      org_id: orgId,
      source: 'org',
      external_id: `org-${orgId}-${Date.now()}`,
      location: 'Canada',
      featured: false,
      active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return result as Scholarship;
}

export async function deleteOrgScholarship(orgId: string, scholarshipId: string) {
  const { error } = await supabaseAdmin
    .from('scholarships')
    .update({ active: false })
    .eq('id', scholarshipId)
    .eq('org_id', orgId);

  if (error) throw error;
}
