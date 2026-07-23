/**
 * Real-DB integration harness for the Phase 0 authorization gaps.
 *
 * Boots the actual AppModule (real guards, services, repositories, Supabase and
 * Redis) and drives it over HTTP with supertest, against the live SG project the
 * backend/.env points at. Two side-effecting providers are replaced with no-ops
 * so a test never publishes realtime events or enqueues knowledge embeddings for
 * throwaway fixture data — everything else is real, including the database.
 *
 * Fixtures are created via the service-role client (bypasses RLS), namespaced by
 * a per-run id, and every created row + auth user is torn down in afterAll
 * (LIFO, best-effort). Never part of `npm test` — run explicitly with
 * `npm run test:integration`.
 */
import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { CachePolicyInterceptor } from '../../src/common/interceptors/cache-policy.interceptor';
import { RequestLoggingInterceptor } from '../../src/common/interceptors/request-logging.interceptor';
import { RequestTimeoutInterceptor } from '../../src/common/interceptors/request-timeout.interceptor';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { RealtimePublisher } from '../../src/modules/realtime/realtime-publisher.service';
import { KnowledgeOutboxService } from '../../src/modules/knowledge/knowledge-outbox.service';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[integration] missing ${name} — set it in backend/.env before running ` +
        'the integration suite.',
    );
  }
  return value;
}

/** Explicit no-op stubs for the two side-effecting providers. Explicit (not a
 * catch-all Proxy) so DI lifecycle/thenable probes can't misfire on them. */
const realtimeStub = {
  publishRoadmapChange: () => undefined,
  publishChatEvent: () => undefined,
} as unknown;
const knowledgeOutboxStub = { enqueue: () => undefined } as unknown;

type RoleName = 'viewer' | 'commenter' | 'editor' | 'admin' | 'owner';

interface SeededUser {
  id: string;
  email: string;
  token: string;
}

export class Harness {
  readonly runId = randomUUID().slice(0, 8);
  readonly admin: SupabaseClient;
  private readonly url: string;
  private readonly anonKey: string;
  private readonly jwtSecret: string;

  app!: INestApplication;

  /** LIFO row cleanup: {table,id} deleted newest-first in teardown. */
  private readonly rows: Array<{ table: string; id: string }> = [];
  private readonly userIds: string[] = [];

  constructor() {
    this.url = requireEnv('SUPABASE_URL');
    this.anonKey = requireEnv('SUPABASE_ANON_KEY');
    this.jwtSecret = requireEnv('SUPABASE_JWT_SECRET');
    requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    this.admin = createClient(
      this.url,
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async boot(): Promise<void> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RealtimePublisher)
      .useValue(realtimeStub)
      .overrideProvider(KnowledgeOutboxService)
      .useValue(knowledgeOutboxStub)
      .compile();

    const app = moduleRef.createNestApplication();
    // Mirror the production request pipeline (src/main.ts) so route prefixes,
    // validation, the {data} envelope, and error shapes match prod exactly.
    app.setGlobalPrefix('api', {
      exclude: [
        { path: '/', method: RequestMethod.GET },
        { path: 'mcp', method: RequestMethod.ALL },
      ],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    const reflector = app.get(Reflector);
    app.useGlobalInterceptors(
      new RequestTimeoutInterceptor(25000),
      new RequestLoggingInterceptor(1500),
      new CachePolicyInterceptor(reflector),
      new ResponseInterceptor(reflector),
    );
    await app.init();
    this.app = app;
  }

  server() {
    return this.app.getHttpServer();
  }

  /** Mint a Supabase-style HS256 access token the SupabaseAuthGuard verifies
   * locally (no network) — signed with the project's real JWT secret. */
  mintToken(userId: string, email: string): string {
    return jwt.sign(
      { sub: userId, email, role: 'authenticated', aud: 'authenticated' },
      this.jwtSecret,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
  }

  /** A PostgREST client acting as `token`'s user, so RLS applies (used to probe
   * the assignee-table policies directly, bypassing the backend). */
  userClient(token: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private track(table: string, id: string): string {
    this.rows.push({ table, id });
    return id;
  }

  async createUser(label: string): Promise<SeededUser> {
    const email = `phase0+${this.runId}-${label}@proyekto-itest.invalid`;
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password: `Pw-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser(${label}) failed: ${error?.message}`);
    }
    const id = data.user.id;
    this.userIds.push(id);
    // No auth.users trigger creates profiles, so insert one explicitly (the
    // roadmaps/projects FKs point at profiles.id).
    const { error: profileErr } = await this.admin
      .from('profiles')
      .upsert({ id, email }, { onConflict: 'id' });
    if (profileErr) {
      throw new Error(
        `createUser(${label}) profile upsert failed: ${profileErr.message}`,
      );
    }
    return { id, email, token: this.mintToken(id, email) };
  }

  /** Flag a user as a guest so the guest-migration read path can be exercised. */
  async markGuest(userId: string): Promise<void> {
    await this.admin
      .from('profiles')
      .update({ is_guest: true })
      .eq('id', userId);
  }

  async createProject(
    clientId: string,
    title = 'itest project',
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('projects')
      .insert({ title: `${title} ${this.runId}`, client_id: clientId })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createProject failed: ${error?.message}`);
    return this.track('projects', data.id as string);
  }

  async grantAccess(
    projectId: string,
    userId: string,
    role: RoleName,
    capabilities: Record<string, boolean> = {},
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('project_access')
      .insert({
        project_id: projectId,
        user_id: userId,
        role,
        origin: 'direct',
        capabilities,
        has_direct_grant: true,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`grantAccess failed: ${error?.message}`);
    return this.track('project_access', data.id as string);
  }

  async createRoadmap(
    ownerId: string,
    projectId: string | null = null,
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmaps')
      .insert({
        name: `itest roadmap ${this.runId}`,
        owner_id: ownerId,
        project_id: projectId,
        preview_url: '',
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createRoadmap failed: ${error?.message}`);
    return this.track('roadmaps', data.id as string);
  }

  async createEpic(roadmapId: string): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmap_epics')
      .insert({ roadmap_id: roadmapId, title: 'itest epic', position: 0 })
      .select('id')
      .single();
    if (error || !data) throw new Error(`createEpic failed: ${error?.message}`);
    return this.track('roadmap_epics', data.id as string);
  }

  async createFeature(epicId: string, roadmapId: string): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmap_features')
      .insert({
        epic_id: epicId,
        roadmap_id: roadmapId,
        title: 'itest feature',
        position: 0,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createFeature failed: ${error?.message}`);
    return this.track('roadmap_features', data.id as string);
  }

  async createTask(featureId: string, position = 0): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmap_tasks')
      .insert({ feature_id: featureId, title: 'itest task', position })
      .select('id')
      .single();
    if (error || !data) throw new Error(`createTask failed: ${error?.message}`);
    return this.track('roadmap_tasks', data.id as string);
  }

  async createDependency(
    blockedTaskId: string,
    blockingTaskId: string,
  ): Promise<string> {
    const { data, error } = await this.admin
      .from('task_dependencies')
      .insert({
        blocked_task_id: blockedTaskId,
        blocking_task_id: blockingTaskId,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createDependency failed: ${error?.message}`);
    return this.track('task_dependencies', data.id as string);
  }

  async addTaskAssignee(taskId: string, assigneeId: string): Promise<void> {
    const { error } = await this.admin
      .from('roadmap_task_assignees')
      .insert({ task_id: taskId, assignee_id: assigneeId });
    if (error) throw new Error(`addTaskAssignee failed: ${error.message}`);
    // No id column (PK is task_id+assignee_id) — cleaned via task-delete cascade.
  }

  /** Mint an MCP Personal Access Token row directly (service-role) and return
   * the raw `pk_` value the McpAuthGuard will resolve by sha256 hash. */
  async createMcpToken(
    userId: string,
    scopes: string[],
  ): Promise<{ raw: string; id: string }> {
    const raw = 'pk_' + randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const { data, error } = await this.admin
      .from('mcp_personal_access_tokens')
      .insert({
        user_id: userId,
        name: `itest ${this.runId}`,
        token_hash: tokenHash,
        token_prefix: raw.slice(0, 11),
        scopes,
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`createMcpToken failed: ${error?.message}`);
    return {
      raw,
      id: this.track('mcp_personal_access_tokens', data.id as string),
    };
  }

  /** Read the roadmap's current updated_at (the revision token). */
  async roadmapUpdatedAt(roadmapId: string): Promise<string> {
    const { data, error } = await this.admin
      .from('roadmaps')
      .select('updated_at')
      .eq('id', roadmapId)
      .single();
    if (error || !data)
      throw new Error(`roadmapUpdatedAt failed: ${error?.message}`);
    return data.updated_at as string;
  }

  async cleanup(): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const { table, id } = this.rows[i];
      try {
        await this.admin.from(table).delete().eq('id', id);
      } catch {
        /* best-effort */
      }
    }
    for (let i = this.userIds.length - 1; i >= 0; i--) {
      try {
        await this.admin.auth.admin.deleteUser(this.userIds[i]);
      } catch {
        /* best-effort */
      }
    }
  }

  async close(): Promise<void> {
    if (this.app) await this.app.close();
  }
}
