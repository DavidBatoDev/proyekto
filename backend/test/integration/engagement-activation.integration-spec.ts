/**
 * Real-DB coverage for the P4b activation transaction.
 *
 * `sign_contract_position_and_activate` is the only writer of engagements, and
 * until this spec nothing exercised it against an actual database — the unit
 * tests mock Supabase, so the 260-line SECURITY DEFINER body (validation,
 * enrollment recheck, engagement + parties + link + settings + rates, amendment
 * rollover) shipped unverified. It runs against hosted dev, not production,
 * because activation writes rows the model never deletes.
 *
 * ⚠️ This spec is NOT fully self-cleaning, and cannot be. The activated
 * engagement graph is append-only: engagements / time_rates / time_settings /
 * project_links raise `*_DELETE_FORBIDDEN`, and `tg_engagement_parties_guard`
 * raises `ENGAGEMENT_PARTY_IMMUTABLE` on UPDATE and DELETE alike — triggers
 * fire for service_role too. Only contracts and contract_positions are
 * removable, and only after rewinding the contract to 'draft'. Each engagement
 * is cancelled and left in place, and `afterAll` prints what it could not
 * remove. Budget two permanent engagement rows per run before adding cases.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Harness } from './harness';

const SIGNED_AT = '2026-03-01T00:00:00.000Z';

describe('engagement activation (real DB)', () => {
  const h = new Harness();
  const createdContracts: string[] = [];
  const createdEngagements: string[] = [];

  let consultant: { id: string; email: string; token: string };
  let client: { id: string; email: string; token: string };
  let stranger: { id: string; email: string; token: string };
  let projectId: string;

  /** Draft contract plus its two generic positions, ready for final signature. */
  async function seedSignableContract(options: {
    familyId: string;
    amendmentEffectiveDate?: string;
    serviceStart?: string;
    /** uq_contracts_family_version keeps versions distinct within a family. */
    version?: number;
    hourlyRate?: number;
  }): Promise<string> {
    const { data, error } = await h.admin
      .from('contracts')
      .insert({
        project_id: projectId,
        created_by: consultant.id,
        consultant_user_id: consultant.id,
        client_user_id: client.id,
        relationship_kind: 'client_services',
        scope_mode: 'project_specific',
        contract_family_id: options.familyId,
        version: options.version ?? 1,
        status: 'draft',
        currency: 'USD',
        billing_mode: 'time_based',
        client_hourly_rate: options.hourlyRate ?? 125,
        service_start_date: options.serviceStart ?? '2026-03-01',
        service_end_date: '2026-12-31',
        amendment_effective_date: options.amendmentEffectiveDate ?? null,
        time_tracking_mode: 'required',
        time_approval_mode: 'none',
        client_hours_detail_level: 'summary',
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`seed contract failed: ${error?.message}`);
    }
    const contractId = data.id as string;
    createdContracts.push(contractId);

    const { error: positionError } = await h.admin
      .from('contract_positions')
      .insert([
        {
          contract_id: contractId,
          position: 'hirer',
          user_id: client.id,
          capacity: 'client',
          display_name_snapshot: 'Itest Client',
          email_snapshot: client.email,
        },
        {
          contract_id: contractId,
          position: 'provider',
          user_id: consultant.id,
          capacity: 'consultant',
          display_name_snapshot: 'Itest Consultant',
          email_snapshot: consultant.email,
        },
      ]);
    if (positionError) {
      throw new Error(`seed positions failed: ${positionError.message}`);
    }
    return contractId;
  }

  async function sign(contractId: string, position: 'hirer' | 'provider') {
    return h.admin.rpc('sign_contract_position_and_activate', {
      p_contract_id: contractId,
      p_position: position,
      p_signer_name: `Signer ${position}`,
      p_signature_url: null,
      p_scale: 1,
      p_offset_x: 0,
      p_offset_y: 0,
      p_signed_at: SIGNED_AT,
    });
  }

  async function engagementIdFor(contractId: string): Promise<string | null> {
    const { data } = await h.admin
      .from('contracts')
      .select('engagement_id')
      .eq('id', contractId)
      .maybeSingle();
    const id = (data?.engagement_id as string | null) ?? null;
    if (id && !createdEngagements.includes(id)) createdEngagements.push(id);
    return id;
  }

  beforeAll(async () => {
    await h.boot();
    consultant = await h.createUser('eng-consultant');
    client = await h.createUser('eng-client');
    stranger = await h.createUser('eng-stranger');
    await h.admin
      .from('consultant_profiles')
      .upsert(
        { user_id: consultant.id, status: 'verified' },
        { onConflict: 'user_id' },
      );
    projectId = await h.createProject(consultant.id, 'engagement itest');
    await h.grantAccess(projectId, consultant.id, 'owner');
  }, 120000);

  /**
   * supabase-js reports failures in `error` instead of throwing, so an
   * unchecked `.delete()` leaves rows behind with no signal at all. That is
   * exactly how earlier runs of this spec littered hosted dev. Collect every
   * failure and report it rather than pretending the teardown worked.
   */
  const cleanupProblems: string[] = [];

  async function tryDelete(
    table: string,
    column: string,
    value: string,
  ): Promise<void> {
    const { error } = await h.admin.from(table).delete().eq(column, value);
    if (error) {
      cleanupProblems.push(
        `delete ${table}.${column}=${value}: ${error.message}`,
      );
    }
  }

  afterAll(async () => {
    // The activated engagement graph is append-only and cannot be removed:
    // engagements / time_rates / time_settings / project_links raise
    // *_DELETE_FORBIDDEN, and engagement_parties raises
    // ENGAGEMENT_PARTY_IMMUTABLE on UPDATE and DELETE alike. Triggers fire for
    // service_role too, so retiring the engagement is the only teardown there
    // is. active -> cancelled is the sole transition tg_engagements_guard
    // permits, and engagements_terminal_timestamp_check demands cancelled_at
    // alongside it.
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
      if (error) {
        cleanupProblems.push(
          `cancel engagement ${engagementId}: ${error.message}`,
        );
      }
    }

    // Contracts and their positions ARE removable, but only from 'draft':
    // tg_contract_positions_guard refuses DELETE while the contract is sent or
    // signed. A contract that actually activated an engagement is pinned for
    // good, though — engagements.activated_by_contract_id and
    // engagement_time_settings.source_contract_id both reference it — so don't
    // even try, or the teardown cries wolf on every single run.
    const permanentContracts: string[] = [];
    for (const contractId of createdContracts) {
      const { data } = await h.admin
        .from('contracts')
        .select('engagement_id')
        .eq('id', contractId)
        .maybeSingle();
      if (data?.engagement_id) {
        permanentContracts.push(contractId);
        continue;
      }

      const { error } = await h.admin
        .from('contracts')
        .update({ status: 'draft' })
        .eq('id', contractId);
      if (error) {
        cleanupProblems.push(`rewind contract ${contractId}: ${error.message}`);
        continue;
      }
      await tryDelete('contract_positions', 'contract_id', contractId);
      await tryDelete('contracts', 'id', contractId);
    }

    // The consultant enrollment is referenced by every surviving contract, so
    // it only goes when nothing is pinned. When it cannot go it must at least
    // stop being *verified*: `/api/consultants` is public and filters on that
    // status, so a leftover verified fixture shows up as an anonymous
    // "Consultant" card in the live marketplace directory. Nine of them had
    // accumulated before anyone noticed.
    if (permanentContracts.length === 0) {
      await tryDelete('consultant_profiles', 'user_id', consultant.id);
    } else {
      const { error } = await h.admin
        .from('consultant_profiles')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          status_reason: 'integration test fixture',
        })
        .eq('user_id', consultant.id);
      if (error) {
        cleanupProblems.push(
          `revoke consultant enrolment ${consultant.id}: ${error.message}`,
        );
      }
    }

    await h.cleanup();
    await h.close();

    // Deliberately noisy. Every run permanently adds these rows, and purging
    // them needs a maintenance query with session_replication_role = 'replica',
    // which the harness cannot issue over PostgREST.
    if (createdEngagements.length > 0) {
      console.warn(
        `[cleanup] permanent by design — ${createdEngagements.length} engagement(s) cancelled not deleted (${createdEngagements.join(', ')}); ${permanentContracts.length} activating contract(s) and the consultant enrollment left in place`,
      );
    }
    if (cleanupProblems.length > 0) {
      console.warn(
        `[cleanup] ${cleanupProblems.length} teardown step(s) failed: ${cleanupProblems.join(' | ')}`,
      );
    }
  }, 120000);

  describe('the first signature does not activate anything', () => {
    it('flips draft to sent and leaves the engagement unset', async () => {
      const contractId = await seedSignableContract({
        familyId: randomUUID(),
      });

      const { error } = await sign(contractId, 'provider');
      expect(error).toBeNull();

      const { data } = await h.admin
        .from('contracts')
        .select('status, engagement_id')
        .eq('id', contractId)
        .maybeSingle();
      expect(data?.status).toBe('sent');
      expect(data?.engagement_id).toBeNull();
    });
  });

  describe('the final signature activates the engagement', () => {
    let contractId: string;
    let engagementId: string;

    beforeAll(async () => {
      contractId = await seedSignableContract({ familyId: randomUUID() });
      const first = await sign(contractId, 'provider');
      expect(first.error).toBeNull();
      const second = await sign(contractId, 'hirer');
      expect(second.error).toBeNull();
      engagementId = (await engagementIdFor(contractId)) as string;
    }, 120000);

    it('marks the contract signed and links it to a new engagement', async () => {
      expect(engagementId).toBeTruthy();
      const { data } = await h.admin
        .from('contracts')
        .select('status')
        .eq('id', contractId)
        .maybeSingle();
      expect(data?.status).toBe('signed');
    });

    it('creates an active engagement of the contract kind and scope', async () => {
      const { data } = await h.admin
        .from('engagements')
        .select('kind, scope_mode, status, origin, activated_by_contract_id')
        .eq('id', engagementId)
        .maybeSingle();

      expect(data).toMatchObject({
        kind: 'client_services',
        scope_mode: 'project_specific',
        status: 'active',
        origin: 'contract',
        activated_by_contract_id: contractId,
      });
    });

    it('creates exactly two immutable parties from the contract positions', async () => {
      const { data } = await h.admin
        .from('engagement_parties')
        .select('position, user_id, capacity')
        .eq('engagement_id', engagementId);

      expect(data).toHaveLength(2);
      expect(data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            position: 'hirer',
            user_id: client.id,
            capacity: 'client',
          }),
          expect.objectContaining({
            position: 'provider',
            user_id: consultant.id,
            capacity: 'consultant',
          }),
        ]),
      );
    });

    it('links the contractual project scope', async () => {
      const { data } = await h.admin
        .from('engagement_project_links')
        .select('project_id, basis')
        .eq('engagement_id', engagementId);

      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({
        project_id: projectId,
        basis: 'contract_scope',
      });
    });

    it('projects the signed time policy and the hourly billing rate', async () => {
      const { data: settings } = await h.admin
        .from('engagement_time_settings')
        .select('tracking_mode, client_hours_detail_level, effective_until')
        .eq('engagement_id', engagementId);
      expect(settings).toHaveLength(1);
      expect(settings?.[0]).toMatchObject({
        tracking_mode: 'required',
        client_hours_detail_level: 'summary',
        effective_until: null,
      });

      const { data: rates } = await h.admin
        .from('engagement_time_rates')
        .select('rate_kind, unit, amount, worker_user_id, effective_until')
        .eq('engagement_id', engagementId);
      expect(rates).toHaveLength(1);
      expect(rates?.[0]).toMatchObject({
        // billing, not cost — this is the Client revenue side, and
        // worker_user_id stays null because no Talent is involved.
        rate_kind: 'billing',
        unit: 'hour',
        amount: 125,
        worker_user_id: null,
        effective_until: null,
      });
    });

    it('is idempotent: signing an already-signed contract is rejected', async () => {
      const { error } = await sign(contractId, 'hirer');
      expect(error?.message).toContain('CONTRACT_ALREADY_SIGNED');

      const { count } = await h.admin
        .from('engagements')
        .select('id', { count: 'exact', head: true })
        .eq('activated_by_contract_id', contractId);
      expect(count).toBe(1);
    });

    it('serves the engagement over HTTP to both parties and to nobody else', async () => {
      const forConsultant = await request(h.server())
        .get('/api/engagements')
        .set('Authorization', `Bearer ${consultant.token}`)
        .expect(200);
      const consultantIds = forConsultant.body.data.map(
        (row: { id: string }) => row.id,
      );
      expect(consultantIds).toContain(engagementId);

      const forClient = await request(h.server())
        .get('/api/engagements')
        .set('Authorization', `Bearer ${client.token}`)
        .expect(200);
      const clientView = forClient.body.data.find(
        (row: { id: string }) => row.id === engagementId,
      );
      expect(clientView).toBeTruthy();
      expect(clientView.viewer_position).toBe('hirer');
      expect(clientView.counterparty.user_id).toBe(consultant.id);
      expect(clientView.current_rates).toHaveLength(1);

      const forStranger = await request(h.server())
        .get('/api/engagements')
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(200);
      expect(
        forStranger.body.data.some(
          (row: { id: string }) => row.id === engagementId,
        ),
      ).toBe(false);

      await request(h.server())
        .get(`/api/engagements/${engagementId}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
    });
  });

  describe('validation refuses to activate an incomplete agreement', () => {
    it('rejects a contract with only one position', async () => {
      const familyId = randomUUID();
      const contractId = await seedSignableContract({ familyId });
      await h.admin
        .from('contract_positions')
        .delete()
        .eq('contract_id', contractId)
        .eq('position', 'hirer');

      const { error } = await sign(contractId, 'provider');
      expect(error?.message).toContain('CONTRACT_REQUIRES_TWO_POSITIONS');
    });

    it('rejects signing when the consultant enrollment is no longer verified', async () => {
      const contractId = await seedSignableContract({ familyId: randomUUID() });
      await h.admin
        .from('consultant_profiles')
        .update({ status: 'suspended' })
        .eq('user_id', consultant.id);

      const { error } = await sign(contractId, 'provider');
      expect(error?.message).toContain('CONSULTANT_ENROLLMENT_INACTIVE');

      await h.admin
        .from('consultant_profiles')
        .update({ status: 'verified' })
        .eq('user_id', consultant.id);
    });
  });

  describe('an amendment rolls the effective-dated rows forward', () => {
    it('closes the superseded settings and rates and opens successors', async () => {
      const familyId = randomUUID();
      const original = await seedSignableContract({ familyId });
      await sign(original, 'provider');
      await sign(original, 'hirer');
      const engagementId = (await engagementIdFor(original)) as string;
      expect(engagementId).toBeTruthy();

      // Prospective by construction: the RPC refuses a past effective date.
      const effectiveFrom = new Date(Date.now() + 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const amendment = await seedSignableContract({
        familyId,
        version: 2,
        hourlyRate: 150,
        amendmentEffectiveDate: effectiveFrom,
      });
      // Attaching the engagement is what makes this an amendment rather than a
      // second root contract, and is what the RPC keys the rollover off.
      await h.admin
        .from('contracts')
        .update({ engagement_id: engagementId })
        .eq('id', amendment);

      const first = await sign(amendment, 'provider');
      expect(first.error).toBeNull();
      const second = await sign(amendment, 'hirer');
      expect(second.error).toBeNull();

      const { data: rates } = await h.admin
        .from('engagement_time_rates')
        .select('amount, effective_from, effective_until')
        .eq('engagement_id', engagementId)
        .order('amount', { ascending: true });

      expect(rates).toHaveLength(2);
      // The original closes the day before the amendment takes effect.
      expect(rates?.[0].amount).toBe(125);
      expect(rates?.[0].effective_until).not.toBeNull();
      expect(rates?.[1].amount).toBe(150);
      expect(rates?.[1].effective_from).toBe(effectiveFrom);
      expect(rates?.[1].effective_until).toBeNull();

      const { data: settings } = await h.admin
        .from('engagement_time_settings')
        .select('effective_from, effective_until')
        .eq('engagement_id', engagementId);
      expect(settings).toHaveLength(2);
      expect(
        settings?.filter((row) => row.effective_until === null),
      ).toHaveLength(1);

      // The superseded contract is ended, not left signed alongside its successor.
      const { data: prior } = await h.admin
        .from('contracts')
        .select('status')
        .eq('id', original)
        .maybeSingle();
      expect(prior?.status).toBe('ended');
    });
  });
});
