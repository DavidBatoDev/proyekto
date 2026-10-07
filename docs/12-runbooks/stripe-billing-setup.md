# Stripe Billing Setup

> **Last updated:** 2026-10-07 · **Status:** current

Configure Stripe for Proyekto's existing workspace subscriptions: the backend creates hosted Checkout and customer portal sessions, projects signed webhook events into subscription state, and synchronizes billable seats from workspace membership. This runbook describes the configuration procedure; account activation and a successful production rollout require separate verification.

## Scope and Prerequisites

Use the intended Stripe account and confirm its mode before creating resources. Keep a sandbox/test deployment separate from production: keys, products, prices, customers, subscriptions, webhook signing secrets, portal configuration, and Proyekto billing records must belong to the same environment. Stripe [testing environments](https://docs.stripe.com/testing) do not move real money.

The integration is workspace subscription billing. Marketplace invoices and Stripe Connect onboarding are separate concerns. [Stripe is the default provider](../../backend/src/modules/shared/platform-billing/providers/billing-provider.registry.ts); billing becomes available when credentials are configured, without a billing feature flag. Verify the deployed backend, required database schema, and [workspace billing page](../../web/src/components/workspace/settings/WorkspaceBillingPage.tsx) before exposing purchases.

## 1. Create Products and Prices

Create two products, **Proyekto Pro** and **Proyekto Business**, with these four active recurring prices. Use USD and a per-unit amount; one unit is one workspace member. Record the price IDs, not the product IDs.

| Product and interval | Charge per seat | GitHub repository variable |
| --- | --- | --- |
| Proyekto Pro, monthly | USD 12.00 per month | `STRIPE_PRICE_PRO_MONTHLY` |
| Proyekto Pro, yearly | USD 120.00 per year | `STRIPE_PRICE_PRO_YEARLY` |
| Proyekto Business, monthly | USD 24.00 per month | `STRIPE_PRICE_BUSINESS_MONTHLY` |
| Proyekto Business, yearly | USD 240.00 per year | `STRIPE_PRICE_BUSINESS_YEARLY` |

The [price catalog](../../backend/src/modules/shared/platform-billing/plan-catalog.ts) defines these amounts. The yearly price is the full annual charge: the displayed USD 10 or USD 20 per month is the annual equivalent. Free has no recurring price; Enterprise is quoted separately.

[Checkout](../../backend/src/modules/shared/platform-billing/providers/stripe/stripe-billing.provider.ts) supplies quantity from the backend and disables adjustable quantity. The [web client](../../web/src/services/billing.service.ts) sends a plan and interval, receives a hosted URL, and redirects to it. This implementation requires no frontend publishable key.

## 2. Register the Webhook

Create an account webhook destination in the same Stripe mode as the prices and key. Select **Snapshot** events and API version **`2026-08-26.dahlia`**, matching the [pinned backend client](../../backend/src/modules/shared/platform-billing/providers/stripe/stripe.client.ts). The adapter reads `event.data.object`; thin events require a different handler. Stripe documents destination creation and signing secrets in its [webhook guide](https://docs.stripe.com/webhooks).

| Setting | Value |
| --- | --- |
| Production endpoint | `https://api.proyekto.tech/api/platform-billing/webhooks/stripe` |
| Event source | This Stripe account |
| Payload | Snapshot |
| API version | `2026-08-26.dahlia` |
| Signing secret destination | GCP Secret Manager `STRIPE_WEBHOOK_SECRET` |

Subscribe to the events recognized by the [Stripe adapter](../../backend/src/modules/shared/platform-billing/providers/stripe/stripe-billing.provider.ts):

| Event | Purpose |
| --- | --- |
| `checkout.session.completed` | Link the purchased subscription to its workspace |
| `customer.subscription.created` | Refresh subscription state |
| `customer.subscription.updated` | Refresh plan, interval, status, and cancellation state |
| `customer.subscription.deleted` | Record subscription termination |
| `customer.subscription.trial_will_end` | Refresh trial/subscription state |
| `invoice.payment_failed` | Handle failed subscription payment |
| `invoice.payment_succeeded` | Handle successful subscription payment |
| `charge.dispute.created` | Handle an opened dispute |

Copy the endpoint's `whsec_...` signing secret to Secret Manager. A local Stripe CLI listener has its own signing secret; use that only for the local listener. For a test deployment, register its own backend URL instead of routing test events to production.

## 3. Configure the Default Customer Portal

Configure the account's **default** customer portal in the same environment. [Portal session creation](../../backend/src/modules/shared/platform-billing/providers/stripe/stripe-billing.provider.ts) supplies no configuration ID, so a separate nondefault configuration will not be selected by the application.

| Portal setting | Required configuration |
| --- | --- |
| Switch plans | On; offer both products and all four prices above |
| Update quantities | **Off**; workspace membership owns the seat count |
| Cancel subscription | On; cancellation takes effect at the end of the billing period |
| Payment methods | On |
| Invoice history | On |
| Business identity and links | Use Proyekto's verified business details and published links |

These options are configured in Stripe's [customer portal settings](https://docs.stripe.com/customer-management/configure-portal). Review the plan-change proration options before saving; the backend's seat-change policy does not configure portal plan-change behavior.

## 4. Store Secrets, Then Set Repository Variables

The production GCP project is **`planar-rarity-494104-n4`**, documented in the [Cloud Run setup](../../infra/gcp/README.md). Create or add versions of these secrets there first, and grant the Cloud Run runtime service account access. Store credentials in Secret Manager rather than repository variables, tracked files, or frontend bundles.

| Secret Manager name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | The secret API key for the intended Stripe account and mode |
| `STRIPE_WEBHOOK_SECRET` | The signing secret for that environment's registered webhook |
| `MEETINGS_CRON_SECRET` | The existing shared cron secret used by billing reconciliation |

After the secrets exist and the runtime service account can read them, set all four `STRIPE_PRICE_*` GitHub repository variables from the price table. Price IDs are configuration, not secrets. Deploy through the [backend workflow](../../.github/workflows/backend-deploy.yml), which replaces the service's environment and secret bindings on each deploy. The workflow rejects a partial set of price IDs and wires Stripe only when all four are present. It also mounts `MEETINGS_CRON_SECRET` for billing reconciliation, reusing the meeting-reminder binding when present; a reminders flag is not required for billing.

Confirm `CLIENT_URL` points to the correct frontend: [checkout and portal return URLs](../../backend/src/modules/shared/platform-billing/platform-billing.service.ts) use it. Check deployment logs for the intended Stripe mode without printing any credentials.

## 5. Schedule Hourly Reconciliation

Create or verify a Cloud Scheduler job for this target:

| Setting | Value |
| --- | --- |
| Schedule | `0 * * * *` with an explicit timezone, such as UTC |
| HTTP method | POST |
| Production URL | `https://api.proyekto.tech/api/platform-billing/cron/reconcile` |
| Authentication header | `x-cron-secret`, matching backend `MEETINGS_CRON_SECRET` |

The [cron guard](../../backend/src/common/guards/cron-secret.guard.ts) rejects calls without the matching secret. Reconciliation is required because memberships can change inside Postgres without a TypeScript hook. The [reconciler](../../backend/src/modules/shared/platform-billing/billing-reconcile.service.ts) repairs seats and subscription state, retries failed events, and prunes old event records. Configure a separate job and secret binding for a test backend.

## Validation

Complete payment and membership-change checks in a sandbox/test environment backed by development billing records. Use Stripe's [test payment methods](https://docs.stripe.com/testing), and verify these outcomes:

| Check | Expected result |
| --- | --- |
| Owner opens Checkout for each plan/interval | Correct USD amount and membership-derived quantity |
| Successful test checkout | Webhook succeeds; workspace records the correct plan, interval, customer, and subscription |
| Owner opens the portal | Both plans are available; quantities cannot be edited; payment methods and invoices are visible |
| Test cancellation | `cancel_at_period_end` is reflected in Proyekto |
| Test membership changes | Monthly changes affect the next invoice; annual additions invoice a proration and removals credit a future invoice |
| Test reconcile | Authorized request succeeds and corrects deliberately introduced test drift |

The [workspace controller](../../backend/src/modules/shared/platform-billing/workspace-billing.controller.ts) makes Checkout and portal actions owner-only; owners and admins can read the billing summary. Confirm the return page receives the webhook-backed state rather than treating `?checkout=success` as proof of payment.

For production verification, inspect active prices, secret bindings, portal settings, webhook delivery results, scheduler configuration, and the billing summary. A live purchase, annual seat increase, or reconciliation of live seat drift can create a charge; do not use those operations as a smoke test.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Purchases are unavailable | Backend key binding and all four price IDs; the provider is inert without `STRIPE_SECRET_KEY` |
| One interval fails Checkout | Matching `STRIPE_PRICE_*` value, active price, currency, and environment |
| Webhook returns a signature error | Registered URL, its signing secret, and snapshot payload version |
| Portal lacks plan changes | The default portal configuration and its allowed product/price list |
| Reconcile returns 401 | Backend `MEETINGS_CRON_SECRET` binding and Scheduler `x-cron-secret` value |
| Seats or plan remain stale | Failed webhook deliveries, retryable billing events, and the hourly reconcile job |
