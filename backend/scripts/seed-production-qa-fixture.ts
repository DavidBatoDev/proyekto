/**
 * One-time/idempotent seed for the production billing QA fixture.
 *
 * Run from backend/ only with explicit production confirmation. The script
 * uses service-role access; the recurring verifier never receives that key.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

loadEnv();

const fixtureKey = process.env.QA_FIXTURE_KEY ?? 'billing-v1';
const projectId = stableUuid(`${fixtureKey}:project`);
const primaryTeamId = stableUuid(`${fixtureKey}:primary-team`);
const secondaryTeamId = stableUuid(`${fixtureKey}:secondary-team`);
const contractId = stableUuid(`${fixtureKey}:contract`);

async function main(): Promise<void> {
  const qaTarget = process.env.QA_TARGET ?? 'production';
  if (!['production', 'development'].includes(qaTarget)) {
    throw new Error(`Unknown QA_TARGET: ${qaTarget}.`);
  }
  if (process.env.CONFIRM_PRODUCTION_QA !== `proyekto-${qaTarget}`) {
    throw new Error(
      `Refusing to seed: set CONFIRM_PRODUCTION_QA=proyekto-${qaTarget}.`,
    );
  }
  const supabaseUrl = must('SUPABASE_URL');
  const supabaseHost = new URL(supabaseUrl).hostname;
  const expectedHost =
    qaTarget === 'production'
      ? 'byvbnkpiselvvulsvxgo.supabase.co'
      : 'vyiedlwasdwmjbztqznl.supabase.co';
  if (supabaseHost !== expectedHost) {
    throw new Error(
      `Refusing ${qaTarget} seed against Supabase host ${supabaseHost}.`,
    );
  }
  const db = createClient(supabaseUrl, must('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const consultant = await ensureUser(
    db,
    must('QA_CONSULTANT_EMAIL'),
    must('QA_CONSULTANT_PASSWORD'),
    '[QA] Billing Consultant',
  );
  const worker = await ensureUser(
    db,
    must('QA_WORKER_EMAIL'),
    must('QA_WORKER_PASSWORD'),
    '[QA] Billing Worker',
  );
  const client = await ensureUser(
    db,
    must('QA_CLIENT_EMAIL'),
    must('QA_CLIENT_PASSWORD'),
    '[QA] Billing Client',
  );

  await upsert(
    db,
    'consultant_profiles',
    {
      user_id: consultant.id,
      status: 'verified',
      verified_at: new Date().toISOString(),
      suspended_at: null,
      revoked_at: null,
      status_reason: 'Dedicated production QA fixture',
    },
    'user_id',
  );

  await upsert(
    db,
    'projects',
    {
      id: projectId,
      title: '[QA] Billing Verification',
      owner_id: client.id,
      status: 'active',
      currency: 'USD',
    },
    'id',
  );

  for (const [id, name] of [
    [primaryTeamId, '[QA] Billing Verification — Primary'],
    [secondaryTeamId, '[QA] Billing Verification — Secondary'],
  ] as const) {
    await upsert(
      db,
      'teams',
      {
        id,
        owner_id: consultant.id,
        name,
        description:
          'Synthetic production QA fixture. Do not use for client work.',
        time_tracking_enabled: true,
        retroactive_log_days: 30,
        default_currency: 'USD',
        legal_name: '[QA] Proyekto Verification',
        billing_email: consultant.email,
      },
      'id',
    );

    await upsert(
      db,
      'team_members',
      {
        id: stableUuid(`${fixtureKey}:${id}:${consultant.id}:member`),
        team_id: id,
        user_id: consultant.id,
        role: 'owner',
      },
      'team_id,user_id',
    );
    await upsert(
      db,
      'team_members',
      {
        id: stableUuid(`${fixtureKey}:${id}:${worker.id}:member`),
        team_id: id,
        user_id: worker.id,
        role: 'member',
      },
      'team_id,user_id',
    );
  }

  await upsert(
    db,
    'project_teams',
    {
      project_id: projectId,
      team_id: primaryTeamId,
      is_primary: true,
      attached_by: consultant.id,
    },
    'project_id,team_id',
  );
  await upsert(
    db,
    'project_teams',
    {
      project_id: projectId,
      team_id: secondaryTeamId,
      is_primary: false,
      attached_by: consultant.id,
    },
    'project_id,team_id',
  );

  for (const teamId of [primaryTeamId, secondaryTeamId]) {
    await upsert(
      db,
      'project_team_members',
      {
        project_id: projectId,
        team_id: teamId,
        user_id: worker.id,
        added_by: consultant.id,
      },
      'project_id,team_id,user_id',
    );
    await upsert(
      db,
      'team_member_rates',
      {
        id: stableUuid(`${fixtureKey}:${teamId}:${worker.id}:rate`),
        team_id: teamId,
        user_id: worker.id,
        project_id: projectId,
        rate_type: 'hourly',
        hourly_rate: 40,
        training_hourly_rate: 40,
        currency: 'USD',
        start_date: '2026-01-01',
        end_date: null,
      },
      'id',
    );
  }

  await upsert(
    db,
    'project_access',
    {
      project_id: projectId,
      user_id: consultant.id,
      role: 'owner',
      origin: 'consultant',
      capabilities: {},
      has_direct_grant: true,
      granted_by: consultant.id,
    },
    'project_id,user_id',
  );
  await upsert(
    db,
    'project_access',
    {
      project_id: projectId,
      user_id: client.id,
      role: 'owner',
      origin: 'client',
      capabilities: {},
      has_direct_grant: true,
      granted_by: consultant.id,
    },
    'project_id,user_id',
  );
  await upsert(
    db,
    'project_access',
    {
      project_id: projectId,
      user_id: worker.id,
      role: 'editor',
      origin: 'direct',
      capabilities: {},
      has_direct_grant: true,
      granted_by: consultant.id,
    },
    'project_id,user_id',
  );

  const year = new Date().getUTCFullYear();
  const signedAt = new Date().toISOString();
  await upsert(
    db,
    'contracts',
    {
      id: contractId,
      project_id: projectId,
      version: 1,
      contract_number: 'QA-BILLING-001',
      status: 'active',
      provider_kind: 'agency',
      provider_name: '[QA] Proyekto Verification',
      provider_email: consultant.email,
      client_name: '[QA] Billing Client',
      client_contact_name: '[QA] Client',
      client_email: client.email,
      client_user_id: client.id,
      consultant_user_id: consultant.id,
      currency: 'USD',
      billing_mode: 'time_based',
      billing_timing: 'arrears',
      client_hourly_rate: 100,
      recurring_fee: null,
      included_hours: null,
      invoice_cadence: 'monthly',
      period_source: 'contract',
      due_days: 15,
      invoice_offset_days: 0,
      invoice_number_prefix: 'QA',
      service_description: 'Synthetic production billing verification',
      service_start_date: `${year}-01-01`,
      service_end_date: `${year}-12-31`,
      contract_end_date: `${year}-12-31`,
      term_count: 1,
      term_unit: 'year',
      auto_renew: false,
      signed_by_consultant_at: signedAt,
      signed_by_consultant_name: '[QA] Billing Consultant',
      signed_by_client_at: signedAt,
      signed_by_client_name: '[QA] Billing Client',
      created_by: consultant.id,
    },
    'id',
  );

  for (const email of [consultant.email, worker.email, client.email]) {
    await upsert(
      db,
      'email_suppressions',
      {
        email: email.toLowerCase(),
        reason: 'manual',
        detail: `Production QA fixture ${fixtureKey}`,
      },
      'email',
    );
  }

  await upsert(
    db,
    'qa_fixtures',
    {
      key: fixtureKey,
      project_id: projectId,
      contract_id: contractId,
      consultant_user_id: consultant.id,
      worker_user_id: worker.id,
      client_user_id: client.id,
      primary_team_id: primaryTeamId,
      secondary_team_id: secondaryTeamId,
    },
    'key',
  );

  const { error: resetError } = await db.rpc('reset_qa_fixture', {
    p_key: fixtureKey,
    p_mark_success: false,
  });
  if (resetError)
    throw new Error(`Fixture reset failed: ${resetError.message}`);
  process.stdout.write(`Seeded production QA fixture ${fixtureKey}.\n`);
}

async function ensureUser(
  db: SupabaseClient,
  email: string,
  password: string,
  displayName: string,
): Promise<User & { email: string }> {
  let page = 1;
  let user: User | undefined;
  do {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
    );
    if (user || data.users.length < 1000) break;
    page += 1;
  } while (!user);

  if (!user) {
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (created.error || !created.data.user) {
      throw new Error(`Could not create ${email}: ${created.error?.message}`);
    }
    user = created.data.user;
  } else {
    const updated = await db.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { ...user.user_metadata, display_name: displayName },
    });
    if (updated.error)
      throw new Error(`Could not update ${email}: ${updated.error.message}`);
  }

  await upsert(
    db,
    'profiles',
    {
      id: user.id,
      email: email.toLowerCase(),
      display_name: displayName,
    },
    'id',
  );
  return { ...user, email: email.toLowerCase() } as User & { email: string };
}

async function upsert(
  db: SupabaseClient,
  table: string,
  value: Record<string, unknown>,
  onConflict: string,
): Promise<void> {
  const { error } = await db.from(table).upsert(value, { onConflict });
  if (error) throw new Error(`${table} upsert failed: ${error.message}`);
}

function must(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function stableUuid(value: string): string {
  const hex = createHash('sha256').update(`proyekto-qa:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function loadEnv(): void {
  for (const candidate of ['.env', '../.env']) {
    const path = resolve(process.cwd(), candidate);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    break;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
