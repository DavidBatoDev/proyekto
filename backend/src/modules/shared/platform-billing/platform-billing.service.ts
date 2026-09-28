import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkspacesService } from '../../execution/workspaces/workspaces.service';
import {
  PLAN_LABELS,
  PLAN_RANK,
  type CompPlan,
  type PlanId,
  type PlanSource,
  type WorkspacePlanState,
} from '../entitlements/entitlement-keys';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type {
  CreateCheckoutSessionDto,
  CreatePortalSessionDto,
} from './dto/platform-billing.dto';
import type { BillingInterval, PurchasablePlan } from './plan-catalog';
import type {
  BillingProvider,
  BillingProviderId,
} from './providers/billing-provider';
import { BillingProviderRegistry } from './providers/billing-provider.registry';
import {
  PLATFORM_BILLING_REPOSITORY,
  type BillingPlan,
  type BillingStatus,
  type PlatformBillingRepository,
} from './repositories/platform-billing.repository.interface';

/** Statuses that mean a subscription already exists and must not be re-bought. */
const OCCUPIED_STATUSES: readonly BillingStatus[] = [
  'active',
  'trialing',
  'incomplete',
  'past_due',
  'unpaid',
  'paused',
];

/** Statuses under which the subscription's plan is the paid plan (mirrors workspace_plan_state). */
const PAID_STATUSES: readonly BillingStatus[] = [
  'active',
  'trialing',
  'past_due',
];

export interface BillingSummary {
  plan: BillingPlan;
  status: BillingStatus;
  interval: BillingInterval | null;
  /** Live COUNT(workspace_members). */
  seats_used: number;
  /** What the provider is currently billing. Diverges from seats_used between
   *  a membership change and the next sync; the UI shows both when they differ. */
  billed_quantity: number | null;
  seat_limit: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_end: string | null;
  currency: string | null;
  next_invoice: {
    amount_due_cents: number;
    currency: string;
    date: string | null;
    is_estimate: boolean;
  } | null;
  payment_method: {
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
  } | null;
  latest_invoice: { hosted_url: string | null; status: string | null } | null;
  billing_email: string | null;
  /** Which provider holds this workspace's billing account, if any. */
  provider: BillingProviderId | null;
  has_billing_account: boolean;
  portal_available: boolean;
  purchasable_plans: PurchasablePlan[];
  /**
   * What adding or removing a member will do to the bill, derived here rather
   * than in the UI so the proration rule lives in exactly one place.
   */
  seat_delta_effect: 'next_invoice' | 'prorated';
  /**
   * The plan the workspace actually gets: the higher of a complimentary plan
   * and the paid one. `plan` above stays the billed plan.
   */
  effective_plan: PlanId;
  plan_source: PlanSource;
  complimentary: {
    plan: CompPlan;
    since: string | null;
    until: string | null;
    active: boolean;
  } | null;
  /** A provider subscription exists and money is still moving on it. */
  has_live_subscription: boolean;
}

@Injectable()
export class PlatformBillingService {
  private readonly logger = new Logger(PlatformBillingService.name);

  constructor(
    private readonly providers: BillingProviderRegistry,
    @Inject(PLATFORM_BILLING_REPOSITORY)
    private readonly repo: PlatformBillingRepository,
    private readonly config: ConfigService,
    private readonly workspaces: WorkspacesService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** The provider new checkouts go through. */
  private requireActiveProvider(): BillingProvider {
    const provider = this.providers.active();
    if (!provider) {
      throw new ServiceUnavailableException(
        'Platform billing is not configured on this deployment.',
      );
    }
    return provider;
  }

  /**
   * Readable by owners AND admins: admins are the ones adding members, so they
   * need to see what a seat costs and whether the account is in dunning. Only
   * the write paths below are owner-only.
   */
  async getSummary(
    workspaceId: string,
    callerId: string,
  ): Promise<BillingSummary> {
    const workspace = await this.workspaces.fetchWorkspaceOrThrow(workspaceId);
    await this.workspaces.assertCanManageWorkspace(
      workspace,
      callerId,
      'view billing',
    );

    const record = await this.repo.ensureRow(workspaceId);
    const seatsUsed = await this.repo.countSeats(workspaceId);
    // The row's own provider for everything about an existing account; the
    // active provider only decides what can be bought.
    const owning = this.providers.get(record.billing_provider);
    const active = this.providers.active();
    const planState = await this.readPlanState(workspaceId);
    const comp = planState?.complimentary ?? null;
    const activeComp = comp?.active ? comp : null;
    const purchasable = active ? active.listPurchasablePlans() : [];

    const summary: BillingSummary = {
      plan: record.plan,
      status: record.status,
      interval: record.billing_interval,
      seats_used: seatsUsed,
      billed_quantity: null,
      seat_limit: record.seat_limit,
      current_period_start: record.current_period_start,
      current_period_end: record.current_period_end,
      cancel_at_period_end: record.cancel_at_period_end,
      canceled_at: record.canceled_at,
      trial_end: record.trial_end,
      currency: null,
      next_invoice: null,
      payment_method: null,
      latest_invoice: null,
      billing_email: null,
      provider: record.billing_provider,
      has_billing_account: Boolean(record.provider_customer_id),
      portal_available: Boolean(owning && record.provider_customer_id),
      // A comp already covers everything at or below its tier, so only a
      // higher plan is worth offering.
      purchasable_plans: activeComp
        ? purchasable.filter(
            (plan) => PLAN_RANK[plan] > PLAN_RANK[activeComp.plan],
          )
        : purchasable,
      seat_delta_effect:
        record.billing_interval === 'year' ? 'prorated' : 'next_invoice',
      effective_plan:
        planState?.effective_plan ??
        (PAID_STATUSES.includes(record.status) ? record.plan : 'free'),
      plan_source:
        planState?.plan_source ??
        (PAID_STATUSES.includes(record.status) && record.plan !== 'free'
          ? 'subscription'
          : 'default'),
      complimentary: comp,
      has_live_subscription:
        Boolean(record.provider_subscription_id) &&
        OCCUPIED_STATUSES.includes(record.status),
    };

    if (!owning || !record.provider_subscription_id) return summary;

    // Everything below is best-effort: a provider outage should degrade the
    // page to plan-and-seats, never 500 it.
    try {
      const details = await owning.getBillingDetails(
        record.provider_subscription_id,
      );
      return {
        ...summary,
        billed_quantity: details.billedQuantity,
        currency: details.currency,
        next_invoice: details.nextInvoice,
        payment_method: details.paymentMethod,
        latest_invoice: details.latestInvoice,
        billing_email: details.billingEmail,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Could not decorate billing summary for ${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return summary;
    }
  }

  /**
   * Owner-only. An owner can promote anyone to admin in a single request, so if
   * admins could attach a payment method this would be a one-request
   * escalation into somebody's wallet.
   */
  async createCheckoutSession(
    workspaceId: string,
    callerId: string,
    dto: CreateCheckoutSessionDto,
  ): Promise<{ url: string }> {
    const provider = this.requireActiveProvider();
    const workspace = await this.workspaces.fetchWorkspaceOrThrow(workspaceId);
    await this.workspaces.assertOwner(
      workspace,
      callerId,
      'start a subscription',
    );
    await this.assertNotCoveredByComp(workspaceId, dto.plan);

    const priceId = provider.resolvePriceId(
      dto.plan as PurchasablePlan,
      dto.interval,
    );
    if (!priceId) {
      throw new ServiceUnavailableException(
        `The ${dto.plan} ${dto.interval}ly price is not configured on this deployment.`,
      );
    }

    const record = await this.repo.ensureRow(workspaceId);
    if (
      record.provider_subscription_id &&
      OCCUPIED_STATUSES.includes(record.status)
    ) {
      // Two owners on the billing page at once would otherwise buy two
      // subscriptions for one workspace.
      throw new ConflictException({
        message:
          'This workspace already has a subscription. Change the plan from the billing portal instead.',
        code: 'workspace_already_subscribed',
      });
    }

    // A customer is reused only within the provider that issued it. Moving a
    // workspace from Stripe to Polar starts a fresh customer on Polar.
    const existingCustomerId =
      record.billing_provider === provider.id
        ? record.provider_customer_id
        : null;
    const owners = await this.repo.listOwners(workspaceId);
    // Read seats fresh: the owner may have had the plan picker open while
    // somebody accepted an invitation.
    const seats = Math.max(await this.repo.countSeats(workspaceId), 1);
    const billingPath = `/w/${workspace.slug}/settings/billing`;

    const result = await provider.createCheckout({
      workspaceId,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      existingCustomerId,
      // A receipt address, not an identity: the customer is the workspace.
      receiptEmail: owners.find((owner) => owner.email)?.email ?? null,
      priceId,
      quantity: seats,
      successUrl: `${this.clientUrl()}${dto.success_path ?? billingPath}?checkout=success`,
      cancelUrl: `${this.clientUrl()}${dto.cancel_path ?? billingPath}?checkout=cancelled`,
    });

    // Adapters that create the customer up front report it now, so a second
    // checkout attempt reuses it. The row is not yet tied to a subscription;
    // the completion webhook does that.
    if (result.customerId && result.customerId !== existingCustomerId) {
      await this.repo.updateSubscription(
        workspaceId,
        {
          billing_provider: provider.id,
          provider_customer_id: result.customerId,
        },
        { notOlderThan: new Date().toISOString() },
      );
    }
    return { url: result.url };
  }

  /** Owner-only, for the same reason as checkout. */
  async createPortalSession(
    workspaceId: string,
    callerId: string,
    dto: CreatePortalSessionDto,
  ): Promise<{ url: string }> {
    const workspace = await this.workspaces.fetchWorkspaceOrThrow(workspaceId);
    await this.workspaces.assertOwner(workspace, callerId, 'manage billing');

    const record = await this.repo.findByWorkspaceId(workspaceId);
    if (!record?.provider_customer_id) {
      throw new NotFoundException(
        'This workspace has no billing account yet. Start a subscription first.',
      );
    }
    // The portal of the provider that holds the account, whichever provider is
    // currently selling.
    const provider = this.providers.get(record.billing_provider);
    if (!provider) {
      throw new ServiceUnavailableException(
        `The ${record.billing_provider ?? 'unknown'} billing provider is not configured on this deployment.`,
      );
    }

    return provider.createPortal({
      customerId: record.provider_customer_id,
      returnUrl: `${this.clientUrl()}${
        dto.return_path ?? `/w/${workspace.slug}/settings/billing`
      }`,
    });
  }

  /**
   * Refuses to sell a plan an active complimentary plan already covers: the
   * owner would pay for nothing. A plan ranked above the comp stays on sale,
   * and once bought it wins by rank.
   *
   * Read fresh, past the plan-state cache, so a comp granted a moment ago
   * counts. A lookup failure lets the checkout through: a database without
   * the plan-limits tables has no comps to protect.
   */
  private async assertNotCoveredByComp(
    workspaceId: string,
    plan: PlanId,
  ): Promise<void> {
    let state: WorkspacePlanState;
    try {
      state = await this.entitlements.getEffectivePlan(workspaceId, {
        fresh: true,
      });
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `entitlements_lookup_failed op=checkout_comp_check workspace=${workspaceId} message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    const comp = state.complimentary;
    if (!comp?.active || PLAN_RANK[plan] > PLAN_RANK[comp.plan]) return;
    throw new ConflictException({
      code: 'workspace_complimentary',
      complimentary_plan: comp.plan,
      message: `This workspace already has ${PLAN_LABELS[comp.plan]} on a complimentary plan, which includes everything in ${PLAN_LABELS[plan]}. Only a higher plan can be bought.`,
    });
  }

  /** The effective plan for the summary; null when it cannot be read, so the summary still renders. */
  private async readPlanState(
    workspaceId: string,
  ): Promise<WorkspacePlanState | null> {
    try {
      return await this.entitlements.getEffectivePlan(workspaceId, {
        fresh: true,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `entitlements_lookup_failed op=billing_summary workspace=${workspaceId} message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private clientUrl(): string {
    return (
      this.config.get<string>('CLIENT_URL')?.replace(/\/$/, '') ??
      'http://localhost:3000'
    );
  }
}
