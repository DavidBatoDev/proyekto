/**
 * Engagement assignments over HTTP against hosted dev (P09, backend.md ›
 * Assignment Creation): the setUp auto-hook, the talent branch (E33 client
 * agreement picked automatically, E34 default team, the operational project
 * link), the E58 `project_access` upsert (new row, and a raise that never
 * downgrades and keeps `origin`), L22 masking for the client hirer, non-party
 * 404s, and ending an assignment while its worker's timer runs (M3 A3 stops
 * it, `stopped_by_assignment_end`, `timer_auto_stopped`).
 *
 * Runs after M2/M3 are applied to dev (§6 step 3) and after P08 (the
 * notification). Never against production (describeDevOnly).
 *
 * ⚠️ Not fully self-cleaning, like engagement-activation.integration-spec.ts:
 * the activated engagement graph is append-only (engagements, parties,
 * project links and assignments raise *_DELETE_FORBIDDEN or are immutable),
 * so each run cancels its two engagements and leaves them, their activating
 * contracts and their assignments (severed from the deleted projects) in
 * place. The parties pin the fixture profiles, so those stay too.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Harness, describeDevOnly } from './harness';

jest.setTimeout(180000);

const SIGNED_AT = '2026-03-01T00:00:00.000Z';

type User = Awaited<ReturnType<Harness['createUser']>>;

describeDevOnly('engagement assignments (real DB)', () => {
  const h = new Harness();
  const createdEngagements: string[] = [];
  const cleanupProblems: string[] = [];

  let consultant: User;
  let client: User;
  let talent: User;
  let stranger: User;
  let teamId: string;
  let projectId: string;
  let otherProjectId: string;
  let clientEngagementId: string;
  let talentEngagementId: string;

  const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });

  /** A flexible contract with its two positions, signed by both, and its engagement id. */
  async function signedEngagement(o: {
    kind: 'client_services' | 'talent_services';
    hirer: User;
    hirerCapacity: 'client' | 'consultant';
    provider: User;
    providerCapacity: 'consultant' | 'talent';
    hirerTeamId?: string | null;
    providerTeamId?: string | null;
  }): Promise<string> {
    const { data, error } = await h.admin
      .from('contracts')
      .insert({
        project_id: null,
        created_by: consultant.id,
        consultant_user_id: consultant.id,
        client_user_id: o.kind === 'client_services' ? o.hirer.id : null,
        relationship_kind: o.kind,
        scope_mode: 'flexible',
        contract_family_id: randomUUID(),
        version: 1,
        status: 'draft',
        currency: 'USD',
        billing_mode: 'time_based',
        client_hourly_rate: o.kind === 'client_services' ? 120 : 40,
        service_start_date: '2026-03-01',
        service_end_date: '2026-12-31',
        time_tracking_mode: 'optional',
        time_approval_mode:
          o.kind === 'client_services'
            ? 'none'
            : 'provider_submit_hirer_approve',
        client_hours_detail_level: 'summary',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed contract: ${error?.message}`);
    const contractId = data.id as string;

    const teamName = async (id: string | null | undefined) =>
      id
        ? ((await h.admin.from('teams').select('name').eq('id', id).single())
            .data?.name as string)
        : null;
    const { error: positionsError } = await h.admin
      .from('contract_positions')
      .insert([
        {
          contract_id: contractId,
          position: 'hirer',
          user_id: o.hirer.id,
          capacity: o.hirerCapacity,
          display_name_snapshot: `Itest ${o.hirerCapacity}`,
          email_snapshot: o.hirer.email,
          team_id: o.hirerTeamId ?? null,
          team_name_snapshot: await teamName(o.hirerTeamId),
        },
        {
          contract_id: contractId,
          position: 'provider',
          user_id: o.provider.id,
          capacity: o.providerCapacity,
          display_name_snapshot: `Itest ${o.providerCapacity}`,
          email_snapshot: o.provider.email,
          team_id: o.providerTeamId ?? null,
          team_name_snapshot: await teamName(o.providerTeamId),
        },
      ]);
    if (positionsError) {
      throw new Error(`seed positions: ${positionsError.message}`);
    }

    for (const position of ['provider', 'hirer'] as const) {
      const { error: signError } = await h.admin.rpc(
        'sign_contract_position_and_activate',
        {
          p_contract_id: contractId,
          p_position: position,
          p_signer_name: `Signer ${position}`,
          p_signature_url: null,
          p_scale: 1,
          p_offset_x: 0,
          p_offset_y: 0,
          p_signed_at: SIGNED_AT,
        },
      );
      if (signError) throw new Error(`sign ${position}: ${signError.message}`);
    }

    const { data: signed } = await h.admin
      .from('contracts')
      .select('engagement_id')
      .eq('id', contractId)
      .single();
    const engagementId = signed?.engagement_id as string | null;
    if (!engagementId) throw new Error('contract did not activate');
    createdEngagements.push(engagementId);
    return engagementId;
  }

  async function accessRow(userId: string, project: string) {
    const { data } = await h.admin
      .from('project_access')
      .select('role, origin, has_direct_grant')
      .eq('project_id', project)
      .eq('user_id', userId)
      .maybeSingle();
    return data as {
      role: string;
      origin: string;
      has_direct_grant: boolean;
    } | null;
  }

  beforeAll(async () => {
    await h.boot();
    consultant = await h.createUser('asg-consultant');
    client = await h.createUser('asg-client');
    talent = await h.createUser('asg-talent');
    stranger = await h.createUser('asg-stranger');
    await h.admin
      .from('consultant_profiles')
      .upsert(
        { user_id: consultant.id, status: 'verified' },
        { onConflict: 'user_id' },
      );

    teamId = await h.createTeam(consultant.id, null, 'itest asg team');
    projectId = await h.createProject(consultant.id, 'itest assignments');
    await h.grantAccess(projectId, consultant.id, 'owner');
    otherProjectId = await h.createProject(
      consultant.id,
      'itest assignments b',
    );
    await h.grantAccess(otherProjectId, consultant.id, 'owner');

    clientEngagementId = await signedEngagement({
      kind: 'client_services',
      hirer: client,
      hirerCapacity: 'client',
      provider: consultant,
      providerCapacity: 'consultant',
      providerTeamId: teamId,
    });
    talentEngagementId = await signedEngagement({
      kind: 'talent_services',
      hirer: consultant,
      hirerCapacity: 'consultant',
      provider: talent,
      providerCapacity: 'talent',
      hirerTeamId: teamId,
    });
  }, 180000);

  afterAll(async () => {
    // The fixture talent's notifications (timer_auto_stopped).
    const { error: notificationsError } = await h.admin
      .from('notifications')
      .delete()
      .eq('user_id', talent?.id ?? '');
    if (notificationsError) {
      cleanupProblems.push(`notifications: ${notificationsError.message}`);
    }

    await h.cleanup();

    // active -> cancelled is the only transition tg_engagements_guard allows.
    for (const engagementId of createdEngagements) {
      const { error } = await h.admin
        .from('engagements')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          status_reason: 'integration test fixture',
        })
        .eq('id', engagementId)
        .eq('status', 'active');
      if (error)
        cleanupProblems.push(`cancel ${engagementId}: ${error.message}`);
    }
    // The verified enrolment would list the fixture in the public directory.
    if (consultant) {
      const { error } = await h.admin
        .from('consultant_profiles')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          status_reason: 'integration test fixture',
        })
        .eq('user_id', consultant.id);
      if (error) cleanupProblems.push(`revoke enrolment: ${error.message}`);
    }
    await h.close();

    if (createdEngagements.length > 0) {
      console.warn(
        `[cleanup] permanent by design — ${createdEngagements.length} engagement(s) cancelled, not deleted (${createdEngagements.join(', ')})`,
      );
    }
    if (cleanupProblems.length > 0) {
      console.warn(`[cleanup] ${cleanupProblems.join(' | ')}`);
    }
  }, 180000);

  it('setUp (link) links the client engagement and gives the consultant their own assignment', async () => {
    const res = await request(h.server())
      .post(`/api/engagements/${clientEngagementId}/project`)
      .set(auth(consultant))
      .send({ mode: 'link', project_id: projectId });
    expect(res.status).toBe(201);

    const list = await request(h.server())
      .get(`/api/engagements/${clientEngagementId}/assignments`)
      .set(auth(consultant));
    expect(list.status).toBe(200);
    const own = (list.body.data as Array<Record<string, unknown>>).find(
      (row) => row.worker_user_id === consultant.id,
    );
    expect(own).toMatchObject({
      project_id: projectId,
      client_engagement_id: clientEngagementId,
      talent_engagement_id: null,
      team_id: teamId,
      status: 'active',
    });
  });

  let assignmentId: string;

  it('talent branch: picks the client agreement (E33), the hirer team (E34), links the project and grants editor (E58)', async () => {
    const res = await request(h.server())
      .post(`/api/engagements/${talentEngagementId}/assignments`)
      .set(auth(consultant))
      .send({ project_id: projectId, role_title: 'Designer' });
    expect(res.status).toBe(201);
    const view = res.body.data as Record<string, unknown>;
    expect(view).toMatchObject({
      engagement_id: talentEngagementId,
      project_id: projectId,
      worker_user_id: talent.id,
      client_engagement_id: clientEngagementId,
      talent_engagement_id: talentEngagementId,
      team_id: teamId,
      role_title: 'Designer',
      status: 'active',
      access_needed: false,
    });
    assignmentId = view.id as string;

    const { data: links } = await h.admin
      .from('engagement_project_links')
      .select('basis, status')
      .eq('engagement_id', talentEngagementId)
      .eq('project_id', projectId);
    expect(links).toEqual([
      { basis: 'operational_assignment', status: 'active' },
    ]);

    expect(await accessRow(talent.id, projectId)).toEqual({
      role: 'editor',
      origin: `engagement:${talentEngagementId}`,
      has_direct_grant: true,
    });
  });

  it('a second identical assignment is a 409', async () => {
    const res = await request(h.server())
      .post(`/api/engagements/${talentEngagementId}/assignments`)
      .set(auth(consultant))
      .send({ project_id: projectId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSIGNMENT_ALREADY_ACTIVE');
  });

  it('E58: an existing stronger row is never downgraded and keeps its origin', async () => {
    const accessId = await h.grantAccess(otherProjectId, talent.id, 'admin');
    await h.admin
      .from('project_access')
      .update({ has_direct_grant: false, origin: `team:${teamId}` })
      .eq('id', accessId);

    const res = await request(h.server())
      .post(`/api/engagements/${talentEngagementId}/assignments`)
      .set(auth(consultant))
      .send({ project_id: otherProjectId });
    expect(res.status).toBe(201);
    expect(res.body.data.client_engagement_id).toBeNull();

    expect(await accessRow(talent.id, otherProjectId)).toEqual({
      role: 'admin',
      origin: `team:${teamId}`,
      has_direct_grant: true,
    });
  });

  it('L22: the client hirer sees a delivery team, never the talent', async () => {
    const res = await request(h.server())
      .get(`/api/engagements/${clientEngagementId}/assignments`)
      .set(auth(client));
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.worker_user_id).toBeNull();
      expect(row.worker_label).toBe('Delivery team');
      expect(row.talent_engagement_id).toBeNull();
    }
    expect(JSON.stringify(rows)).not.toContain(talent.id);
  });

  it('non-parties get 404 on every route', async () => {
    const list = await request(h.server())
      .get(`/api/engagements/${talentEngagementId}/assignments`)
      .set(auth(stranger));
    expect(list.status).toBe(404);
    const create = await request(h.server())
      .post(`/api/engagements/${talentEngagementId}/assignments`)
      .set(auth(stranger))
      .send({ project_id: projectId });
    expect(create.status).toBe(404);
    const end = await request(h.server())
      .post(
        `/api/engagements/${talentEngagementId}/assignments/${assignmentId}/end`,
      )
      .set(auth(stranger))
      .send({});
    expect(end.status).toBe(404);
  });

  it('the talent may not end their own assignment (403)', async () => {
    const res = await request(h.server())
      .post(
        `/api/engagements/${talentEngagementId}/assignments/${assignmentId}/end`,
      )
      .set(auth(talent))
      .send({});
    expect(res.status).toBe(403);
  });

  it('ending stops the running timer and tells the worker (E14, L37)', async () => {
    // trg_20: an entry never starts before its assignment, which started
    // (by default) when it was created above.
    const entry = await h.createTimeEntry({
      projectId,
      memberUserId: talent.id,
      engagementAssignmentId: assignmentId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      source: 'timer',
    });

    const res = await request(h.server())
      .post(
        `/api/engagements/${talentEngagementId}/assignments/${assignmentId}/end`,
      )
      .set(auth(consultant))
      .send({ reason: 'Wrapped' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: assignmentId, status: 'ended' });

    const { data: stopped } = await h.admin
      .from('time_entries')
      .select('ended_at, flagged_reason')
      .eq('id', entry.id)
      .single();
    expect(stopped?.ended_at).not.toBeNull();
    expect(stopped?.flagged_reason).toBe('stopped_by_assignment_end');

    const { data: type } = await h.admin
      .from('notification_types')
      .select('id')
      .eq('name', 'timer_auto_stopped')
      .single();
    const { data: notices } = await h.admin
      .from('notifications')
      .select('content')
      .eq('user_id', talent.id)
      .eq('type_id', type?.id as string);
    expect(
      (notices ?? []).some(
        (n) => (n.content as Record<string, unknown>)?.entry_id === entry.id,
      ),
    ).toBe(true);

    const again = await request(h.server())
      .post(
        `/api/engagements/${talentEngagementId}/assignments/${assignmentId}/end`,
      )
      .set(auth(consultant))
      .send({});
    expect(again.status).toBe(409);
  });
});
