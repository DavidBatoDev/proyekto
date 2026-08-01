import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const loading = document.querySelector<HTMLElement>('#loading')!;
const error = document.querySelector<HTMLElement>('#error')!;
const visual = document.querySelector<HTMLElement>('#visual')!;

type StatusTone = 'backlog' | 'in-progress' | 'completed' | 'blocked';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallbackValue = ''): string {
  return typeof value === 'string' ? value : fallbackValue;
}

function count(value: unknown, fallbackValue = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallbackValue;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function statusTone(value: unknown): StatusTone {
  const normalized = text(value)
    .trim()
    .toLowerCase()
    .replaceAll(/[-\s]+/g, '_');

  if (['completed', 'complete', 'done'].includes(normalized)) {
    return 'completed';
  }
  if (['in_progress', 'active', 'started'].includes(normalized)) {
    return 'in-progress';
  }
  if (['blocked', 'cancelled', 'canceled'].includes(normalized)) {
    return 'blocked';
  }
  return 'backlog';
}

function statusLabel(value: unknown): string {
  const raw = text(value, 'backlog').trim().replaceAll(/[-_]+/g, ' ');
  return raw || 'backlog';
}

function statusPill(value: unknown): HTMLSpanElement {
  return element(
    'span',
    `status-pill status-${statusTone(value)}`,
    statusLabel(value),
  );
}

function metric(value: number, label: string): HTMLDivElement {
  const node = element('div', 'metric');
  node.append(
    element('span', 'metric-value', String(value)),
    element('span', 'metric-label', label),
  );
  return node;
}

function formatDate(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw,
  );
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function createFeatureCard(
  feature: Record<string, unknown>,
  index: number,
): HTMLDivElement {
  const tone = statusTone(feature.status);
  const card = element('div', `feature-card status-${tone}`);
  card.setAttribute(
    'aria-label',
    `${text(feature.title, 'Untitled feature')}, ${statusLabel(feature.status)}`,
  );
  card.append(
    element('span', 'feature-index', `Feature ${index + 1}`),
    element('p', 'feature-title', text(feature.title, 'Untitled feature')),
    statusPill(feature.status),
  );
  return card;
}

function createEpicLane(
  epic: Record<string, unknown>,
  epicIndex: number,
): HTMLDivElement {
  const lane = element('div', 'epic-lane');
  const epicCard = element('article', 'epic-card');
  const features = records(epic.features);

  epicCard.append(
    element('span', 'node-kind', `Epic ${epicIndex + 1}`),
    element('h3', 'epic-title', text(epic.title, 'Untitled epic')),
    statusPill(epic.status),
  );

  const connector = element('div', 'connector');
  connector.setAttribute('aria-hidden', 'true');
  const track = element('div', 'feature-track');

  if (features.length === 0) {
    track.append(
      element(
        'div',
        'empty-track',
        'No features have been planned for this epic yet.',
      ),
    );
  } else {
    features.forEach((feature, index) => {
      track.append(createFeatureCard(feature, index));
    });
  }

  lane.append(epicCard, connector, track);
  return lane;
}

function createMilestones(value: unknown): HTMLElement | undefined {
  const milestones = records(value);
  if (milestones.length === 0) return undefined;

  const strip = element('section', 'milestones');
  strip.setAttribute('aria-label', 'Roadmap milestones');
  strip.append(element('span', 'milestones-label', 'Milestones'));

  for (const milestone of milestones) {
    const item = element('div', 'milestone');
    item.append(
      document.createTextNode(text(milestone.title, 'Untitled milestone')),
    );
    const date = formatDate(milestone.target_date);
    if (date) item.append(element('span', 'milestone-date', date));
    strip.append(item);
  }

  return strip;
}

function renderRoadmapBoard(result: CallToolResult): boolean {
  if (!isRecord(result.structuredContent)) return false;
  const summary = result.structuredContent;
  const epics = records(summary.epics);
  const features = epics.flatMap((epic) => records(epic.features));
  const board = element('section', 'roadmap-board');
  board.dataset.roadmapBoard = 'true';
  board.setAttribute(
    'aria-label',
    `${text(summary.title, 'Proyekto Roadmap')} visual roadmap`,
  );

  const header = element('header', 'board-header');
  const identity = element('div');
  const titleRow = element('div', 'board-title-row');
  titleRow.append(
    element('h2', 'board-title', text(summary.title, 'Proyekto Roadmap')),
    statusPill(summary.status),
  );
  identity.append(titleRow);
  const description = text(summary.description);
  if (description) {
    identity.append(element('p', 'board-description', description));
  }

  const metrics = element('div', 'metrics');
  metrics.append(
    metric(count(summary.epic_count, epics.length), 'Epics'),
    metric(count(summary.feature_count, features.length), 'Features'),
    metric(count(summary.task_count), 'Tasks'),
  );
  header.append(identity, metrics);
  board.append(header);

  const milestones = createMilestones(summary.milestones);
  if (milestones) board.append(milestones);

  const lanes = element('div', 'lanes');
  if (epics.length === 0) {
    lanes.append(
      element(
        'div',
        'no-epics',
        'No epics have been planned for this roadmap yet.',
      ),
    );
  } else {
    epics.forEach((epic, index) => lanes.append(createEpicLane(epic, index)));
  }
  board.append(lanes);

  visual.replaceChildren(board);
  visual.hidden = false;
  return true;
}

function showError(message: string): void {
  loading.hidden = true;
  visual.hidden = true;
  error.textContent = message;
  error.hidden = false;
}

function visualAlt(result: CallToolResult): string {
  if (!isRecord(result.structuredContent)) return 'Proyekto roadmap';
  const metadata = result.structuredContent.visual;
  return isRecord(metadata)
    ? text(metadata.alt, 'Proyekto roadmap')
    : 'Proyekto roadmap';
}

function renderSvg(result: CallToolResult): boolean {
  const block = result.content?.find(
    (item) =>
      item.type === 'resource' &&
      item.resource.mimeType === 'image/svg+xml' &&
      'text' in item.resource,
  );
  if (!block || block.type !== 'resource' || !('text' in block.resource)) {
    return false;
  }

  const parsed = new DOMParser().parseFromString(
    block.resource.text,
    'image/svg+xml',
  );
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) {
    return false;
  }

  const imported = document.importNode(svg, true);
  imported.setAttribute('role', 'img');
  imported.setAttribute('aria-label', visualAlt(result));
  visual.replaceChildren(imported);
  visual.hidden = false;
  return true;
}

function renderPng(result: CallToolResult): boolean {
  const block = result.content?.find(
    (item) => item.type === 'image' && item.mimeType === 'image/png',
  );
  if (!block || block.type !== 'image') return false;

  const image = document.createElement('img');
  image.src = `data:${block.mimeType};base64,${block.data}`;
  image.alt = visualAlt(result);
  visual.replaceChildren(image);
  visual.hidden = false;
  return true;
}

function renderResult(result: CallToolResult): void {
  if (result.isError) {
    showError('The roadmap could not be loaded.');
    return;
  }

  error.hidden = true;
  visual.hidden = true;

  if (!renderRoadmapBoard(result) && !renderSvg(result) && !renderPng(result)) {
    showError('The roadmap data arrived, but no displayable visual was found.');
    return;
  }

  loading.hidden = true;
}

const app = new App({ name: 'Proyekto Roadmap', version: '1.1.0' });
app.ontoolresult = renderResult;

void app.connect().catch(() => {
  showError('The roadmap view could not connect to this chat.');
});
