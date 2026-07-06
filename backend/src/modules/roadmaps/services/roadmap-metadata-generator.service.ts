import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SuggestRoadmapIntakeStepDto,
  SuggestRoadmapMetadataDto,
} from '../dto/roadmaps.dto';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const METADATA_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 600;
const MAX_CATEGORY_CHARS = 80;
const OPTION_KEYS = ['A', 'B', 'C'] as const;

type IntakeOptionKey = (typeof OPTION_KEYS)[number];
type IntakeStep = 'objective' | 'title' | 'description';
type ObjectiveDecision = 'ready' | 'clarify' | 'cancel';

export interface SuggestedRoadmapMetadata {
  name: string;
  description: string;
  category: string;
}

export interface SuggestedRoadmapIntakeOption {
  key: IntakeOptionKey;
  value: string;
}

export interface SuggestedRoadmapIntakeStep {
  assistant_message: string;
  options: SuggestedRoadmapIntakeOption[];
  category_suggestions?: string[];
  objective_decision?: ObjectiveDecision;
  refined_prompt?: string;
  audience?: string;
  scope?: string;
}

interface ChatCompletionChoice {
  message?: { content?: string | null };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

@Injectable()
export class RoadmapMetadataGeneratorService {
  private readonly logger = new Logger(RoadmapMetadataGeneratorService.name);

  constructor(private readonly config: ConfigService) {}

  async suggest(
    dto: SuggestRoadmapMetadataDto,
  ): Promise<SuggestedRoadmapMetadata> {
    const prompt = normalizeWhitespace(dto.prompt);
    const fallback = buildFallbackMetadata(prompt);
    if (!prompt) return fallback;

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) return fallback;

    try {
      const generated = await this.callOpenAi(apiKey, prompt);
      return sanitizeMetadata(generated, fallback);
    } catch (error) {
      this.logger.warn(
        `Roadmap metadata suggestion failed: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
      );
      return fallback;
    }
  }

  async suggestIntakeStep(
    dto: SuggestRoadmapIntakeStepDto,
  ): Promise<SuggestedRoadmapIntakeStep> {
    const prompt = normalizeWhitespace(dto.prompt);
    const fallback = buildFallbackIntakeStep(dto.step, {
      prompt,
      title: dto.title,
      description: dto.description,
      category: dto.category,
      clarificationAttempted: dto.clarification_attempted,
    });
    if (!prompt) return fallback;

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) return fallback;

    try {
      const generated = await this.callOpenAiIntake(apiKey, dto.step, {
        prompt,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        clarificationAttempted: dto.clarification_attempted,
      });
      return sanitizeIntakeStep(generated, fallback, dto.step);
    } catch (error) {
      this.logger.warn(
        `Roadmap intake suggestion failed: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
      );
      return fallback;
    }
  }

  private async callOpenAi(
    apiKey: string,
    prompt: string,
  ): Promise<Partial<SuggestedRoadmapMetadata> | null> {
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
          model: METADATA_MODEL,
          temperature: 0.2,
          max_tokens: 220,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You create concise editable roadmap metadata. Return only valid JSON with string fields: name, description, category. Name must be under 80 characters. Description must be one short paragraph under 600 characters. Category must be a plain product category under 80 characters.',
            },
            {
              role: 'user',
              content: `Project idea: ${truncate(prompt, 2000)}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`OpenAI metadata request failed: ${response.status}`);
        return null;
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const raw = payload.choices?.[0]?.message?.content;
      if (typeof raw !== 'string') return null;
      const parsed = JSON.parse(raw) as Partial<SuggestedRoadmapMetadata>;
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callOpenAiIntake(
    apiKey: string,
    step: IntakeStep,
    context: {
      prompt: string;
      title?: string;
      description?: string;
      category?: string;
      clarificationAttempted?: boolean;
    },
  ): Promise<Partial<SuggestedRoadmapIntakeStep> | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const isTitleStep = step === 'title';
    const isObjectiveStep = step === 'objective';
    try {
      const response = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: METADATA_MODEL,
          temperature: isTitleStep ? 0.65 : isObjectiveStep ? 0.2 : 0.45,
          max_tokens: isTitleStep ? 260 : isObjectiveStep ? 320 : 420,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: isObjectiveStep
                ? 'You are an expert product intake strategist. Decide whether the user has provided enough information to set up a roadmap. A ready objective must include what is being built and either a clear audience/users or meaningful scope such as platform, core features, business goal, or delivery context. If the prompt already has a detailed objective or detailed scope, do not ask another question just because audience is implicit. Return only valid JSON with objective_decision ("ready", "clarify", or "cancel"), assistant_message, refined_prompt, audience, scope, and options: []. If the user is greeting, testing, joking, or not giving a project idea, use "clarify" unless clarification_attempted is true, then use "cancel". If details are too thin, ask one concise follow-up question for the missing objective, audience, or scope. If ready, write a polished refined_prompt that combines all available objective, audience, and scope context.'
                : isTitleStep
                  ? 'You are an expert product strategist naming a roadmap before generation. Return only valid JSON with assistant_message and options. options must be exactly 3 objects with keys A, B, C and polished roadmap/product title values under 80 characters. Titles must be distinct, specific, and useful. Do not repeat the user prompt verbatim. Avoid lazy suffixes like "Roadmap" or "Launch Plan" unless they create a genuinely strong title. assistant_message should feel conversational and ask what the user wants to call the roadmap.'
                  : 'You are an expert product strategist shaping a roadmap brief before generation. Return only valid JSON with assistant_message, options, and category_suggestions. options must be exactly 3 objects with keys A, B, C and concise roadmap goal/description values under 260 characters. Each option must be specific to the user idea and describe a different strategic angle. category_suggestions must be 3 to 5 short product categories. assistant_message should feel conversational and ask what goal or direction the roadmap should optimize for.',
            },
            {
              role: 'user',
              content: [
                `Project idea: ${truncate(context.prompt, 2000)}`,
                isObjectiveStep
                  ? `Clarification already attempted: ${context.clarificationAttempted ? 'yes' : 'no'}`
                  : '',
                context.title
                  ? `Selected roadmap title: ${truncate(context.title, 200)}`
                  : '',
                context.description
                  ? `Existing description: ${truncate(context.description, 600)}`
                  : '',
                context.category
                  ? `Existing category: ${truncate(context.category, 80)}`
                  : '',
                isObjectiveStep
                  ? 'Classify if this is ready to become a roadmap intake, needs one clarifying question, or should be canceled.'
                  : isTitleStep
                    ? 'Generate names that sound like a real product or initiative, not a paraphrase of the prompt.'
                    : 'Generate options that can be used directly as the roadmap description/goal.',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`OpenAI intake request failed: ${response.status}`);
        return null;
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const raw = payload.choices?.[0]?.message?.content;
      if (typeof raw !== 'string') return null;
      return JSON.parse(raw) as Partial<SuggestedRoadmapIntakeStep>;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildFallbackMetadata(prompt: string): SuggestedRoadmapMetadata {
  const safePrompt = normalizeWhitespace(prompt);
  const name = sanitizeText(safePrompt, MAX_NAME_CHARS) || 'New Roadmap';
  return {
    name,
    description: safePrompt
      ? `Roadmap for ${sanitizeText(safePrompt, 180)}.`
      : 'A structured roadmap for turning an idea into an actionable plan.',
    category: inferCategory(safePrompt),
  };
}

function buildFallbackIntakeStep(
  step: IntakeStep,
  context: {
    prompt: string;
    title?: string;
    description?: string;
    category?: string;
    clarificationAttempted?: boolean;
  },
): SuggestedRoadmapIntakeStep {
  const safePrompt = normalizeWhitespace(context.prompt);
  if (step === 'objective') {
    const assessment = assessObjectivePrompt(safePrompt);
    if (!assessment.ready) {
      const attempted = Boolean(context.clarificationAttempted);
      return {
        assistant_message: attempted
          ? 'No worries, I will cancel this roadmap setup for now. Come back when you have a project idea to build.'
          : assessment.message,
        options: [],
        objective_decision: attempted ? 'cancel' : 'clarify',
        refined_prompt: '',
        audience: '',
        scope: '',
      };
    }

    return {
      assistant_message:
        'Great, I understand the project objective. I will use this context to set up the roadmap fields.',
      options: [],
      objective_decision: 'ready',
      refined_prompt: safePrompt,
      audience: assessment.audience,
      scope: assessment.scope,
    };
  }

  if (step === 'title') {
    const options = buildFallbackTitleOptions(safePrompt);
    return {
      assistant_message:
        'Before we start, what should we call this roadmap? I sketched a few directions, or you can name it yourself.',
      options,
    };
  }

  const title = sanitizeText(context.title, MAX_NAME_CHARS) || 'this roadmap';
  const category = inferCategory(`${safePrompt} ${title}`);
  return {
    assistant_message:
      'What is the goal of this roadmap? Pick one direction below or write your own.',
    options: [
      {
        key: 'A',
        value: safePrompt
          ? `Plan the core product, launch steps, and delivery milestones for ${title}.`
          : `Plan the core product, launch steps, and delivery milestones for ${title}.`,
      },
      {
        key: 'B',
        value: `Turn ${title} into an actionable roadmap with clear epics, features, and early priorities.`,
      },
      {
        key: 'C',
        value: `Define the build strategy, user experience, and execution phases needed to ship ${title}.`,
      },
    ],
    category_suggestions: uniqueNonEmpty([
      category,
      'Web Development',
      'SaaS',
      'AI / ML',
      'Mobile App',
    ]).slice(0, 5),
  };
}

function sanitizeMetadata(
  generated: Partial<SuggestedRoadmapMetadata> | null,
  fallback: SuggestedRoadmapMetadata,
): SuggestedRoadmapMetadata {
  return {
    name: sanitizeText(generated?.name, MAX_NAME_CHARS) || fallback.name,
    description:
      sanitizeText(generated?.description, MAX_DESCRIPTION_CHARS, {
        stripTerminalPunctuation: false,
      }) ||
      fallback.description,
    category:
      sanitizeText(generated?.category, MAX_CATEGORY_CHARS) || fallback.category,
  };
}

function sanitizeIntakeStep(
  generated: Partial<SuggestedRoadmapIntakeStep> | null,
  fallback: SuggestedRoadmapIntakeStep,
  step: IntakeStep,
): SuggestedRoadmapIntakeStep {
  if (step === 'objective') {
    return sanitizeObjectiveStep(generated, fallback);
  }

  const maxOptionLength = step === 'title' ? MAX_NAME_CHARS : 260;
  const fallbackValues = fallback.options.map((option) => option.value);
  const generatedOptions = Array.isArray(generated?.options)
    ? generated?.options
    : [];
  const options = OPTION_KEYS.map((key, index) => {
    const matching = generatedOptions?.find((option) => option?.key === key);
    const fallbackValue = fallback.options[index]?.value ?? '';
    const sanitizedValue = sanitizeText(matching?.value, maxOptionLength, {
      stripTerminalPunctuation: step === 'title',
    });
    return {
      key,
      value: isLowQualityOption(sanitizedValue, fallbackValues, step, index)
        ? fallbackValue
        : sanitizedValue || fallbackValue,
    };
  });

  const categories =
    step === 'description'
      ? uniqueNonEmpty([
          ...(Array.isArray(generated?.category_suggestions)
            ? generated?.category_suggestions ?? []
            : []),
          ...(fallback.category_suggestions ?? []),
        ])
          .map((category) => sanitizeText(category, MAX_CATEGORY_CHARS))
          .filter(Boolean)
          .slice(0, 5)
      : undefined;

  return {
    assistant_message:
      sanitizeText(generated?.assistant_message, 220, {
        stripTerminalPunctuation: false,
      }) || fallback.assistant_message,
    options,
    ...(categories ? { category_suggestions: categories } : {}),
  };
}

function sanitizeObjectiveStep(
  generated: Partial<SuggestedRoadmapIntakeStep> | null,
  fallback: SuggestedRoadmapIntakeStep,
): SuggestedRoadmapIntakeStep {
  const rawDecision = generated?.objective_decision;
  const fallbackDecision = fallback.objective_decision ?? 'clarify';
  const decision: ObjectiveDecision =
    rawDecision === 'ready' || rawDecision === 'clarify' || rawDecision === 'cancel'
      ? rawDecision
      : fallbackDecision;
  const refinedPrompt = sanitizeText(generated?.refined_prompt, 2000, {
    stripTerminalPunctuation: false,
  });
  const audience = sanitizeText(generated?.audience, 160, {
    stripTerminalPunctuation: false,
  });
  const scope = sanitizeText(generated?.scope, 240, {
    stripTerminalPunctuation: false,
  });

  if (decision === 'ready' && (!refinedPrompt || !scope)) {
    return fallback;
  }

  return {
    assistant_message:
      sanitizeText(generated?.assistant_message, 260, {
        stripTerminalPunctuation: false,
      }) || fallback.assistant_message,
    options: [],
    objective_decision: decision,
    refined_prompt:
      decision === 'ready'
        ? refinedPrompt || fallback.refined_prompt || ''
        : refinedPrompt,
    audience: decision === 'ready' ? audience || fallback.audience || 'target users' : audience,
    scope: decision === 'ready' ? scope || fallback.scope || '' : scope,
  };
}

function sanitizeText(
  value: unknown,
  maxLength: number,
  options: { stripTerminalPunctuation?: boolean } = {},
): string {
  if (typeof value !== 'string') return '';
  const cleaned = normalizeWhitespace(value).replace(/^[\s"'`]+/g, '').trim();
  if (!cleaned) return '';
  const stripped = options.stripTerminalPunctuation === false
    ? cleaned
    : cleaned.replace(/[\s"'`.!?]+$/g, '').trim();
  return stripped.length > maxLength
    ? stripped.slice(0, maxLength).trim()
    : stripped;
}

function uniqueNonEmpty(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = normalizeWhitespace(value);
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}

function buildFallbackTitleOptions(prompt: string): SuggestedRoadmapIntakeOption[] {
  const category = inferCategory(prompt);
  const cleanedIdea = toTitleCase(extractIdeaPhrase(prompt));
  const templates = fallbackTitleTemplates(category, cleanedIdea);
  return OPTION_KEYS.map((key, index) => ({
    key,
    value: sanitizeText(
      (templates[index] ?? cleanedIdea) || 'New Roadmap',
      MAX_NAME_CHARS,
    ),
  }));
}

function fallbackTitleTemplates(category: string, cleanedIdea: string): string[] {
  if (category === 'Health & Fitness') {
    return ['FitFlow Studio', 'PulseCoach Platform', 'Momentum Fitness Hub'];
  }
  if (category === 'AI / ML') {
    return ['SmartFlow Assistant', 'AI Launch Blueprint', 'Automation Command Center'];
  }
  if (category === 'Mobile App') {
    return ['Mobile Product Launch', 'App Experience Blueprint', 'Pocket Product Plan'];
  }
  if (category === 'E-commerce') {
    return ['Commerce Growth Engine', 'Storefront Launch System', 'Checkout Experience Plan'];
  }
  if (category === 'Marketing') {
    return ['Campaign Growth Plan', 'Brand Momentum System', 'Content Launch Blueprint'];
  }
  if (category === 'SaaS') {
    return ['SaaS Launch System', 'Customer Workflow Hub', 'Subscription Growth Plan'];
  }

  const base = cleanedIdea || 'Product';
  return [
    `${base} Blueprint`,
    `${base} Launch System`,
    `${base} Execution Plan`,
  ];
}

function assessObjectivePrompt(prompt: string): {
  ready: boolean;
  message: string;
  audience: string;
  scope: string;
} {
  const lower = prompt.toLowerCase();
  const weakPattern =
    /^(hi|hello|hey|test|testing|asdf|sample|demo|try|trying|roadmap|\?|\.|,|ok|okay)$/i;
  if (!prompt || prompt.length < 12 || weakPattern.test(prompt)) {
    return {
      ready: false,
      message:
        'I need a little more before I can create a useful roadmap. What are you building, who is it for, and what should the first version include?',
      audience: '',
      scope: '',
    };
  }

  const hasBuildObjective =
    /\b(build|create|make|develop|design|launch|ship|plan|set up|setup)\b/.test(
      lower,
    ) &&
    /\b(app|website|site|platform|dashboard|tool|system|service|marketplace|product|portal|roadmap|project)\b/.test(
      lower,
    );
  const hasAudience =
    /\b(for|serving|help(?:ing)?|used by|users?|customers?|clients?|teams?|admins?|students?|patients?|farmers?|creators?|businesses?|companies?|managers?)\b/.test(
      lower,
    );
  const hasScope =
    /\b(with|including|include|features?|mvp|v1|version|dashboard|auth|login|payments?|booking|scheduling|tracking|analytics|chat|notifications?|mobile|web|backend|frontend|api|database|workflow|kanban|collaboration)\b/.test(
      lower,
    ) || prompt.split(/[,.]/).length > 1;
  const scopeSignalCount = countScopeSignals(lower);
  const hasDetailedScope =
    scopeSignalCount >= 3 ||
    (hasScope && (prompt.length >= 90 || prompt.split(/[,;]|\band\b/i).length >= 3));

  if (hasBuildObjective && hasScope && (hasAudience || hasDetailedScope)) {
    return {
      ready: true,
      message: '',
      audience: extractAudiencePhrase(prompt),
      scope: extractScopePhrase(prompt),
    };
  }

  const missing: string[] = [];
  if (!hasBuildObjective) missing.push('what you want to build');
  if (!hasAudience && !hasDetailedScope) missing.push('who it is for');
  if (!hasScope) missing.push('what the first version should include');
  return {
    ready: false,
    message: `I can help set this up, but I need ${joinReadableList(
      missing,
    )}. Could you add those details in one sentence?`,
    audience: '',
    scope: '',
  };
}

function countScopeSignals(lower: string): number {
  const matches = lower.match(
    /\b(auth|login|signup|database|api|backend|frontend|dashboard|payments?|billing|booking|scheduling|tracking|analytics|notifications?|chat|messaging|admin|cms|deployment|ci|cd|testing|onboarding|search|upload|mobile|web|kanban|collaboration|reports?|integrations?)\b/g,
  );
  return new Set(matches ?? []).size;
}

function joinReadableList(values: string[]): string {
  if (values.length === 0) return 'a clearer project objective';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function extractAudiencePhrase(prompt: string): string {
  const match = normalizeWhitespace(prompt).match(
    /\b(?:for|serving|help(?:ing)?|used by)\s+([^,.]{2,120})/i,
  );
  return sanitizeText(match?.[1], 160, {
    stripTerminalPunctuation: false,
  }) || 'target users';
}

function extractScopePhrase(prompt: string): string {
  const match = normalizeWhitespace(prompt).match(
    /\b(?:with|including|include|that\s+(?:has|supports|lets|allows))\s+([^,.]{2,180})/i,
  );
  if (match?.[1]) {
    return sanitizeText(match[1], 240, {
      stripTerminalPunctuation: false,
    });
  }
  return sanitizeText(prompt, 240, {
    stripTerminalPunctuation: false,
  });
}

function extractIdeaPhrase(prompt: string): string {
  return normalizeWhitespace(prompt)
    .replace(/^(can you|could you|please)\s+/i, '')
    .replace(/^i\s+(want|need|would like)\s+to\s+/i, '')
    .replace(/^(build|create|make|develop|design)\s+/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/\b(roadmap|project plan)\b/gi, '')
    .trim();
}

function toTitleCase(value: string): string {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && word === word.toUpperCase()
        ? word
        : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join(' ');
}

function isLowQualityOption(
  value: string,
  fallbackValues: string[],
  step: 'title' | 'description',
  index: number,
): boolean {
  if (!value) return true;
  if (step !== 'title') return false;

  const normalized = value.toLowerCase();
  if (/\bi\s+(want|need|would like)\s+to\b/.test(normalized)) return true;
  if (/\b(can you|could you|please)\b/.test(normalized)) return true;
  if (index > 0 && /(\sroadmap|\slaunch plan)$/i.test(value)) {
    const root = value.replace(/(\sroadmap|\slaunch plan)$/i, '').trim();
    if (fallbackValues.some((fallback) => fallback.toLowerCase() === root.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function normalizeWhitespace(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value;
}

function inferCategory(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/\b(mobile|ios|android)\b/.test(lower)) return 'Mobile App';
  if (/\b(ai|ml|machine learning|automation|chatbot)\b/.test(lower)) {
    return 'AI / ML';
  }
  if (/\b(shop|store|commerce|marketplace|checkout)\b/.test(lower)) {
    return 'E-commerce';
  }
  if (/\b(marketing|campaign|brand|content)\b/.test(lower)) {
    return 'Marketing';
  }
  if (/\b(saas|subscription|dashboard|platform)\b/.test(lower)) {
    return 'SaaS';
  }
  if (/\b(fitness|workout|health|wellness|gym|training)\b/.test(lower)) {
    return 'Health & Fitness';
  }
  return 'Web Development';
}
