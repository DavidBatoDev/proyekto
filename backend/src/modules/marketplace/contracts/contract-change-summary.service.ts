import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { AgentInternalClient } from '../../../common/agent/agent-internal.client';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  type ContractDiff,
  type DiffRow,
  type DiffSeat,
  diffRows,
} from './contract-diff';

export interface SummaryBullet {
  text: string;
  /** The diff rows this bullet explains. Always non-empty and always real. */
  row_ids: string[];
}

export interface ContractChangeSummary {
  headline: string;
  bullets: SummaryBullet[];
  for_you: string | null;
  seat: DiffSeat;
  model: string;
  cached: boolean;
  generated_at: string;
  disclaimer: string;
}

interface AgentSummaryResponse {
  headline?: unknown;
  bullets?: unknown;
  for_you?: unknown;
  model?: unknown;
}

export const SUMMARY_DISCLAIMER =
  'AI summary. Check the comparison table for the exact terms. This is not legal advice.';

/**
 * Keeps only bullets that cite at least one real diff row, and drops the
 * citations that are not real. A bullet the server cannot match to a row is
 * the model inventing a change, so it never reaches the reader.
 */
export function groundSummary(
  raw: AgentSummaryResponse,
  rows: DiffRow[],
): { headline: string; bullets: SummaryBullet[]; for_you: string | null } {
  const ids = new Set(rows.map((row) => row.id));
  const bullets: SummaryBullet[] = [];
  for (const entry of Array.isArray(raw.bullets) ? raw.bullets : []) {
    const bullet = entry as { text?: unknown; row_ids?: unknown };
    const text = typeof bullet.text === 'string' ? bullet.text.trim() : '';
    const cited = Array.isArray(bullet.row_ids)
      ? bullet.row_ids.filter(
          (id): id is string => typeof id === 'string' && ids.has(id),
        )
      : [];
    if (text && cited.length > 0) {
      bullets.push({ text: text.slice(0, 600), row_ids: [...new Set(cited)] });
    }
  }
  return {
    headline:
      typeof raw.headline === 'string' ? raw.headline.trim().slice(0, 200) : '',
    bullets,
    for_you:
      typeof raw.for_you === 'string' && raw.for_you.trim()
        ? raw.for_you.trim().slice(0, 1200)
        : null,
  };
}

/**
 * The input the agent receives: the computed diff rows, nothing else. The
 * rows were already filtered for the viewer's seat by diffContractTerms, so a
 * client's input never carries consultant-only fields.
 */
export function summaryInput(
  diff: ContractDiff,
  context: {
    seat: DiffSeat;
    seatLabel: string;
    fromVersion: number;
    toVersion: number;
    effectiveFrom: string | null;
    documentTitle: string;
  },
) {
  return {
    seat: context.seat,
    seat_label: context.seatLabel,
    document_title: context.documentTitle,
    from_version: context.fromVersion,
    to_version: context.toVersion,
    effective_from: context.effectiveFrom,
    rows: diffRows(diff).map((row) => {
      if (row.kind === 'field') {
        return {
          id: row.id,
          kind: row.kind,
          label: row.label,
          before: row.before,
          after: row.after,
        };
      }
      if (row.kind === 'service') {
        return {
          id: row.id,
          kind: row.kind,
          label: `Service: ${row.name}`,
          change: row.change,
          before: row.before,
          after: row.after,
        };
      }
      return {
        id: row.id,
        kind: row.kind,
        label: `Clause: ${row.title}`,
        change: row.change,
        // Clause bodies are capped so one long clause cannot blow the budget.
        before: row.before?.slice(0, 4000) ?? null,
        after: row.after?.slice(0, 4000) ?? null,
      };
    }),
  };
}

@Injectable()
export class ContractChangeSummaryService {
  private readonly logger = new Logger(ContractChangeSummaryService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly agent: AgentInternalClient,
  ) {}

  /**
   * The cached summary for this pair, seat and pair of revisions, or a fresh
   * one from the agent. Signed versions never change, so each seat generates
   * once; a draft side regenerates when its revision moves.
   */
  async summarize(input: {
    callerId: string;
    from: { id: string; version: number; revision: number };
    to: {
      id: string;
      version: number;
      revision: number;
      amendment_effective_date: string | null;
      document_title: string;
    };
    seat: DiffSeat;
    seatLabel: string;
    diff: ContractDiff;
  }): Promise<ContractChangeSummary> {
    const rows = diffRows(input.diff);
    const { data: cached } = await this.supabase
      .from('contract_change_summaries')
      .select('summary, model, created_at')
      .eq('from_contract_id', input.from.id)
      .eq('to_contract_id', input.to.id)
      .eq('seat', input.seat)
      .eq('from_revision', input.from.revision)
      .eq('to_revision', input.to.revision)
      .maybeSingle();
    const hit = cached as {
      summary: Omit<
        ContractChangeSummary,
        'cached' | 'seat' | 'model' | 'generated_at' | 'disclaimer'
      >;
      model: string;
      created_at: string;
    } | null;
    if (hit) {
      return {
        ...hit.summary,
        seat: input.seat,
        model: hit.model,
        cached: true,
        generated_at: hit.created_at,
        disclaimer: SUMMARY_DISCLAIMER,
      };
    }

    if (rows.length === 0) {
      return {
        headline: 'These versions have the same terms.',
        bullets: [],
        for_you: null,
        seat: input.seat,
        model: 'none',
        cached: false,
        generated_at: new Date().toISOString(),
        disclaimer: SUMMARY_DISCLAIMER,
      };
    }

    const raw = await this.agent.post<AgentSummaryResponse>(
      '/contracts/summarize-changes',
      summaryInput(input.diff, {
        seat: input.seat,
        seatLabel: input.seatLabel,
        fromVersion: input.from.version,
        toVersion: input.to.version,
        effectiveFrom: input.to.amendment_effective_date,
        documentTitle: input.to.document_title,
      }),
      {
        timeoutMs: 60_000,
        unavailableMessage:
          'The AI summary is not available right now. The comparison table below is complete.',
      },
    );
    const grounded = groundSummary(raw, rows);
    const model = typeof raw.model === 'string' ? raw.model : 'unknown';
    const now = new Date().toISOString();

    const { error } = await this.supabase
      .from('contract_change_summaries')
      .insert({
        from_contract_id: input.from.id,
        to_contract_id: input.to.id,
        seat: input.seat,
        from_revision: input.from.revision,
        to_revision: input.to.revision,
        model,
        summary: grounded,
        created_by: input.callerId,
      });
    if (error && !/duplicate key/i.test(error.message)) {
      this.logger.warn(`summary not cached: ${error.message}`);
    }
    // TODO(billing): count one message against ai_messages_monthly once that
    // quota is enforced anywhere (it is display-only in ENTITLEMENT_KEYS).
    return {
      ...grounded,
      seat: input.seat,
      model,
      cached: false,
      generated_at: now,
      disclaimer: SUMMARY_DISCLAIMER,
    };
  }
}
