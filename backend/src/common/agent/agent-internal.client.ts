import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * NestJS -> agent service, for the one-shot document AI routes (contract
 * change summaries, document intake, the invoice reader).
 *
 * Same pattern as BriefGeneratorService: the browser never calls these agent
 * routes. NestJS authorizes the human first, then forwards with the shared
 * AGENT_INTERNAL_TOKEN; the agent route checks only that secret and never
 * touches the database. All document AI therefore runs on the agent's OpenAI
 * key and model (OPENAI_MODEL_V2), not the backend's OPENAI_API_KEY.
 */
@Injectable()
export class AgentInternalClient {
  private readonly logger = new Logger(AgentInternalClient.name);
  private readonly agentUrl?: string;
  private readonly internalToken?: string;

  constructor(private readonly config: ConfigService) {
    this.agentUrl =
      this.config.get<string>('AGENT_API_URL') ??
      (this.config.get<string>('NODE_ENV') === 'production'
        ? undefined
        : 'http://localhost:8010');
    this.internalToken = this.config.get<string>('AGENT_INTERNAL_TOKEN');
  }

  get isConfigured(): boolean {
    return Boolean(this.agentUrl);
  }

  /**
   * POST a JSON body to an internal agent route. Throws 503 when the agent is
   * not configured and 502 when it fails or times out; callers that must
   * never throw (the invoice reader) catch and degrade.
   */
  async post<T>(
    path: string,
    body: unknown,
    options: { timeoutMs?: number; unavailableMessage?: string } = {},
  ): Promise<T> {
    if (!this.agentUrl) {
      throw new ServiceUnavailableException(
        options.unavailableMessage ??
          'The AI service is not available right now.',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 60_000,
    );
    try {
      const response = await fetch(
        `${this.agentUrl.replace(/\/$/, '')}${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.internalToken
              ? { 'X-Internal-Token': this.internalToken }
              : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.warn(
          `agent ${path} failed: ${response.status} ${detail.slice(0, 300)}`,
        );
        throw new BadGatewayException('The AI service could not answer.');
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadGatewayException('The AI service took too long.');
      }
      this.logger.error(
        `agent ${path} errored: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException('The AI service is unreachable right now.');
    } finally {
      clearTimeout(timer);
    }
  }
}
