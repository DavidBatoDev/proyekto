import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TITLE_MODEL = 'gpt-4o-mini';
const MAX_TITLE_CHARS = 60;
const REQUEST_TIMEOUT_MS = 10_000;

interface ChatCompletionChoice {
  message?: { content?: string | null };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

// Auto-generates a short title for a roadmap AI thread from its first two
// turns. Called fire-and-forget from `RoadmapAiSessionsService.appendMessage`
// after the first assistant reply is persisted. All failures are swallowed
// with a warning — titles are a nice-to-have, never on the critical path.
@Injectable()
export class RoadmapAiTitleGeneratorService {
  private readonly logger = new Logger(RoadmapAiTitleGeneratorService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly config: ConfigService,
  ) {}

  async enqueue(sessionId: string): Promise<void> {
    if (!this.isEnabled()) return;
    // setImmediate keeps the title gen off the message-persistence response
    // path. We still return a promise from the call site so callers can log
    // kickoff failures, but the actual LLM call happens async.
    setImmediate(() => {
      this.generateAndStore(sessionId).catch((err: unknown) => {
        this.logger.warn(
          `Title generation failed for session ${sessionId}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });
    });
  }

  private isEnabled(): boolean {
    const flag = this.config.get<string>('ROADMAP_AI_AUTO_TITLE_ENABLED');
    if (flag === undefined || flag === '') return true; // default-on
    return flag === 'true' || flag === '1';
  }

  private async generateAndStore(sessionId: string): Promise<void> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.debug(
        `OPENAI_API_KEY not set — skipping title gen for ${sessionId}`,
      );
      return;
    }

    const { data: messages, error: messagesError } = await this.db
      .from('roadmap_ai_messages')
      .select('role, content, seq')
      .eq('session_id', sessionId)
      .order('seq', { ascending: true })
      .limit(2);

    if (messagesError) throw new Error(messagesError.message);
    if (!messages || messages.length < 2) return;

    const firstUser = messages.find((m) => m.role === 'user');
    const firstAssistant = messages.find((m) => m.role === 'assistant');
    if (!firstUser || !firstAssistant) return;

    const title = await this.callOpenAi(
      apiKey,
      String(firstUser.content ?? ''),
      String(firstAssistant.content ?? ''),
    );
    if (!title) return;

    // Only set the title if it's still null — the user may have renamed in
    // the meantime, in which case we respect their choice.
    const { error: updateError } = await this.db
      .from('roadmap_ai_sessions')
      .update({ title })
      .eq('id', sessionId)
      .is('title', null);

    if (updateError) throw new Error(updateError.message);
  }

  private async callOpenAi(
    apiKey: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: TITLE_MODEL,
          temperature: 0.2,
          max_tokens: 30,
          messages: [
            {
              role: 'system',
              content:
                'You generate concise conversation titles for a roadmap AI assistant. Return a single short title (max 6 words, no quotes, no trailing punctuation) in the language of the user message.',
            },
            {
              role: 'user',
              content: `User: ${truncate(userMessage, 800)}\n\nAssistant: ${truncate(
                assistantMessage,
                800,
              )}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`OpenAI title request failed: ${response.status}`);
        return null;
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const raw = payload.choices?.[0]?.message?.content;
      return sanitizeTitle(typeof raw === 'string' ? raw : null);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function sanitizeTitle(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_TITLE_CHARS
    ? cleaned.slice(0, MAX_TITLE_CHARS).trim()
    : cleaned;
}
