import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PHASE2_TABLES = ['app_profiles', 'welcome_email_log'] as const;

const PHASE3_TABLES = [
  'roles',
  'terms',
  'requesters',
  'categories',
  'policy_documents',
  'policy_version_history',
  'knowledge_articles',
  'policy_article_links',
  'tickets',
  'ticket_policy_links',
  'ticket_article_links',
  'ticket_lifecycle_events',
  'messages',
  'assignments',
  'slas',
  'resolution_feedbacks',
  'ai_retrieval_logs',
  'workspace_notifications',
] as const;

interface TableProbeResult {
  table: string;
  phase: 'Phase 2' | 'Phase 3';
  existsInRemoteDb: boolean;
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
  remoteRowCount: number | null;
}

async function main() {
  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://llotsqzeppiltosllxvx.supabase.co'
  ).trim();
  const supabaseKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY environment variables.'
    );
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: TableProbeResult[] = [];

  for (const table of [...PHASE2_TABLES, ...PHASE3_TABLES]) {
    const phase = (PHASE2_TABLES as readonly string[]).includes(table)
      ? 'Phase 2'
      : 'Phase 3';
    const probe = await client
      .from(table)
      .select('*', { count: 'exact' })
      .limit(1);

    const exists =
      probe.status !== 404 &&
      probe.error?.code !== 'PGRST205' &&
      probe.error?.code !== '42P01';

    results.push({
      table: `public.${table}`,
      phase,
      existsInRemoteDb: exists,
      httpStatus: probe.status,
      errorCode: probe.error?.code ?? null,
      errorMessage: probe.error?.message ?? null,
      remoteRowCount: exists ? (probe.count ?? probe.data?.length ?? 0) : null,
    });
  }

  const missingPhase3Tables = results
    .filter((r) => r.phase === 'Phase 3' && !r.existsInRemoteDb)
    .map((r) => r.table);

  // Read local generated dataset summary for explicit comparison
  const summaryPath = path.resolve(
    process.cwd(),
    'datasets',
    'seed_summary_and_checksums.json'
  );
  let localGeneratedCounts: Record<string, number> | null = null;
  if (fs.existsSync(summaryPath)) {
    const parsed = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    localGeneratedCounts = parsed.fullScaleRowCounts || null;
  }

  const report = {
    auditedAt: new Date().toISOString(),
    remoteSupabaseUrl: supabaseUrl,
    usingServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    phase2MigrationApplied: results
      .filter((r) => r.phase === 'Phase 2')
      .every((r) => r.existsInRemoteDb),
    phase3MigrationApplied: missingPhase3Tables.length === 0,
    phase3MigrationFile:
      'supabase/migrations/20261030000002_phase3_complete_domain_and_workflow.sql',
    missingPhase3SchemaObjects:
      missingPhase3Tables.length > 0
        ? [
            ...missingPhase3Tables,
            'public.current_app_profile_id()',
            'public.current_app_actor_role()',
          ]
        : [],
    remoteTableAudit: results,
    localDatasetFileCounts: localGeneratedCounts,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[Remote Supabase Audit Error]:', err);
  process.exit(1);
});
