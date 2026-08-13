import { createClient } from '@supabase/supabase-js';

interface Manifest {
  key: string;
  project_id: string;
  contract_id: string;
  primary_team_id: string;
  secondary_team_id: string;
}

interface TimeLog {
  id: string;
  team_id: string;
  duration_seconds: number;
  break_seconds: number;
  break_minutes: number;
  status: string;
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
  let primaryDisabled = false;
  try {
    const manifest = await reset(false);
    const [workerToken, consultantToken] = await Promise.all([
      signIn(must('QA_WORKER_EMAIL'), must('QA_WORKER_PASSWORD')),
      signIn(must('QA_CONSULTANT_EMAIL'), must('QA_CONSULTANT_PASSWORD')),
    ]);

    const { day, start, end, dayStart, dayEnd } = previousUtcDayWindow();
    const log = await api<TimeLog>('/api/team-time/logs/manual', {
      method: 'POST',
      token: workerToken,
      body: {
        project_id: manifest.project_id,
        started_at: start,
        ended_at: end,
        break_minutes: 60,
      },
    });
    assert(
      log.duration_seconds === 25_200,
      `Expected 25200 net seconds, got ${log.duration_seconds}.`,
    );
    assert(
      log.break_seconds === 3_600,
      `Expected 3600 break seconds, got ${log.break_seconds}.`,
    );
    assert(
      log.break_minutes === 60,
      `Expected 60 break minutes, got ${log.break_minutes}.`,
    );
    assert(
      log.team_id === manifest.primary_team_id,
      'Happy-path log did not resolve to the primary team.',
    );

    const approved = await api<TimeLog>(
      `/api/team-time/logs/${log.id}/review`,
      {
        method: 'POST',
        token: consultantToken,
        body: { decision: 'approved', reason: `Production QA ${day}` },
      },
    );
    assert(
      approved.status === 'approved',
      `Expected approved log, got ${approved.status}.`,
    );

    const invoice = await api<Invoice>('/api/invoices', {
      method: 'POST',
      token: consultantToken,
      body: {
        project_id: manifest.project_id,
        contract_id: manifest.contract_id,
        period_start: day,
        period_end: day,
        hours_from: dayStart,
        hours_to: dayEnd,
        attach_hours: true,
        hours_detail_level: 'summary',
        notes: `Production QA ${day}`,
      },
    });
    const hours = invoice.line_items.find(
      (line) => line.source_type === 'time_log',
    );
    assert(Boolean(hours), 'Invoice has no time-log line.');
    assert(
      Number(hours!.quantity) === 7,
      `Expected 7 billed hours, got ${hours!.quantity}.`,
    );
    assert(
      Number(hours!.unit_rate) === 100,
      `Expected $100 client rate, got ${hours!.unit_rate}.`,
    );
    assert(
      Number(hours!.amount) === 700,
      `Expected $700 time amount, got ${hours!.amount}.`,
    );
    assert(
      Number(invoice.total) === 700,
      `Expected $700 invoice total, got ${invoice.total}.`,
    );

    try {
      await api(`/api/invoices/${invoice.id}/issue`, {
        method: 'POST',
        token: consultantToken,
      });
      throw new Error('Fixture invoice issue unexpectedly succeeded.');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const code = (error.payload as { error?: { code?: string } })?.error
        ?.code;
      assert(error.status === 409, `Expected issue 409, got ${error.status}.`);
      assert(
        code === 'QA_FIXTURE_SIDE_EFFECT_BLOCKED',
        `Unexpected issue error code: ${String(code)}.`,
      );
    }

    await api(`/api/invoices/${invoice.id}`, {
      method: 'DELETE',
      token: consultantToken,
    });

    await api(`/api/teams/${manifest.primary_team_id}`, {
      method: 'PATCH',
      token: consultantToken,
      body: { time_tracking_enabled: false },
    });
    primaryDisabled = true;

    try {
      await api('/api/team-time/logs/manual', {
        method: 'POST',
        token: workerToken,
        body: {
          project_id: manifest.project_id,
          started_at: `${day}T18:00:00.000Z`,
          ended_at: `${day}T19:00:00.000Z`,
          break_minutes: 0,
        },
      });
      throw new Error('Disabled resolved team unexpectedly accepted a log.');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const message = (error.payload as { error?: { message?: string } })?.error
        ?.message;
      assert(error.status === 403, `Expected D8 403, got ${error.status}.`);
      assert(
        message ===
          'Time tracking is not enabled for the team selected for this work. The team owner must enable it in team settings.',
        `Unexpected D8 message: ${String(message)}.`,
      );
    }

    await api(`/api/teams/${manifest.primary_team_id}`, {
      method: 'PATCH',
      token: consultantToken,
      body: { time_tracking_enabled: true },
    });
    primaryDisabled = false;
    const controlLog = await api<TimeLog>('/api/team-time/logs/manual', {
      method: 'POST',
      token: workerToken,
      body: {
        project_id: manifest.project_id,
        started_at: `${day}T18:00:00.000Z`,
        ended_at: `${day}T19:00:00.000Z`,
        break_minutes: 0,
      },
    });
    assert(
      controlLog.team_id === manifest.primary_team_id,
      'Re-enabled control log resolved to the wrong team.',
    );
    await api(`/api/team-time/logs/${controlLog.id}`, {
      method: 'DELETE',
      token: workerToken,
    });

    successful = true;
    process.stdout.write('Production QA assertions passed.\n');
  } finally {
    // The reset RPC restores both flags, so this also repairs a failed run that
    // stopped while the primary team was disabled.
    await reset(successful);
    if (primaryDisabled)
      process.stdout.write('Primary team restored by final reset.\n');
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

function previousUtcDayWindow(): {
  day: string;
  start: string;
  end: string;
  dayStart: string;
  dayEnd: string;
} {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  const day = date.toISOString().slice(0, 10);
  return {
    day,
    start: `${day}T09:00:00.000Z`,
    end: `${day}T17:00:00.000Z`,
    dayStart: `${day}T00:00:00.000Z`,
    dayEnd: `${day}T23:59:59.999Z`,
  };
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
