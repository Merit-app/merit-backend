import * as React from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../lib/logger';

// ── Grant Report PDF ──────────────────────────────────────────────────────────

export async function generateGrantReport(params: {
  orgId: string;
  from: string;
  to: string;
}) {
  const { orgId, from, to } = params;

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, category, city, logo_url, website_url, contact_email')
    .eq('id', orgId)
    .single();

  if (!org) throw new Error('Organization not found');

  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select(`
      date, hours, activity, status,
      users!sessions_user_id_fkey (id, name, school, grade)
    `)
    .eq('org_id', orgId)
    .eq('status', 'verified')
    .is('deleted_at', null)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false });

  const allSessions: any[] = sessions ?? [];

  const uniqueVolunteers = new Set(
    allSessions.map((s) => s.users?.id).filter(Boolean),
  );
  const totalHours = allSessions.reduce((sum, s) => sum + (s.hours ?? 0), 0);

  // Program breakdown
  const programMap = new Map<string, { hours: number; volunteers: Set<string> }>();
  for (const s of allSessions) {
    const prog = s.activity ?? 'General Volunteering';
    const userId = s.users?.id;
    if (!programMap.has(prog)) programMap.set(prog, { hours: 0, volunteers: new Set() });
    const entry = programMap.get(prog)!;
    entry.hours += s.hours ?? 0;
    if (userId) entry.volunteers.add(userId);
  }

  // Top volunteers
  const volunteerMap = new Map<string, { name: string; hours: number }>();
  for (const s of allSessions) {
    const user = s.users;
    if (!user?.id) continue;
    const existing = volunteerMap.get(user.id);
    if (existing) {
      existing.hours += s.hours ?? 0;
    } else {
      volunteerMap.set(user.id, { name: user.name, hours: s.hours ?? 0 });
    }
  }

  const topVolunteers = Array.from(volunteerMap.values())
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  const programs = Array.from(programMap.entries())
    .map(([name, data]) => ({ name, hours: data.hours, volunteers: data.volunteers.size }))
    .sort((a, b) => b.hours - a.hours);

  const styles = StyleSheet.create({
    page: { padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#1a1a1a' },
    header: { borderBottom: '2px solid #1a1a1a', paddingBottom: 16, marginBottom: 24 },
    orgName: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
    orgSub: { fontSize: 10, color: '#666', marginBottom: 2 },
    reportTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
    dateRange: { fontSize: 10, color: '#666' },
    sectionTitle: {
      fontSize: 12, fontFamily: 'Helvetica-Bold',
      marginTop: 24, marginBottom: 12,
      borderBottom: '1px solid #e5e5e5', paddingBottom: 6,
    },
    statRow: { flexDirection: 'row', gap: 16, marginBottom: 20 },
    statBox: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 6, padding: 12 },
    statValue: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: '#1a1a1a' },
    statLabel: { fontSize: 9, color: '#666', marginTop: 2 },
    tableHeader: {
      flexDirection: 'row', backgroundColor: '#1a1a1a',
      color: '#fff', padding: '6 10', borderRadius: '4 4 0 0',
    },
    tableRow: { flexDirection: 'row', borderBottom: '1px solid #f0f0f0', padding: '6 10' },
    tableRowAlt: {
      flexDirection: 'row', backgroundColor: '#fafafa',
      borderBottom: '1px solid #f0f0f0', padding: '6 10',
    },
    col1: { flex: 3 },
    col2: { flex: 1, textAlign: 'right' },
    col3: { flex: 1, textAlign: 'right' },
    footer: {
      position: 'absolute', bottom: 40, left: 48, right: 48,
      borderTop: '1px solid #e5e5e5', paddingTop: 12,
      flexDirection: 'row', justifyContent: 'space-between',
    },
    footerText: { fontSize: 8, color: '#999' },
    verifyBox: {
      marginTop: 24, padding: 16,
      border: '1px solid #e5e5e5', borderRadius: 6, backgroundColor: '#fafafa',
    },
    verifyText: { fontSize: 9, color: '#666', lineHeight: 1.5 },
  });

  const fromDate = new Date(from).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const toDate = new Date(to).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const stats = [
    { value: uniqueVolunteers.size.toString(), label: 'Total Volunteers' },
    { value: `${totalHours}h`, label: 'Total Verified Hours' },
    { value: allSessions.length.toString(), label: 'Total Sessions' },
    {
      value: uniqueVolunteers.size > 0
        ? (totalHours / uniqueVolunteers.size).toFixed(1) + 'h'
        : '0h',
      label: 'Avg Hours/Volunteer',
    },
  ];

  const GrantReportDoc = () =>
    React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: 'LETTER', style: styles.page },
        // Header
        React.createElement(
          View,
          { style: styles.header },
          React.createElement(Text, { style: styles.orgName }, org.name),
          org.city
            ? React.createElement(Text, { style: styles.orgSub }, org.city)
            : null,
          org.website_url
            ? React.createElement(Text, { style: styles.orgSub }, org.website_url)
            : null,
          React.createElement(
            Text,
            { style: styles.reportTitle },
            'VOLUNTEER IMPACT REPORT',
          ),
          React.createElement(
            Text,
            { style: styles.dateRange },
            `${fromDate} – ${toDate}`,
          ),
        ),
        // Summary stats
        React.createElement(Text, { style: styles.sectionTitle }, 'SUMMARY'),
        React.createElement(
          View,
          { style: styles.statRow },
          ...stats.map((stat) =>
            React.createElement(
              View,
              { style: styles.statBox },
              React.createElement(Text, { style: styles.statValue }, stat.value),
              React.createElement(Text, { style: styles.statLabel }, stat.label),
            ),
          ),
        ),
        // Program breakdown
        programs.length > 0
          ? React.createElement(
              View,
              null,
              React.createElement(
                Text,
                { style: styles.sectionTitle },
                'PROGRAM BREAKDOWN',
              ),
              React.createElement(
                View,
                { style: styles.tableHeader },
                React.createElement(
                  Text,
                  { style: styles.col1 },
                  'Activity / Program',
                ),
                React.createElement(Text, { style: styles.col2 }, 'Volunteers'),
                React.createElement(Text, { style: styles.col3 }, 'Hours'),
              ),
              ...programs.map((prog, i) =>
                React.createElement(
                  View,
                  { style: i % 2 === 0 ? styles.tableRow : styles.tableRowAlt },
                  React.createElement(Text, { style: styles.col1 }, prog.name),
                  React.createElement(
                    Text,
                    { style: styles.col2 },
                    prog.volunteers.toString(),
                  ),
                  React.createElement(
                    Text,
                    { style: styles.col3 },
                    `${prog.hours}h`,
                  ),
                ),
              ),
            )
          : null,
        // Top volunteers
        topVolunteers.length > 0
          ? React.createElement(
              View,
              null,
              React.createElement(
                Text,
                { style: styles.sectionTitle },
                'TOP VOLUNTEERS',
              ),
              React.createElement(
                View,
                { style: styles.tableHeader },
                React.createElement(Text, { style: { flex: 3 } }, 'Volunteer'),
                React.createElement(
                  Text,
                  { style: styles.col2 },
                  'Verified Hours',
                ),
              ),
              ...topVolunteers.map((v, i) =>
                React.createElement(
                  View,
                  { style: i % 2 === 0 ? styles.tableRow : styles.tableRowAlt },
                  React.createElement(Text, { style: { flex: 3 } }, v.name),
                  React.createElement(
                    Text,
                    { style: styles.col2 },
                    `${v.hours}h`,
                  ),
                ),
              ),
            )
          : null,
        // Verification statement
        React.createElement(
          View,
          { style: styles.verifyBox },
          React.createElement(
            Text,
            { style: styles.verifyText },
            'All volunteer hours in this report have been independently ' +
              "verified through Merit's SMS supervisor verification system. " +
              'Each session was confirmed by a supervising coordinator via ' +
              'text message response. Records are permanently stored and ' +
              'can be independently verified at meritco.app.',
          ),
        ),
        // Footer
        React.createElement(
          View,
          { style: styles.footer },
          React.createElement(
            Text,
            { style: styles.footerText },
            `Generated by Merit · ${new Date().toLocaleDateString('en-CA')}`,
          ),
          React.createElement(Text, { style: styles.footerText }, 'meritco.app'),
        ),
      ),
    );

  const instance = pdf(React.createElement(GrantReportDoc, null) as any);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Volunteer Certificate PDF ─────────────────────────────────────────────────

export async function generateVolunteerCertificate(params: {
  orgId: string;
  userId: string;
  coordinatorName: string;
}) {
  const { orgId, userId, coordinatorName } = params;

  const [orgResult, userResult, sessionsResult] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('name, city, logo_url, contact_email')
      .eq('id', orgId)
      .single(),
    supabaseAdmin
      .from('users')
      .select('name, school, grade, created_at')
      .eq('id', userId)
      .single(),
    supabaseAdmin
      .from('sessions')
      .select('date, hours, activity, status')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('status', 'verified')
      .is('deleted_at', null)
      .order('date', { ascending: true }),
  ]);

  const org = orgResult.data;
  const volunteer = userResult.data;
  const sessions: any[] = sessionsResult.data ?? [];

  if (!org || !volunteer) throw new Error('Not found');

  const totalHours = sessions.reduce((sum, s) => sum + (s.hours ?? 0), 0);
  const firstDate = sessions[0]?.date;
  const lastDate = sessions[sessions.length - 1]?.date;
  const activities = [...new Set(sessions.map((s) => s.activity))].join(', ');

  const styles = StyleSheet.create({
    page: { padding: 60, fontFamily: 'Helvetica' },
    border: { border: '3px solid #1a1a1a', padding: 40, height: '100%' },
    inner: {
      border: '1px solid #999', padding: 32,
      height: '100%', alignItems: 'center',
    },
    orgName: {
      fontSize: 13, fontFamily: 'Helvetica-Bold',
      color: '#666', letterSpacing: 3,
      textTransform: 'uppercase', marginBottom: 8, textAlign: 'center',
    },
    certTitle: {
      fontSize: 32, fontFamily: 'Helvetica-Bold',
      marginBottom: 8, color: '#1a1a1a', textAlign: 'center',
    },
    certSubtitle: { fontSize: 12, color: '#666', marginBottom: 32, textAlign: 'center' },
    volunteerName: {
      fontSize: 28, fontFamily: 'Helvetica-Bold',
      color: '#1a1a1a', marginBottom: 8, textAlign: 'center',
    },
    divider: { width: 80, height: 2, backgroundColor: '#1a1a1a', marginVertical: 16 },
    bodyText: {
      fontSize: 11, color: '#333', textAlign: 'center',
      lineHeight: 1.6, maxWidth: 380, marginBottom: 8,
    },
    hoursBox: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: '12 24', marginVertical: 20 },
    hoursText: { fontSize: 36, fontFamily: 'Helvetica-Bold', color: '#fff', textAlign: 'center' },
    hoursLabel: { fontSize: 10, color: '#ccc', textAlign: 'center', letterSpacing: 2 },
    sigRow: { flexDirection: 'row', width: '100%', marginTop: 40, justifyContent: 'space-between' },
    sigBox: { alignItems: 'center', width: '45%' },
    sigLine: { width: '100%', height: 1, backgroundColor: '#1a1a1a', marginBottom: 6 },
    sigName: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
    sigLabel: { fontSize: 9, color: '#666', textAlign: 'center' },
    footer: {
      marginTop: 24, flexDirection: 'row',
      justifyContent: 'space-between', width: '100%',
    },
    footerText: { fontSize: 8, color: '#999' },
  });

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

  const issuedOn = new Date().toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const CertDoc = () =>
    React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: 'LETTER', orientation: 'landscape', style: styles.page },
        React.createElement(
          View,
          { style: styles.border },
          React.createElement(
            View,
            { style: styles.inner },
            React.createElement(Text, { style: styles.orgName }, org.name),
            React.createElement(
              Text,
              { style: styles.certTitle },
              'Certificate of Recognition',
            ),
            React.createElement(
              Text,
              { style: styles.certSubtitle },
              'This certifies that',
            ),
            React.createElement(
              Text,
              { style: styles.volunteerName },
              volunteer.name,
            ),
            React.createElement(View, { style: styles.divider }),
            React.createElement(
              Text,
              { style: styles.bodyText },
              'has demonstrated outstanding commitment through verified volunteer ' +
                `service with ${org.name}${org.city ? ` in ${org.city}` : ''}.`,
            ),
            React.createElement(
              View,
              { style: styles.hoursBox },
              React.createElement(
                Text,
                { style: styles.hoursText },
                `${totalHours}h`,
              ),
              React.createElement(
                Text,
                { style: styles.hoursLabel },
                'VERIFIED VOLUNTEER HOURS',
              ),
            ),
            firstDate && lastDate
              ? React.createElement(
                  Text,
                  { style: styles.bodyText },
                  `Service period: ${formatDate(firstDate)} – ${formatDate(lastDate)}`,
                )
              : null,
            activities
              ? React.createElement(
                  Text,
                  { style: styles.bodyText },
                  `Activities: ${activities}`,
                )
              : null,
            React.createElement(
              View,
              { style: styles.sigRow },
              React.createElement(
                View,
                { style: styles.sigBox },
                React.createElement(View, { style: styles.sigLine }),
                React.createElement(
                  Text,
                  { style: styles.sigName },
                  coordinatorName,
                ),
                React.createElement(
                  Text,
                  { style: styles.sigLabel },
                  'Coordinator Signature',
                ),
              ),
              React.createElement(
                View,
                { style: styles.sigBox },
                React.createElement(View, { style: styles.sigLine }),
                React.createElement(Text, { style: styles.sigName }, issuedOn),
                React.createElement(
                  Text,
                  { style: styles.sigLabel },
                  'Date of Issue',
                ),
              ),
            ),
            React.createElement(
              View,
              { style: styles.footer },
              React.createElement(
                Text,
                { style: styles.footerText },
                'All hours verified via Merit SMS verification system',
              ),
              React.createElement(
                Text,
                { style: styles.footerText },
                'meritco.app',
              ),
            ),
          ),
        ),
      ),
    );

  const instance = pdf(React.createElement(CertDoc, null) as any);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
