import { createClient } from '@supabase/supabase-js';
import { fromZonedTime } from 'date-fns-tz';
import {
  addDays,
  isoDow,
  localDate,
  periodFor,
  retroactiveFloor,
  safeTimezone,
} from '../src/modules/execution/time/time-periods';
import type {
  LocalRange,
  PeriodSpec,
} from '../src/modules/execution/time/time-periods';
import type {
  EntryWithWarnings,
  LoggingForResult,
  ResolvedTimePolicy,
  TimeEntryView,
  TimesheetDetail,
  TimesheetRow,
} from '../src/modules/execution/time/time.types';

interface Manifest {
  key: string;
  project_id: string;
  contract_id: string;
  primary_team_id: string;
  secondary_team_id: string;
}

interface InvoiceLine {
  source_type: string;
  quantity: number | string;
  unit_rate: number | string;
  amount: number | string;
}

interface Invoice {
  id: string;
  status: string;
  total: number | string;
  line_items: InvoiceLine[];
}

/** The happy-path day: the latest weekday of the previous closed period, in the fixture policy timezone. */
interface WorkDay {
  day: string;
  timezone: string;
  today: string;
  previous: LocalRange;
  current: LocalRange;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`API request failed with ${status}: ${JSON.stringify(payload)}`);
  }
}

const apiUrl = must('QA_API_URL').replace(/\/+$/, '');
const fixtureKey = process.env.QA_FIXTURE_KEY ?? 'billing-v1';
const qaSecret = must('PRODUCTION_QA_SECRET');
const qaTarget = process.env.QA_TARGET ?? 'production';
/** D71: the one assertion this may skip is the invoice hours line, during the first period after M2. */
const allowBillingFloorSkip = process.env.QA_ALLOW_BILLING_FLOOR_SKIP === '1';

const NET_SECONDS = 25_200; // 09:00–17:00 local minus a 1 h break

async function main(): Promise<void> {
  if (!['production', 'development'].includes(qaTarget)) {
    throw new Error(`Unknown QA_TARGET: ${qaTarget}.`);
  }
  if (process.env.CONFIRM_PRODUCTION_QA !== `proyekto-${qaTarget}`) {
    throw new Error(
      `Refusing to run: set CONFIRM_PRODUCTION_QA=proyekto-${qaTarget}.`,
    );
  }
  const apiHost = new URL(apiUrl).hostname;
  const supabaseHost = new URL(must('QA_SUPABASE_URL')).hostname;
  if (qaTarget === 'production' && apiHost !== 'api.proyekto.tech') {
    throw new Error(`Refusing non-production API host: ${apiUrl}.`);
  }
  if (
    qaTarget === 'development' &&
    (!['localhost', '127.0.0.1'].includes(apiHost) ||
      supabaseHost !== 'vyiedlwasdwmjbztqznl.supabase.co')
  ) {
    throw new Error(
      `Refusing unsafe development targets: API=${apiHost}, Supabase=${supabaseHost}.`,
    );
  }

  let successful = false;
  let teamsDisabled = false;
  try {
    const manifest = await reset(false);
    const fixtureTeams = [manifest.primary_team_id, manifest.secondary_team_id];
    const [workerToken, consultantToken] = await Promise.all([
      signIn(must('QA_WORKER_EMAIL'), must('QA_WORKER_PASSWORD')),
      signIn(must('QA_CONSULTANT_EMAIL'), must('QA_CONSULTANT_PASSWORD')),
    ]);

    // ── Happy path: log, submit, approve, invoice ────────────────────────────────────────────────────────
    const picker = await loggingFor(workerToken, manifest.project_id);
    const primaryBlocked = picker.unavailable.find(
      (option) =>
        option.kind === 'team' && sameId(option.id, manifest.primary_team_id),
    );
    assert(
      !primaryBlocked,
      `The primary team is not a logging option for the worker (${primaryBlocked?.reason}).`,
    );
    const policy = await api<ResolvedTimePolicy>(
      `/api/time/projects/${manifest.project_id}/policy?for=team:${manifest.primary_team_id}`,
      { method: 'GET', token: workerToken },
    );
    assert(
      policy.allow_manual_entries !== false,
      'Manual time is off in the fixture policy; the happy path adds time manually.',
    );
    const work = previousClosedWeekday(policy);
    process.stdout.write(
      `Logging 7 h for ${work.day} (${work.timezone}, ${policy.period_kind} period ${work.previous.start} to ${work.previous.end}).\n`,
    );

    const entry = await api<EntryWithWarnings>('/api/time/entries', {
      method: 'POST',
      token: workerToken,
      body: {
        project_id: manifest.project_id,
        started_at: localIso(work.day, '09:00', work.timezone),
        ended_at: localIso(work.day, '17:00', work.timezone),
        break_seconds: 3_600,
        logging_for: { kind: 'team', id: manifest.primary_team_id },
      },
    });
    assert(
      entry.duration_seconds === NET_SECONDS,
      `Expected ${NET_SECONDS} net seconds, got ${entry.duration_seconds}.`,
    );
    assert(
      entry.break_seconds === 3_600,
      `Expected 3600 break seconds, got ${entry.break_seconds}.`,
    );
    assert(
      entry.break_minutes === 60,
      `Expected 60 break minutes, got ${entry.break_minutes}.`,
    );
    assert(
      entry.context_kind === 'team' &&
        sameId(entry.team_id, manifest.primary_team_id),
      `Happy-path entry is not for the primary team (${entry.context_kind} ${String(entry.team_id)}).`,
    );
    const sheetId = entry.timesheet_id;
    if (!sheetId) throw new Error('Happy-path entry has no timesheet.');

    const opened = await api<TimesheetDetail>(
      `/api/time/timesheets/${sheetId}`,
      { method: 'GET', token: workerToken },
    );
    assert(
      opened.sheet.status === 'open',
      `Expected an open sheet, got ${opened.sheet.status}.`,
    );
    assert(
      opened.sheet.period_start <= work.day &&
        work.day <= opened.sheet.period_end &&
        opened.sheet.period_end < work.today,
      `Sheet period ${opened.sheet.period_start} to ${opened.sheet.period_end} is not a closed period holding ${work.day} (today ${work.today}).`,
    );

    const submitted = await api<TimesheetRow>(
      `/api/time/timesheets/${sheetId}/submit`,
      {
        method: 'POST',
        token: workerToken,
        body: { expected_revision: opened.sheet.revision },
      },
    );
    assert(
      submitted.status === 'submitted',
      `Expected the sheet to wait for the consultant, got ${submitted.status} (approver_scope ${String(submitted.approver_scope)}). The fixture sheet must route to a decider other than the worker.`,
    );

    const review = await api<TimesheetDetail>(
      `/api/time/timesheets/${sheetId}`,
      { method: 'GET', token: consultantToken },
    );
    assert(
      review.viewer.can_decide,
      `The consultant cannot decide the fixture sheet (${review.sheet.scope_kind} scope, approver_scope ${String(review.sheet.approver_scope)}).`,
    );
    const approved = await api<TimesheetRow>(
      `/api/time/timesheets/${sheetId}/approve`,
      {
        method: 'POST',
        token: consultantToken,
        body: {
          expected_revision: review.sheet.revision,
          note: `Production QA ${work.day}`,
        },
      },
    );
    assert(
      approved.status === 'approved',
      `Expected an approved sheet, got ${approved.status}.`,
    );
    const frozen = await api<TimeEntryView>(`/api/time/entries/${entry.id}`, {
      method: 'GET',
      token: workerToken,
    });
    assert(
      frozen.payable_seconds === NET_SECONDS,
      `Expected ${NET_SECONDS} payable seconds after approval, got ${String(frozen.payable_seconds)}.`,
    );

    // D38: hours bill by period_start/period_end; hours_from/hours_to are ignored.
    const invoice = await createInvoice(consultantToken, manifest, work.day);
    // A time-based draft with nothing billable keeps a priced zero line, so an hours line has quantity > 0.
    const hours = invoice.line_items.find(
      (line) => line.source_type === 'time_log' && Number(line.quantity) > 0,
    );
    if (!hours) {
      if (!allowBillingFloorSkip) {
        throw new Error(
          `Invoice for ${work.day} has no hours line, though the entry is approved with ${NET_SECONDS} payable seconds. ` +
            'Likely cause: the billing floor. time_billing_floor = greatest(contract service_start_date, first ' +
            'legacy_import day), i.e. the day M2 was applied, and time dated before it never bills. Rerun once a ' +
            'full period has closed after that day, or set QA_ALLOW_BILLING_FLOOR_SKIP=1 to skip this assertion.',
        );
      }
      process.stdout.write(
        `SKIP invoice hours line (7 h x 100 = 700): ${work.day} is likely before the billing floor (QA_ALLOW_BILLING_FLOOR_SKIP=1).\n`,
      );
    } else {
      assert(
        Number(hours.quantity) === 7,
        `Expected 7 billed hours, got ${hours.quantity}.`,
      );
      assert(
        Number(hours.unit_rate) === 100,
        `Expected $100 client rate, got ${hours.unit_rate}.`,
      );
      assert(
        Number(hours.amount) === 700,
        `Expected $700 time amount, got ${hours.amount}.`,
      );
      assert(
        Number(invoice.total) === 700,
        `Expected $700 invoice total, got ${invoice.total}.`,
      );
    }

    const issueError = await expectApiError(
      api(`/api/invoices/${invoice.id}/issue`, {
        method: 'POST',
        token: consultantToken,
      }),
      'Fixture invoice issue',
    );
    assert(
      issueError.status === 409,
      `Expected issue 409, got ${issueError.status}.`,
    );
    assert(
      errorCode(issueError) === 'QA_FIXTURE_SIDE_EFFECT_BLOCKED',
      `Unexpected issue error code: ${String(errorCode(issueError))}.`,
    );

    await api(`/api/invoices/${invoice.id}`, {
      method: 'DELETE',
      token: consultantToken,
    });

    // ── D8 / B12: a switched-off team never receives time ───────────────────────────────────────────────
    // Both fixture teams go off, so the project has no team to log for (the old "sole team off" case). The
    // resolver lists them as unavailable and falls back to "Just me" (step 6) or offers nothing.
    for (const teamId of fixtureTeams) {
      await setTeamTime(consultantToken, teamId, false);
      teamsDisabled = true;
    }
    const off = await loggingFor(workerToken, manifest.project_id);
    for (const teamId of fixtureTeams) {
      const listed = off.unavailable.find(
        (option) => option.kind === 'team' && sameId(option.id, teamId),
      );
      assert(
        listed?.reason === 'team_time_off',
        `Expected team ${teamId} under unavailable with team_time_off, got ${String(listed?.reason)}.`,
      );
      assert(
        !off.options.some(
          (option) => option.kind === 'team' && sameId(option.id, teamId),
        ),
        `Switched-off team ${teamId} is still a logging option.`,
      );
    }

    const window = recentWindow(work.current, work.timezone);
    const refused = await expectApiError(
      api('/api/time/entries', {
        method: 'POST',
        token: workerToken,
        body: {
          project_id: manifest.project_id,
          ...window,
          break_seconds: 0,
          logging_for: { kind: 'team', id: manifest.primary_team_id },
        },
      }),
      'A switched-off team accepting time',
    );
    assert(
      (refused.status === 422 &&
        errorCode(refused) === 'LOGGING_FOR_INVALID') ||
        (refused.status === 403 && errorCode(refused) === 'NO_LOGGING_CONTEXT'),
      `Expected 422 LOGGING_FOR_INVALID (or 403 NO_LOGGING_CONTEXT) for the switched-off team, got ${refused.status} ${String(errorCode(refused))}.`,
    );

    // No logging_for: "Just me" when it is offered (assert personal, then delete), else 403 NO_LOGGING_CONTEXT.
    let fallback: EntryWithWarnings | null = null;
    try {
      fallback = await api<EntryWithWarnings>('/api/time/entries', {
        method: 'POST',
        token: workerToken,
        body: {
          project_id: manifest.project_id,
          ...window,
          break_seconds: 0,
        },
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      assert(
        error.status === 403 && errorCode(error) === 'NO_LOGGING_CONTEXT',
        `Expected a personal entry or 403 NO_LOGGING_CONTEXT, got ${error.status} ${String(errorCode(error))}.`,
      );
    }
    if (fallback) {
      await api(`/api/time/entries/${fallback.id}`, {
        method: 'DELETE',
        token: workerToken,
      });
      assert(
        fallback.context_kind === 'personal',
        `With every team off, time landed on a ${fallback.context_kind} context (${String(fallback.team_id)}).`,
      );
    }

    for (const teamId of fixtureTeams) {
      await setTeamTime(consultantToken, teamId, true);
    }
    teamsDisabled = false;
    const control = await api<EntryWithWarnings>('/api/time/entries', {
      method: 'POST',
      token: workerToken,
      body: {
        project_id: manifest.project_id,
        ...recentWindow(work.current, work.timezone),
        break_seconds: 0,
        logging_for: { kind: 'team', id: manifest.primary_team_id },
      },
    });
    assert(
      control.context_kind === 'team' &&
        sameId(control.team_id, manifest.primary_team_id),
      'Re-enabled control entry resolved to the wrong context.',
    );
    await api(`/api/time/entries/${control.id}`, {
      method: 'DELETE',
      token: workerToken,
    });

    successful = true;
    process.stdout.write('Production QA assertions passed.\n');
  } finally {
    // The reset RPC restores both team flags and clears the fixture's entries, reservations and sheets in
    // any status, so this also repairs a run that stopped mid-way (a team off, a sheet submitted or approved).
    await reset(successful);
    if (teamsDisabled)
      process.stdout.write('Fixture teams restored by final reset.\n');
  }
}

async function reset(markSuccess: boolean): Promise<Manifest> {
  return api<Manifest>(
    `/api/internal/qa-fixtures/${encodeURIComponent(fixtureKey)}/reset`,
    {
      method: 'POST',
      qaSecret,
      body: { mark_success: markSuccess },
    },
  );
}

/**
 * The picker, always resolved fresh. A plain read of "now" is cached for 30 s under the logging-for epoch, and the
 * fixture reset re-enables the teams in SQL without bumping it, so a rerun right after a run that stopped with the
 * teams off would read the cached "off" picker. A read dated two minutes back is outside the 60 s "now"
 * tolerance, so it is never cached, and it resolves the same options.
 */
function loggingFor(
  token: string,
  projectId: string,
): Promise<LoggingForResult> {
  const at = encodeURIComponent(new Date(Date.now() - 120_000).toISOString());
  return api<LoggingForResult>(
    `/api/time/projects/${projectId}/logging-for?at=${at}`,
    { method: 'GET', token },
  );
}

async function setTeamTime(
  token: string,
  teamId: string,
  enabled: boolean,
): Promise<void> {
  await api(`/api/teams/${teamId}`, {
    method: 'PATCH',
    token,
    body: { time_tracking_enabled: enabled },
  });
}

async function createInvoice(
  token: string,
  manifest: Manifest,
  day: string,
): Promise<Invoice> {
  try {
    return await api<Invoice>('/api/invoices', {
      method: 'POST',
      token,
      body: {
        project_id: manifest.project_id,
        contract_id: manifest.contract_id,
        period_start: day,
        period_end: day,
        attach_hours: true,
        hours_detail_level: 'summary',
        notes: `Production QA ${day}`,
      },
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      errorCode(error) === 'LEGACY_CONTRACT_AMBIGUOUS'
    ) {
      throw new Error(
        `${error.message}\nThe fixture contract has no engagement, and its provider seat names no team while the ` +
          `consultant owns both fixture teams on the project. Set the provider contract_positions.team_id to the ` +
          `primary team (${manifest.primary_team_id}) in the fixture.`,
      );
    }
    throw error;
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const client = createClient(
    must('QA_SUPABASE_URL'),
    must('QA_SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session)
    throw new Error(`QA sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

async function api<T = void>(
  path: string,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    token?: string;
    qaSecret?: string;
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.qaSecret ? { 'x-qa-secret': options.qaSecret } : {}),
      ...(options.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) throw new ApiError(response.status, payload);
  return ((payload as { data?: T } | undefined)?.data ?? payload) as T;
}

/** Resolves with the ApiError the request must fail with; a success is a failed assertion. */
async function expectApiError(
  request: Promise<unknown>,
  what: string,
): Promise<ApiError> {
  try {
    await request;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error(`${what} unexpectedly succeeded.`);
}

function errorCode(error: ApiError): string | undefined {
  return (error.payload as { error?: { code?: string } } | undefined)?.error
    ?.code;
}

/**
 * The latest weekday of the previous closed period (its `period_end` is before today in the policy timezone, so
 * a manual-route sheet may submit, D13), inside the retroactive window. The billing floor is not readable here:
 * when the day falls before it, the invoice has no hours line (D71).
 */
function previousClosedWeekday(
  policy: ResolvedTimePolicy,
  now = new Date(),
): WorkDay {
  const timezone = safeTimezone(policy.timezone);
  const spec: PeriodSpec = {
    kind: policy.period_kind,
    timezone,
    weekStart: policy.week_start,
    anchor: policy.period_anchor,
  };
  const today = localDate(now, timezone);
  const current = periodFor(spec, now);
  // Read the day before the current period at local noon: a bare date would read as its UTC midnight.
  const previous = periodFor(
    spec,
    fromZonedTime(`${addDays(current.start, -1)}T12:00:00`, timezone),
  );
  const floor = retroactiveFloor(now, timezone, policy.retroactive_days);
  for (let day = previous.end; day >= previous.start; day = addDays(day, -1)) {
    if (floor && day < floor) break;
    if (isoDow(day) <= 5) return { day, timezone, today, previous, current };
  }
  throw new Error(
    `No weekday of the previous period ${previous.start} to ${previous.end} (${timezone}) is inside the ` +
      `${String(policy.retroactive_days)}-day retroactive window.`,
  );
}

/** A local wall-clock time on a local date, as a UTC ISO instant (DST-correct). */
function localIso(day: string, time: string, timezone: string): string {
  return fromZonedTime(`${day}T${time}:00`, timezone).toISOString();
}

/** Up to an hour of past time inside the current (open) period, so the entry lands on an open sheet. */
function recentWindow(
  current: LocalRange,
  timezone: string,
): { started_at: string; ended_at: string } {
  const periodStart = fromZonedTime(
    `${current.start}T00:00:00`,
    timezone,
  ).getTime();
  const end = Date.now() - 60_000;
  const start = Math.max(periodStart, end - 3_600_000);
  if (end - start < 300_000) {
    throw new Error(
      'The current period started only minutes ago; rerun in a few minutes.',
    );
  }
  return {
    started_at: new Date(start).toISOString(),
    ended_at: new Date(end).toISOString(),
  };
}

function sameId(a: string | null | undefined, b: string): boolean {
  return (a ?? '').toLowerCase() === b.toLowerCase();
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function must(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
