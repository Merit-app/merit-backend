import * as React from 'react';
import { renderToBuffer, Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { supabaseAdmin } from '../config/supabase';
import { NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { PLAN_LIMITS } from '../config/plans';
import type { Plan } from '../config/plans';

const VERIFY_BASE_URL = 'https://meritco.app/verify';

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, padding: 40, color: '#3f3f46' },
  header: { marginBottom: 16 },
  brand: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#09090b' },
  subtitle: { fontSize: 10, color: '#71717a', marginTop: 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: '#e4e4e7', marginVertical: 12 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#09090b', marginBottom: 4 },
  metaRow: { flexDirection: 'row', gap: 24, marginBottom: 4 },
  metaLabel: { color: '#71717a' },
  metaValue: { color: '#3f3f46' },
  statBox: { flexDirection: 'row', backgroundColor: '#f4f4f5', borderRadius: 6, padding: 12, marginBottom: 16, gap: 24 },
  stat: { flex: 1 },
  statNum: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#09090b', marginBottom: 2 },
  statLbl: { fontSize: 8, color: '#71717a' },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e4e4e7', paddingBottom: 4, marginBottom: 4 },
  tableHeaderCell: { fontFamily: 'Helvetica-Bold', color: '#71717a', fontSize: 8 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f4f4f5', paddingVertical: 3 },
  cell: { fontSize: 8, color: '#3f3f46' },
  verified: { fontSize: 8, color: '#16a34a' },
  disputed: { fontSize: 8, color: '#dc2626' },
  pending: { fontSize: 8, color: '#71717a' },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 7, color: '#a1a1aa' },
  // Signature block styles
  sigSection: { marginTop: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  sigLabel: { fontSize: 7, color: '#94a3b8', letterSpacing: 1, marginBottom: 8, fontFamily: 'Helvetica-Bold' },
  sigRow: { flexDirection: 'row', gap: 16 },
  sigLeft: { flex: 6 },
  sigRight: { flex: 4 },
  sigField: { marginBottom: 12 },
  sigFieldLabel: { fontSize: 8, color: '#64748b', marginBottom: 2 },
  sigFieldValue: { fontSize: 9, color: '#1e293b', marginBottom: 2 },
  sigLine: { borderBottomWidth: 1, borderBottomColor: '#cbd5e1', marginTop: 2, height: 14 },
  qrBlock: { alignItems: 'center', marginTop: 4 },
  qrCaption: { fontSize: 6, color: '#94a3b8', textAlign: 'center', marginTop: 3 },
  qrUrl: { fontSize: 5.5, color: '#94a3b8', textAlign: 'center', marginTop: 1 },
  sigVerifyText: { fontSize: 6.5, color: '#94a3b8', textAlign: 'center', marginTop: 12 },
});

// ─── Signature + QR block (appended after each session's row) ─────────────

function SignatureBlock(props: {
  sessionId: string;
  supervisorName: string | null;
  orgName: string | null;
  qrDataUrl: string;
}) {
  const shortId = props.sessionId.slice(0, 8);
  const verifyUrl = `meritco.app/verify/${props.sessionId}`;

  return React.createElement(
    View,
    { style: styles.sigSection },
    // Section label
    React.createElement(Text, { style: styles.sigLabel }, 'SUPERVISOR VERIFICATION'),
    React.createElement(
      View,
      { style: styles.sigRow },
      // ── Left column (60%) ──────────────────────────────────────────
      React.createElement(
        View,
        { style: styles.sigLeft },
        // Supervisor Name — pre-filled
        React.createElement(
          View,
          { style: styles.sigField },
          React.createElement(Text, { style: styles.sigFieldLabel }, 'Supervisor Name'),
          React.createElement(Text, { style: styles.sigFieldValue }, props.supervisorName ?? ''),
          React.createElement(View, { style: styles.sigLine }),
        ),
        // Organization — pre-filled
        React.createElement(
          View,
          { style: styles.sigField },
          React.createElement(Text, { style: styles.sigFieldLabel }, 'Organization'),
          React.createElement(Text, { style: styles.sigFieldValue }, props.orgName ?? ''),
          React.createElement(View, { style: styles.sigLine }),
        ),
        // Title/Role — blank for supervisor to fill
        React.createElement(
          View,
          { style: styles.sigField },
          React.createElement(Text, { style: styles.sigFieldLabel }, 'Title / Role'),
          React.createElement(View, { style: [styles.sigLine, { marginTop: 10 }] }),
        ),
      ),
      // ── Right column (40%) ─────────────────────────────────────────
      React.createElement(
        View,
        { style: styles.sigRight },
        // Signature — blank
        React.createElement(
          View,
          { style: styles.sigField },
          React.createElement(Text, { style: styles.sigFieldLabel }, 'Signature'),
          React.createElement(View, { style: [styles.sigLine, { marginTop: 28 }] }),
        ),
        // Date — blank
        React.createElement(
          View,
          { style: styles.sigField },
          React.createElement(Text, { style: styles.sigFieldLabel }, 'Date'),
          React.createElement(View, { style: [styles.sigLine, { marginTop: 10 }] }),
        ),
        // QR Code
        React.createElement(
          View,
          { style: styles.qrBlock },
          React.createElement(Image, { src: props.qrDataUrl, style: { width: 60, height: 60 } }),
          React.createElement(Text, { style: styles.qrCaption }, 'Scan to verify'),
          React.createElement(Text, { style: styles.qrUrl }, verifyUrl),
        ),
      ),
    ),
    // Full-width verification URL below
    React.createElement(
      Text,
      { style: styles.sigVerifyText },
      `This document can be independently verified at ${verifyUrl}`,
    ),
  );
}

// ─── Sessions PDF ─────────────────────────────────────────────────────────

function SessionsPdf(props: {
  userName: string;
  sessions: any[];
  totalHours: number;
  verifiedHours: number;
  freeTier?: boolean;
  qrCodes: Record<string, string>;
}) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(Text, { style: styles.brand }, 'Merit'),
        React.createElement(Text, { style: styles.subtitle }, 'Volunteer Hour Record'),
      ),
      React.createElement(View, { style: styles.divider }),
      React.createElement(Text, { style: styles.title }, props.userName),
      React.createElement(View, { style: styles.metaRow },
        React.createElement(Text, { style: styles.metaLabel }, `Generated: ${new Date().toLocaleDateString()}`),
      ),
      // Stats
      React.createElement(View, { style: styles.statBox },
        React.createElement(View, { style: styles.stat },
          React.createElement(Text, { style: styles.statNum }, props.totalHours.toFixed(1)),
          React.createElement(Text, { style: styles.statLbl }, 'Total Hours'),
        ),
        React.createElement(View, { style: styles.stat },
          React.createElement(Text, { style: styles.statNum }, props.verifiedHours.toFixed(1)),
          React.createElement(Text, { style: styles.statLbl }, 'Verified Hours'),
        ),
        React.createElement(View, { style: styles.stat },
          React.createElement(Text, { style: styles.statNum }, String(props.sessions.length)),
          React.createElement(Text, { style: styles.statLbl }, 'Sessions'),
        ),
      ),
      // Table header
      React.createElement(View, { style: styles.tableHeader },
        React.createElement(Text, { style: [styles.tableHeaderCell, { width: 60 }] }, 'DATE'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { flex: 1 }] }, 'ORGANIZATION'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { width: 35 }] }, 'HRS'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { width: 55 }] }, 'STATUS'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { flex: 1 }] }, 'VERIFIED BY'),
      ),
      // Session rows + signature blocks
      ...props.sessions.flatMap((s: any, i: number) => {
        const st = s.status === 'verified' ? 'Verified' : s.status === 'disputed' ? 'Disputed' : 'Pending';
        const stStyle = s.status === 'verified' ? styles.verified : s.status === 'disputed' ? styles.disputed : styles.pending;
        const orgName = s.org?.name ?? '';
        const qrDataUrl = props.qrCodes[s.id];

        const row = React.createElement(View, { key: `row-${i}`, style: styles.tableRow },
          React.createElement(Text, { style: [styles.cell, { width: 60 }] }, s.date ?? ''),
          React.createElement(Text, { style: [styles.cell, { flex: 1 }] }, orgName),
          React.createElement(Text, { style: [styles.cell, { width: 35 }] }, Number(s.hours).toFixed(1)),
          React.createElement(Text, { style: [stStyle, { width: 55 }] }, st),
          React.createElement(Text, { style: [styles.cell, { flex: 1 }] }, s.verified_by ?? s.supervisor_name ?? ''),
        );

        // Only add signature block if we have a QR code for this session
        if (!qrDataUrl) return [row];

        const sig = React.createElement(SignatureBlock, {
          key: `sig-${i}`,
          sessionId: s.id,
          supervisorName: s.supervisor_name ?? null,
          orgName,
          qrDataUrl,
        });

        return [row, sig];
      }),
      React.createElement(
        Text,
        { style: styles.footer },
        props.freeTier
          ? 'Generated by Merit Free · Upgrade at merit.app for full history'
          : 'Generated by Merit · merit.app',
      ),
    ),
  );
}

// ─── Grant Report PDF ─────────────────────────────────────────────────────

function GrantReportPdf(props: {
  chapterName: string;
  period: string;
  totalHours: number;
  verifiedHours: number;
  memberCount: number;
  sessions: any[];
}) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(View, { style: styles.header },
        React.createElement(Text, { style: styles.brand }, 'Merit'),
        React.createElement(Text, { style: styles.subtitle }, 'Grant Report'),
      ),
      React.createElement(View, { style: styles.divider }),
      React.createElement(Text, { style: styles.title }, props.chapterName),
      React.createElement(View, { style: styles.metaRow },
        React.createElement(Text, { style: styles.metaLabel }, `Period: ${props.period}`),
        React.createElement(Text, { style: styles.metaLabel }, `Generated: ${new Date().toLocaleDateString()}`),
      ),
      React.createElement(View, { style: styles.statBox },
        React.createElement(View, { style: styles.stat },
          React.createElement(Text, { style: styles.statNum }, props.totalHours.toFixed(1)),
          React.createElement(Text, { style: styles.statLbl }, 'Total Hours'),
        ),
        React.createElement(View, { style: styles.stat },
          React.createElement(Text, { style: styles.statNum }, props.verifiedHours.toFixed(1)),
          React.createElement(Text, { style: styles.statLbl }, 'Verified Hours'),
        ),
        React.createElement(View, { style: styles.stat },
          React.createElement(Text, { style: styles.statNum }, String(props.memberCount)),
          React.createElement(Text, { style: styles.statLbl }, 'Members'),
        ),
      ),
      React.createElement(View, { style: styles.tableHeader },
        React.createElement(Text, { style: [styles.tableHeaderCell, { width: 90 }] }, 'STUDENT'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { flex: 1 }] }, 'ORGANIZATION'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { width: 55 }] }, 'DATE'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { width: 35 }] }, 'HRS'),
        React.createElement(Text, { style: [styles.tableHeaderCell, { width: 55 }] }, 'STATUS'),
      ),
      ...props.sessions.map((s: any, i: number) => {
        const st = s.status === 'verified' ? 'Verified' : s.status === 'disputed' ? 'Disputed' : 'Pending';
        const stStyle = s.status === 'verified' ? styles.verified : s.status === 'disputed' ? styles.disputed : styles.pending;
        return React.createElement(View, { key: i, style: styles.tableRow },
          React.createElement(Text, { style: [styles.cell, { width: 90 }] }, s.studentName ?? ''),
          React.createElement(Text, { style: [styles.cell, { flex: 1 }] }, s.orgName ?? ''),
          React.createElement(Text, { style: [styles.cell, { width: 55 }] }, s.date ?? ''),
          React.createElement(Text, { style: [styles.cell, { width: 35 }] }, Number(s.hours).toFixed(1)),
          React.createElement(Text, { style: [stStyle, { width: 55 }] }, st),
        );
      }),
      React.createElement(Text, { style: styles.footer }, 'Generated by Merit · merit.app'),
    ),
  );
}

// ─── Storage helper ───────────────────────────────────────────────────────

async function uploadAndSign(buffer: Buffer, path: string): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from('exports')
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true });

  if (error) {
    logger.warn({ path }, 'storage_upload_failed — returning mock url');
    return `mock://exports/${path}`;
  }

  const { data: signed } = await supabaseAdmin.storage
    .from('exports')
    .createSignedUrl(path, 3600);

  return (signed as any)?.signedUrl ?? `mock://exports/${path}`;
}

// ─── QR code generation ───────────────────────────────────────────────────

async function generateQRCodes(sessions: any[]): Promise<Record<string, string>> {
  const qrCodes: Record<string, string> = {};
  await Promise.all(
    sessions.map(async (s) => {
      try {
        const url = `${VERIFY_BASE_URL}/${s.id}`;
        qrCodes[s.id] = await QRCode.toDataURL(url, {
          width: 80,
          margin: 1,
          color: { dark: '#0F172A', light: '#FFFFFF' },
        });
      } catch (err) {
        logger.warn({ sessionId: s.id, err }, 'qr_code_generation_failed');
      }
    }),
  );
  return qrCodes;
}

// ─── Public functions ─────────────────────────────────────────────────────

export async function exportSessionsPdf(
  userId: string,
  opts: { from?: string; to?: string; includeSelfReported?: boolean } = {},
): Promise<{ url: string; freeTierLimited?: boolean }> {
  const { data: user } = await supabaseAdmin
    .from('users').select('name, plan').eq('id', userId).maybeSingle();

  if (!user) throw new NotFoundError('User');
  const u = user as any;

  const plan = (u.plan ?? 'free') as Plan;
  const lookbackDays = PLAN_LIMITS[plan]?.pdf_lookback_days ?? 30;
  const isFreeTier = lookbackDays > 0; // 0 means unlimited

  // Enforce date lookback for free plan
  let effectiveFrom = opts.from;
  let freeTierLimited = false;
  if (isFreeTier) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    if (!opts.from || opts.from < cutoffStr) {
      effectiveFrom = cutoffStr;
      freeTierLimited = true;
    }
  }

  let query = supabaseAdmin
    .from('sessions')
    .select('id, date, hours, status, supervisor_name, supervisor_phone, supervisor_email, verified_by, org:organizations(name)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('date', { ascending: false });

  if (effectiveFrom) query = query.gte('date', effectiveFrom);
  if (opts.to)        query = query.lte('date', opts.to);

  const { data: sessions } = await query;
  let rows = (sessions as any[] | null) ?? [];

  // Self-reported = no supervisor contact info was provided
  if (!opts.includeSelfReported) {
    rows = rows.filter((r: any) => r.supervisor_phone || r.supervisor_email);
  }

  const totalHours = rows.reduce((s: number, r: any) => s + Number(r.hours), 0);
  const verifiedHours = rows.filter((r: any) => r.status === 'verified')
    .reduce((s: number, r: any) => s + Number(r.hours), 0);

  // Generate QR codes for all sessions
  const qrCodes = await generateQRCodes(rows);

  const element = SessionsPdf({
    userName: u.name,
    sessions: rows,
    totalHours,
    verifiedHours,
    freeTier: isFreeTier,
    qrCodes,
  });
  const buffer = await renderToBuffer(element);
  const url = await uploadAndSign(Buffer.from(buffer), `users/${userId}/sessions-${Date.now()}.pdf`);

  logger.info(
    { userId, plan, from: effectiveFrom, to: opts.to, includeSelfReported: opts.includeSelfReported, freeTierLimited },
    'sessions_pdf_exported',
  );
  return { url, freeTierLimited };
}

export async function exportGrantReportPdf(
  userId: string,
  opts: { from?: string; to?: string } = {},
): Promise<{ url: string }> {
  const { getGrantReport, getCoordinatorChapterId } = await import('./admin.service');
  const chapterId = await getCoordinatorChapterId(userId);
  const report = await getGrantReport(userId, opts);

  const element = GrantReportPdf(report as any);
  const buffer = await renderToBuffer(element);
  const url = await uploadAndSign(Buffer.from(buffer), `chapters/${chapterId}/grant-report-${Date.now()}.pdf`);

  logger.info({ userId, chapterId }, 'grant_report_pdf_exported');
  return { url };
}
