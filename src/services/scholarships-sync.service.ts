/**
 * Scholarship RSS Sync Service
 *
 * Parses government and education RSS feeds for Canadian scholarships and
 * upserts new entries into the scholarships table. Designed to run on a
 * weekly cron schedule — non-fatal if any feed fails.
 *
 * Feeds currently synced:
 *  1. EduCanada (Government of Canada international scholarship programme)
 *  2. Canada.ca student financial aid news
 *  3. NSERC funding news
 *  4. SSHRC funding news
 */

import Parser from 'rss-parser';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';

const parser = new Parser({
  timeout: 10_000,
  headers: { 'User-Agent': 'Merit-Scholarship-Sync/1.0 (https://meritco.app)' },
});

// ─── RSS feed sources ─────────────────────────────────────────────────────────

const FEEDS: {
  url: string;
  source: string;
  defaultCategories: string[];
  defaultLocation: string;
  label: string;
}[] = [
  {
    url: 'https://www.educanada.ca/scholarships-bourses/news-nouvelles/rss-eng.aspx',
    source: 'educanada',
    defaultCategories: ['education', 'leadership'],
    defaultLocation: 'Canada',
    label: 'EduCanada',
  },
  {
    url: 'https://www.nserc-crsng.gc.ca/RSS/Funding-Financement_eng.xml',
    source: 'nserc',
    defaultCategories: ['stem', 'education'],
    defaultLocation: 'Canada',
    label: 'NSERC',
  },
  {
    url: 'https://www.sshrc-crsh.gc.ca/news_room-salle_de_presse/latest_news-nouvelles_recentes/rss-eng.xml',
    source: 'sshrc',
    defaultCategories: ['education', 'social-impact'],
    defaultLocation: 'Canada',
    label: 'SSHRC',
  },
];

// ─── Category detection ───────────────────────────────────────────────────────
// Scan title/description for keywords and infer extra categories.

function inferCategories(text: string, base: string[]): string[] {
  const t = text.toLowerCase();
  const cats = new Set(base);

  if (/environment|ecology|conservation|climate|wildlife|nature|green|sustain/.test(t)) cats.add('environment');
  if (/community|volunteer|civic|social|nonprofit|outreach/.test(t)) cats.add('community');
  if (/health|medical|nursing|mental|wellness|disease/.test(t)) cats.add('health');
  if (/engineer|science|technology|computer|data|math|physics|chemistry|biology/.test(t)) cats.add('stem');
  if (/leader|award|excel|outstanding|merit/.test(t)) cats.add('leadership');
  if (/indigenous|first nations|métis|inuit|aboriginal/.test(t)) cats.add('indigenous');
  if (/art|music|theatre|film|creative|culture/.test(t)) cats.add('arts');
  if (/sport|athlete|athletic|olympic/.test(t)) cats.add('athletics');
  if (/innovat|entrepreneuri|start.?up|venture/.test(t)) cats.add('innovation');
  if (/peace|humanitarian|international|global/.test(t)) cats.add('social-impact');

  return Array.from(cats);
}

// ─── Deadline parsing ─────────────────────────────────────────────────────────

function parseDeadline(text: string | undefined): string | null {
  if (!text) return null;
  // Try to find a date pattern in the text
  const patterns = [
    /(\d{4}-\d{2}-\d{2})/,                          // ISO
    /(\w+ \d{1,2},? \d{4})/,                         // "March 15, 2026"
    /(\d{1,2} \w+ \d{4})/,                           // "15 March 2026"
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime()) && d > new Date()) {
          return d.toISOString().split('T')[0];
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

// ─── Amount extraction ────────────────────────────────────────────────────────

function extractAmount(text: string): string | null {
  const m = text.match(/\$[\d,]+(?:\s*(?:to|-)\s*\$[\d,]+)?(?:\s*(?:per year|\/year|annually))?/i);
  return m ? m[0] : null;
}

// ─── Main sync function ───────────────────────────────────────────────────────

export async function syncScholarshipFeeds(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const feed of FEEDS) {
    try {
      logger.info({ feed: feed.label }, 'scholarship_rss_sync_start');

      const result = await parser.parseURL(feed.url);
      const rows: any[] = [];

      for (const item of result.items ?? []) {
        const title = item.title?.trim();
        const link  = item.link?.trim();
        if (!title || !link) continue;

        const fullText = [title, item.contentSnippet ?? '', item.content ?? ''].join(' ');
        const deadline = parseDeadline(item.contentSnippet ?? '');
        const amount   = extractAmount(fullText);
        const externalId = `${feed.source}-${Buffer.from(link).toString('base64').slice(0, 60)}`;

        rows.push({
          title:        title.slice(0, 200),
          provider:     result.title ?? feed.label,
          amount_label: amount,
          deadline,
          is_rolling:   false,
          url:          link,
          description:  (item.contentSnippet ?? '').slice(0, 1000) || null,
          requirements: null,
          eligibility:  'Canadian students — see link for full eligibility',
          categories:   inferCategories(fullText, feed.defaultCategories),
          location:     feed.defaultLocation,
          renewable:    false,
          featured:     false,
          source:       feed.source,
          external_id:  externalId,
          active:       true,
        });
      }

      if (rows.length > 0) {
        const { error } = await supabaseAdmin
          .from('scholarships')
          .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true });

        if (error) {
          logger.warn({ error, feed: feed.label }, 'scholarship_rss_upsert_error');
          errors.push(`${feed.label}: ${error.message}`);
          failed++;
        } else {
          logger.info({ count: rows.length, feed: feed.label }, 'scholarship_rss_sync_done');
          synced += rows.length;
        }
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, feed: feed.label }, 'scholarship_rss_feed_failed');
      errors.push(`${feed.label}: ${err?.message ?? 'unknown error'}`);
      failed++;
    }
  }

  return { synced, failed, errors };
}
