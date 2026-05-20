import * as React from 'react';
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { supabaseAdmin } from '../config/supabase';
import { NotFoundError, AppError } from '../lib/errors';
import { logger } from '../lib/logger';

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
});

// ─── Sessions PDF ─────────────────────────────────────────────────────────

function SessionsPdf(props: {
  userName: string;
  sessions: any[];
  totalHours: number;
  verifiedHours: number;
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
      // Rows
      ...props.sessions.map((s: any, i: number) => {
        const st = s.status === 'verified' ? 'Verified' : s.status === 'disputed' ? 'Disputed' : 'Pending';
        const stStyle = s.status === 'verified' ? styles.verified : s.status === 'disputed' ? styles.disputed : styles.pending;
        return React.createElement(View, { key: i, style: styles.tableRow },
          React.createElement(Text, { style: [styles.cell, { width: 60 }] }, s.date ?? ''),
          React.createElement(Text, { style: [styles.cell, { flex: 1 }] }, s.org?.name ?? ''),
          React.createElement(Text, { style: [styles.cell, { width: 35 }] }, Number(s.hours).toFixed(1)),
          React.createElement(Text, { style: [stStyle, { width: 55 }] }, st),
          React.createElement(Text, { style: [styles.cell, { flex: 1 }] }, s.verified_by ?? s.supervisor_name ?? ''),
        );
      }),
      React.createElement(Text, { style: styles.footer }, 'Generated by Merit · merit.app'),
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

// ─── Public functions ─────────────────────────────────────────────────────

export async function exportSessionsPdf(userId: string): Promise<{ url: string }> {
  const { data: user } = await supabaseAdmin
    .from('users').select('name, plan').eq('id', userId).maybeSingle();

  if (!user) throw new NotFoundError('User');
  const u = user as any;

  if (!['pro', 'premium', 'institutional'].includes(u.plan)) {
    throw new AppError('plan_required', 'PDF export requires a Pro plan or higher.', 403);
  }

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('date, hours, status, supervisor_name, verified_by, org:organizations(name)')
    .eq('user_id', userId).is('deleted_at', null).order('date', { ascending: false });

  const rows = (sessions as any[] | null) ?? [];
  const totalHours = rows.reduce((s: number, r: any) => s + Number(r.hours), 0);
  const verifiedHours = rows.filter((r: any) => r.status === 'verified')
    .reduce((s: number, r: any) => s + Number(r.hours), 0);

  const element = SessionsPdf({ userName: u.name, sessions: rows, totalHours, verifiedHours });
  const buffer = await renderToBuffer(element);
  const url = await uploadAndSign(Buffer.from(buffer), `users/${userId}/sessions-${Date.now()}.pdf`);

  logger.info({ userId }, 'sessions_pdf_exported');
  return { url };
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
