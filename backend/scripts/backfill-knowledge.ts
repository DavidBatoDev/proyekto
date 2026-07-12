/**
 * Backfill historical rows into ai_knowledge_outbox so the ingest worker
 * indexes them. Run from backend/ with .env present:
 *
 *   npx ts-node scripts/backfill-knowledge.ts \
 *     --source=chat_message,task_comment,activity_log,brief,memory \
 *     [--project=<uuid>] [--dry-run]
 *
 * Idempotent: re-running enqueues duplicate outbox rows that process into
 * identical chunk sets (the worker delete-then-inserts per source).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Minimal .env loader (dotenv is not a direct backend dependency).
for (const candidate of ['.env', '../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, name, rawValue] = match;
    if (process.env[name] !== undefined) continue;
    process.env[name] = rawValue.replace(/^["']|["']$/g, '');
  }
  break;
}

const PAGE_SIZE = 1000;
const VALID_SOURCES = [
  'chat_message',
  'task_comment',
  'activity_log',
  'brief',
  'memory',
] as const;
type Source = (typeof VALID_SOURCES)[number];

interface Args {
  sources: Source[];
  projectId: string | null;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let sources: Source[] = [...VALID_SOURCES];
  let projectId: string | null = null;
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--source=')) {
      const requested = arg
        .slice('--source='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = requested.filter(
        (s) => !VALID_SOURCES.includes(s as Source),
      );
      if (invalid.length) {
        throw new Error(`Invalid --source value(s): ${invalid.join(', ')}`);
      }
      sources = requested as Source[];
    } else if (arg.startsWith('--project=')) {
      projectId = arg.slice('--project='.length).trim() || null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { sources, projectId, dryRun };
}

interface Candidate {
  source_type: Source;
  source_id: string;
  project_id: string | null;
}

async function* pageCandidates(
  db: SupabaseClient,
  source: Source,
  projectId: string | null,
): AsyncGenerator<Candidate[]> {
  let offset = 0;
  for (;;) {
    let rows: Candidate[] = [];
    if (source === 'chat_message') {
      let query = db
        .from('chat_room_messages')
        .select('id, project_id')
        .is('deleted_at', null)
        .not('project_id', 'is', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows = (data ?? []).map((row) => ({
        source_type: source,
        source_id: row.id as string,
        project_id: (row.project_id as string) ?? null,
      }));
    } else if (source === 'task_comment') {
      // Project filtering happens in the worker via the task→roadmap chain;
      // a --project run still enqueues all comments (worker skips others).
      const { data, error } = await db
        .from('task_comments')
        .select('id')
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      rows = (data ?? []).map((row) => ({
        source_type: source,
        source_id: row.id as string,
        project_id: null,
      }));
    } else if (source === 'activity_log') {
      let query = db
        .from('project_activity_log')
        .select('id, project_id')
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows = (data ?? []).map((row) => ({
        source_type: source,
        source_id: row.id as string,
        project_id: (row.project_id as string) ?? null,
      }));
    } else if (source === 'brief') {
      let query = db
        .from('project_briefs')
        .select('id, project_id, version')
        .order('project_id', { ascending: true })
        .order('version', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      // Latest brief per project only.
      const seen = new Set<string>();
      rows = (data ?? [])
        .filter((row) => {
          const pid = row.project_id as string;
          if (seen.has(pid)) return false;
          seen.add(pid);
          return true;
        })
        .map((row) => ({
          source_type: source,
          source_id: row.id as string,
          project_id: (row.project_id as string) ?? null,
        }));
    } else {
      // memory: only rows still missing an embedding.
      let query = db
        .from('roadmap_ai_memories')
        .select('id, project_id')
        .eq('is_active', true)
        .is('embedding', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows = (data ?? []).map((row) => ({
        source_type: source,
        source_id: row.id as string,
        project_id: (row.project_id as string) ?? null,
      }));
    }

    if (rows.length > 0) yield rows;
    if (rows.length < PAGE_SIZE) return;
    offset += PAGE_SIZE;
  }
}

async function main(): Promise<void> {
  const { sources, projectId, dryRun } = parseArgs();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  for (const source of sources) {
    let total = 0;
    for await (const page of pageCandidates(db, source, projectId)) {
      total += page.length;
      if (dryRun) continue;
      const { error } = await db.from('ai_knowledge_outbox').insert(
        page.map((candidate) => ({
          source_type: candidate.source_type,
          source_id: candidate.source_id,
          project_id: candidate.project_id,
          op: 'upsert',
        })),
      );
      if (error) throw new Error(error.message);
    }
    console.log(
      `${dryRun ? '[dry-run] ' : ''}${source}: ${total} row(s) ${
        dryRun ? 'would be' : ''
      } enqueued`.replace('  ', ' '),
    );
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message ?? err);
  process.exit(1);
});
