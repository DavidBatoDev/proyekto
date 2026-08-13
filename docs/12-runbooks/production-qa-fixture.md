# Production QA Fixture

> **Last updated:** 2026-08-13 · **Status:** current

The billing fixture verifies production behavior through real authenticated API
requests without touching client work. Its core commercial graph persists, while
each run removes its draft invoices, time logs, and notifications.

## Safety model

| Control                | Behavior                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| Registry               | `qa_fixtures` is service-role only and never grants access                  |
| Reset                  | A transaction can reset only a registered fixture key                       |
| Contamination          | Reset stops on non-draft invoices or paid logs                              |
| Client contact         | All QA addresses are suppressed                                             |
| Financial finalization | Invoice issue/resend/payment, payouts, and signature-link email are blocked |
| Scheduler              | Registered contracts never produce scheduled drafts                         |
| Authentication         | Behavioral checks use the three real synthetic accounts                     |

The fixture remains visible in platform-admin lists under names beginning with
`[QA]`. Do not filter it from ordinary reads: future finance and client-projection
checks need the same query paths as production data.

## One-time setup

1. Apply `20260813120000_production_qa_fixtures.sql` to the Singapore project
   through the Supabase MCP migration path.
2. Confirm the migration, policies, function grants, and security/performance
   advisors before deploying the backend.
3. Create a random `PRODUCTION_QA_SECRET` in GCP Secret Manager and store the same
   value in the protected GitHub `production` environment.
4. Add these protected GitHub secrets:

| Secret                                           | Purpose                                     |
| ------------------------------------------------ | ------------------------------------------- |
| `QA_SUPABASE_URL`                                | Singapore Supabase URL                      |
| `QA_SUPABASE_ANON_KEY`                           | Public key used only for QA account sign-in |
| `QA_CONSULTANT_EMAIL` / `QA_CONSULTANT_PASSWORD` | Consultant fixture account                  |
| `QA_WORKER_EMAIL` / `QA_WORKER_PASSWORD`         | Worker fixture account                      |
| `PRODUCTION_QA_SECRET`                           | Reset endpoint authentication               |

5. On a trusted operator machine, provide `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, the consultant and worker credentials above, plus
   `QA_CLIENT_EMAIL` and `QA_CLIENT_PASSWORD`, then run:

```bash
cd backend
CONFIRM_PRODUCTION_QA=proyekto-production npm run qa:seed:production
```

The seeder is idempotent. It repairs the known graph and synchronizes the three
synthetic passwords to the supplied values; it does not create duplicate projects
or teams.

6. Set the repository variable `PRODUCTION_QA_ENABLED=true` and redeploy the
   backend. The Cloud Run workflow attaches the GCP secret only while enabled.

## Run verification

Open **Actions → Production QA — Billing Fixture → Run workflow**. Runs serialize
through one concurrency group and verify:

- an eight-hour log with a one-hour break stores and bills seven hours;
- the invoice uses the `$100` client rate and totals `$700`, not the `$40`
  internal rate;
- issuing the synthetic invoice is rejected before any PDF/email mutation;
- an enabled secondary team cannot mask the disabled resolved primary team;
- re-enabling the primary team restores log creation.

The final reset runs even after a failed assertion. A successful final reset also
updates `qa_fixtures.last_success_at`.

## Failure recovery

| Symptom                                          | Action                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Reset reports `QA_FIXTURE_CORE_INVALID`          | Re-run the trusted seeder and inspect deleted/detached core rows                              |
| Reset reports `QA_FIXTURE_HAS_NON_DRAFT_INVOICE` | Inspect the invoice; never delete an issued financial record to force a green run             |
| Reset reports `QA_FIXTURE_HAS_PAID_LOG`          | Inspect the payout and log; treat it as fixture contamination requiring manual reconciliation |
| Workflow gets 404 from reset                     | Confirm `PRODUCTION_QA_ENABLED` and the latest backend deployment                             |
| Workflow gets 401 from reset                     | Synchronize the GCP and GitHub copies of `PRODUCTION_QA_SECRET`                               |
| Authentication fails                             | Re-run the seeder with the protected account passwords                                        |

Disable the control surface by removing or clearing `PRODUCTION_QA_ENABLED` and
redeploying. The side-effect blocks remain enforced for registered fixture rows.
