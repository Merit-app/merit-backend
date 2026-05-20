import { env } from '../config/env';
import { logger } from '../lib/logger';

function shapeOrganization(raw: any) {
  return {
    name: raw.name,
    ein: raw.ein ? String(raw.ein) : undefined,
    city: raw.city,
    state: raw.state,
    nteeCode: raw.ntee_code,
    category: raw.ntee_code,
    isRegisteredNonprofit: true,
    source: 'propublica' as const,
  };
}

export async function searchNonprofits(query: string, limit = 10) {
  const base = env.PROPUBLICA_API_BASE ?? 'https://projects.propublica.org/nonprofits/api/v2';
  const url = `${base}/search.json?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Merit/1.0 (https://merit.app)' },
    });

    if (!res.ok) {
      logger.warn({ query, status: res.status }, 'propublica_search_failed');
      return [];
    }

    const data: any = await res.json();
    return (data.organizations ?? []).slice(0, limit).map(shapeOrganization);
  } catch (err) {
    logger.error({ err, query }, 'propublica_search_error');
    return [];
  }
}

export async function getNonprofitByEin(ein: string) {
  const base = env.PROPUBLICA_API_BASE ?? 'https://projects.propublica.org/nonprofits/api/v2';
  const url = `${base}/organizations/${ein}.json`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    return shapeOrganization(data.organization);
  } catch (err) {
    logger.error({ err, ein }, 'propublica_get_error');
    return null;
  }
}
