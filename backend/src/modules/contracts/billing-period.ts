/**
 * Billing-period resolution for contracts.
 *
 * This is the backend port of the cut-off logic in
 * `web/src/components/team-time/log-period.ts`. Both sides MUST agree: the
 * client invoice for a period has to cover exactly the hours the team approved
 * and paid out for the same cut-off, otherwise billed and paid hours drift.
 *
 * Dates here are plain calendar dates (`YYYY-MM-DD`), never timestamps — a
 * billing period is a calendar concept and must not shift with the server's
 * timezone. All arithmetic goes through UTC-noon Date objects so a DST
 * transition can never roll a day boundary.
 */

/** A payout cut-off period. `end_day` is a day-of-month or "EOM". */
export type PayPeriodEndDay = number | 'EOM';

export interface PayPeriodDef {
  id: string;
  label: string;
  start_day: number;
  end_day: PayPeriodEndDay;
  pay_day: number;
  /** 0 = pay in the same month as the period, 1 = next month, etc. */
  pay_month_offset: number;
}

export interface PayPeriodConfig {
  cadence: 'monthly';
  periods: PayPeriodDef[];
}

/**
 * Mirrors DEFAULT_PAY_PERIOD_CONFIG in log-period.ts: PH semi-monthly
 * (1–15 paid on the 22nd; 16–EOM paid on the 7th of the next month).
 */
export const DEFAULT_PAY_PERIOD_CONFIG: PayPeriodConfig = {
  cadence: 'monthly',
  periods: [
    {
      id: 'h1',
      label: '1st half',
      start_day: 1,
      end_day: 15,
      pay_day: 22,
      pay_month_offset: 0,
    },
    {
      id: 'h2',
      label: '2nd half',
      start_day: 16,
      end_day: 'EOM',
      pay_day: 7,
      pay_month_offset: 1,
    },
  ],
};

/** A single monthly period, used when a contract bills monthly. */
export const MONTHLY_PAY_PERIOD_CONFIG: PayPeriodConfig = {
  cadence: 'monthly',
  periods: [
    {
      id: 'full',
      label: 'Full month',
      start_day: 1,
      end_day: 'EOM',
      pay_day: 15,
      pay_month_offset: 1,
    },
  ],
};

export interface BillingPeriod {
  /** Stable id: `${YYYY-MM}:${periodDefId}`. */
  id: string;
  label: string;
  /** Inclusive calendar bounds, `YYYY-MM-DD`. */
  periodStart: string;
  periodEnd: string;
  /** Date the invoice should be raised (period end + invoice_offset_days). */
  invoiceDate: string;
  /** Payment due date (invoice date + due_days). */
  dueDate: string;
  /** Scheduled team pay date for this cut-off, from the pay-period config. */
  payDate: string;
}

// ─── calendar helpers ────────────────────────────────────────────────────────
// UTC noon keeps every date safely inside its own day regardless of the host
// timezone, so `addDays`/`addMonths` can never straddle a boundary.

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
}

export function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  const [, y, m, d] = match;
  return utcDate(Number(y), Number(m) - 1, Number(d));
}

export function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  return utcDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  );
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
}

/**
 * Adds whole months, clamping the day to the target month's length so that
 * e.g. Jan 31 + 1 month is Feb 28/29 rather than rolling into March.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const normalizedYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(
    date.getUTCDate(),
    lastDayOfMonth(normalizedYear, normalizedMonth),
  );
  return utcDate(normalizedYear, normalizedMonth, day);
}

/** Returns the config when it is usable, else the default. */
export function normalizePayPeriodConfig(
  config?: PayPeriodConfig | null,
): PayPeriodConfig {
  if (
    config &&
    config.cadence === 'monthly' &&
    Array.isArray(config.periods) &&
    config.periods.length > 0
  ) {
    return config;
  }
  return DEFAULT_PAY_PERIOD_CONFIG;
}

interface ResolveOptions {
  invoiceOffsetDays?: number;
  dueDays?: number;
}

function resolveOne(
  def: PayPeriodDef,
  year: number,
  monthIndex: number,
  options: ResolveOptions,
): BillingPeriod {
  const eom = lastDayOfMonth(year, monthIndex);
  const startDay = Math.min(Math.max(1, def.start_day), eom);
  const endDay =
    def.end_day === 'EOM' ? eom : Math.min(Math.max(1, def.end_day), eom);
  const from = utcDate(year, monthIndex, startDay);
  const to = utcDate(year, monthIndex, endDay);

  const payMonthIndex = monthIndex + (def.pay_month_offset ?? 0);
  const payYear = year + Math.floor(payMonthIndex / 12);
  const payMonth = ((payMonthIndex % 12) + 12) % 12;
  const payEom = lastDayOfMonth(payYear, payMonth);
  const payDate = utcDate(
    payYear,
    payMonth,
    Math.min(Math.max(1, def.pay_day), payEom),
  );

  const invoiceDate = addDays(to, options.invoiceOffsetDays ?? 0);
  const dueDate = addDays(invoiceDate, options.dueDays ?? 0);
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

  return {
    id: `${monthKey}:${def.id}`,
    label:
      def.end_day === 'EOM'
        ? `${startDay}–EOM ${monthKey}`
        : `${startDay}–${endDay} ${monthKey}`,
    periodStart: toIsoDate(from),
    periodEnd: toIsoDate(to),
    invoiceDate: toIsoDate(invoiceDate),
    dueDate: toIsoDate(dueDate),
    payDate: toIsoDate(payDate),
  };
}

/** Concrete billing windows for the calendar month containing `monthAnchor`. */
export function billingPeriodsForMonth(
  config: PayPeriodConfig | null | undefined,
  monthAnchor: Date,
  options: ResolveOptions = {},
): BillingPeriod[] {
  const cfg = normalizePayPeriodConfig(config);
  const year = monthAnchor.getUTCFullYear();
  const monthIndex = monthAnchor.getUTCMonth();
  return cfg.periods
    .map((def) => resolveOne(def, year, monthIndex, options))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/**
 * Every billing period between `serviceStart` and `serviceEnd` inclusive.
 *
 * A period is included when it OVERLAPS the service window at all, so a
 * contract starting mid-cut-off still bills that partial period rather than
 * silently skipping it.
 */
export function billingPeriodsForRange(
  config: PayPeriodConfig | null | undefined,
  serviceStart: string,
  serviceEnd: string,
  options: ResolveOptions = {},
): BillingPeriod[] {
  const start = parseIsoDate(serviceStart);
  const end = parseIsoDate(serviceEnd);
  if (end < start) return [];

  const periods: BillingPeriod[] = [];
  // Walk one month before to one month after so periods that straddle the
  // window edges are considered.
  let cursor = addMonthsClamped(
    utcDate(start.getUTCFullYear(), start.getUTCMonth(), 1),
    -1,
  );
  const limit = addMonthsClamped(
    utcDate(end.getUTCFullYear(), end.getUTCMonth(), 1),
    1,
  );

  while (cursor <= limit) {
    for (const period of billingPeriodsForMonth(config, cursor, options)) {
      if (
        period.periodEnd >= serviceStart.slice(0, 10) &&
        period.periodStart <= serviceEnd.slice(0, 10)
      ) {
        periods.push(period);
      }
    }
    cursor = addMonthsClamped(cursor, 1);
  }

  // Clamp the first/last period to the service window so a client is never
  // billed for days outside the contract.
  return periods.map((period) => {
    const clampedStart =
      period.periodStart < serviceStart ? serviceStart : period.periodStart;
    const clampedEnd =
      period.periodEnd > serviceEnd ? serviceEnd : period.periodEnd;
    if (
      clampedStart === period.periodStart &&
      clampedEnd === period.periodEnd
    ) {
      return period;
    }
    const invoiceDate = addDays(
      parseIsoDate(clampedEnd),
      options.invoiceOffsetDays ?? 0,
    );
    return {
      ...period,
      periodStart: clampedStart,
      periodEnd: clampedEnd,
      invoiceDate: toIsoDate(invoiceDate),
      dueDate: toIsoDate(addDays(invoiceDate, options.dueDays ?? 0)),
    };
  });
}

/** The billing period containing `date`, or null if none does. */
export function billingPeriodForDate(
  config: PayPeriodConfig | null | undefined,
  date: string,
  options: ResolveOptions = {},
): BillingPeriod | null {
  const anchor = parseIsoDate(date);
  const day = date.slice(0, 10);
  const candidates = billingPeriodsForMonth(config, anchor, options);
  return (
    candidates.find((p) => p.periodStart <= day && day <= p.periodEnd) ?? null
  );
}

/**
 * The most recent period that has fully CLOSED and whose invoice date has
 * arrived, given `today`. Returns null when nothing is billable yet.
 *
 * This is what the scheduler bills: never an in-flight period, and never
 * before `invoice_offset_days` has elapsed.
 */
export function lastBillablePeriod(
  config: PayPeriodConfig | null | undefined,
  serviceStart: string,
  serviceEnd: string,
  today: string,
  options: ResolveOptions = {},
): BillingPeriod | null {
  const periods = billingPeriodsForRange(
    config,
    serviceStart,
    serviceEnd,
    options,
  );
  const day = today.slice(0, 10);
  const closed = periods.filter(
    (p) => p.periodEnd < day && p.invoiceDate <= day,
  );
  return closed.length > 0 ? closed[closed.length - 1] : null;
}

/** The pay-period config a contract should bill against. */
export function configForCadence(
  cadence: 'monthly' | 'semi_monthly' | 'custom',
  teamConfig?: PayPeriodConfig | null,
): PayPeriodConfig {
  if (cadence === 'monthly') return MONTHLY_PAY_PERIOD_CONFIG;
  // semi_monthly / custom both defer to the team's configured cut-offs, which
  // is the whole point of `period_source = 'team_config'`.
  return normalizePayPeriodConfig(teamConfig);
}
