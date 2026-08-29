import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PostingSection } from './postings.types';

export interface GeneratedBrief {
  title: string;
  engagement_type: 'ongoing' | 'one_time';
  summary: string;
  sections: PostingSection[];
}

/**
 * Calls the Python agent's one-shot brief generator.
 *
 * The browser talks to the agent directly for roadmap AI, and deliberately does
 * not here: those endpoints end at NestJS for every piece of data they touch, so
 * authorization is enforced on the way through. This one touches no data and
 * only spends OpenAI credits, so an unauthenticated route would be a metered
 * open proxy. The user's session is checked by this controller; the agent
 * checks the shared secret.
 *
 * Unset config is dormant, not broken: "Generate brief" returns a 503 that the
 * editor turns into a message, the typed text is kept, and hand-authoring a
 * brief never depended on the agent being reachable.
 */
@Injectable()
export class BriefGeneratorService {
  private readonly logger = new Logger(BriefGeneratorService.name);
  private readonly agentUrl?: string;
  private readonly internalToken?: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    // Falls back to the conventional local agent port outside production so a
    // developer running the stack gets a working button without a config step;
    // in production an unset URL stays dormant, as documented below.
    this.agentUrl =
      this.config.get<string>('AGENT_API_URL') ??
      (this.config.get<string>('NODE_ENV') === 'production'
        ? undefined
        : 'http://localhost:8010');
    this.internalToken = this.config.get<string>('AGENT_INTERNAL_TOKEN');
    // 60s: a structured draft on a reasoning model runs 10-30s, and the agent's
    // own OpenAI timeout is 60s — timing out first would only hide its error.
    this.timeoutMs =
      this.config.get<number>('AGENT_BRIEF_TIMEOUT_MS') ?? 60_000;
  }

  /**
   * The URL is what makes the generator reachable; the token is what the agent
   * checks. They are separate on purpose: an agent running with APP_ENV of
   * development accepts calls without a token, so requiring one here would make
   * local setup need a secret that nothing verifies. Outside development the
   * agent fails closed on a missing or wrong token, which is where that rule
   * belongs — on the side being protected.
   */
  get isConfigured(): boolean {
    return Boolean(this.agentUrl);
  }

  async generate(
    description: string,
    categoryHint?: string,
  ): Promise<GeneratedBrief> {
    if (!this.agentUrl) {
      throw new ServiceUnavailableException(
        'The brief generator is not available right now. You can still write the brief yourself.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `${this.agentUrl.replace(/\/$/, '')}/briefs/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.internalToken
              ? { 'X-Internal-Token': this.internalToken }
              : {}),
          },
          body: JSON.stringify({
            description,
            category_hint: categoryHint ?? null,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.warn(
          `brief generation failed: ${response.status} ${detail.slice(0, 300)}`,
        );
        throw new BadGatewayException(
          'The brief generator could not draft this one. Try rephrasing, or write it yourself.',
        );
      }

      const body = (await response.json()) as {
        title?: unknown;
        engagement_type?: unknown;
        summary?: unknown;
        sections?: unknown;
      };
      return normalizeGeneratedBrief(body);
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadGatewayException(
          'The brief generator took too long. Try again, or write the brief yourself.',
        );
      }
      this.logger.error(
        `brief generation errored: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException(
        'The brief generator is unreachable right now.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * The agent is a separate deployable on its own release cadence, so its
 * response is treated as untrusted input rather than as a typed contract.
 */
export function normalizeGeneratedBrief(body: {
  title?: unknown;
  engagement_type?: unknown;
  summary?: unknown;
  sections?: unknown;
}): GeneratedBrief {
  const sections = Array.isArray(body.sections) ? body.sections : [];
  return {
    title: typeof body.title === 'string' ? body.title.trim() : '',
    engagement_type:
      body.engagement_type === 'ongoing' ? 'ongoing' : 'one_time',
    summary: typeof body.summary === 'string' ? body.summary.trim() : '',
    sections: sections
      .filter(
        (section): section is { key: unknown; value: unknown } =>
          !!section && typeof section === 'object',
      )
      .map((section) => ({
        key: typeof section.key === 'string' ? section.key.trim() : '',
        value: typeof section.value === 'string' ? section.value.trim() : '',
      }))
      .filter((section) => section.key !== '' && section.value !== '')
      .map((section, index) => ({ ...section, position: index })),
  };
}
