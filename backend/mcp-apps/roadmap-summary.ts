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
  return text(value).trim().replaceAll(/[-_]+/g, ' ').toUpperCase();
}

function appendStatus(parent: HTMLElement, value: unknown): void {
  const label = statusLabel(value);
  if (!label) return;
  parent.append(
    element('span', `status status-${statusTone(value)}`, `[${label}]`),
  );
}

function appendLine(
  parent: HTMLElement,
  prefix: string,
  title: string,
  status: unknown,
  kind: 'epic' | 'feature' | 'empty' | 'milestone',
): void {
  const line = element('div', 'ascii-line');
  line.setAttribute('role', 'treeitem');
  const body = element('span', 'line-body');
  body.append(element('span', `${kind}-name`, title));
  appendStatus(body, status);
  line.append(element('span', 'ascii-prefix', prefix), body);
  parent.append(line);
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

function summaryFromResult(
  result: CallToolResult,
): Record<string, unknown> | undefined {
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const block = result.content?.find((item) => item.type === 'text');
  if (!block || block.type !== 'text') return undefined;
  try {
    const parsed: unknown = JSON.parse(block.text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function renderAsciiRoadmap(result: CallToolResult): boolean {
  const summary = summaryFromResult(result);
  if (!summary) return false;

  const epics = records(summary.epics);
  const features = epics.flatMap((epic) => records(epic.features));
  const milestones = records(summary.milestones);
  const panel = element('section', 'ascii-roadmap');
  panel.dataset.asciiRoadmap = 'true';
  panel.setAttribute(
    'aria-label',
    `${text(summary.title, 'Proyekto Roadmap')} ASCII roadmap`,
  );

  const summaryRow = element('div', 'summary-row');
  summaryRow.append(
    element('h2', 'roadmap-title', text(summary.title, 'Proyekto Roadmap')),
  );
  appendStatus(summaryRow, summary.status);
  panel.append(
    summaryRow,
    element(
      'p',
      'counts',
      `EPICS: ${count(summary.epic_count, epics.length)}  |  FEATURES: ${count(summary.feature_count, features.length)}  |  TASKS: ${count(summary.task_count)}`,
    ),
  );

  const description = text(summary.description);
  if (description) panel.append(element('p', 'description', description));
  panel.append(element('div', 'divider'));

  const tree = element('div', 'tree');
  tree.setAttribute('role', 'tree');
  if (epics.length === 0) {
    appendLine(tree, '\\-- ', '(no epics planned)', undefined, 'empty');
  } else {
    epics.forEach((epic, epicIndex) => {
      const epicIsLast = epicIndex === epics.length - 1;
      appendLine(
        tree,
        epicIsLast ? '\\-- ' : '+-- ',
        text(epic.title, 'Untitled epic'),
        epic.status,
        'epic',
      );

      const epicFeatures = records(epic.features);
      const stem = epicIsLast ? '    ' : '|   ';
      if (epicFeatures.length === 0) {
        appendLine(
          tree,
          `${stem}\\-- `,
          '(no features planned)',
          undefined,
          'empty',
        );
        return;
      }

      epicFeatures.forEach((feature, featureIndex) => {
        appendLine(
          tree,
          `${stem}${featureIndex === epicFeatures.length - 1 ? '\\-- ' : '+-- '}`,
          text(feature.title, 'Untitled feature'),
          feature.status,
          'feature',
        );
      });
    });
  }
  panel.append(tree);

  if (milestones.length > 0) {
    panel.append(element('h3', 'milestone-heading', 'MILESTONES'));
    const milestoneTree = element('div', 'tree');
    milestoneTree.setAttribute('role', 'tree');
    milestones.forEach((milestone, index) => {
      const date = formatDate(milestone.target_date);
      appendLine(
        milestoneTree,
        index === milestones.length - 1 ? '\\-- ' : '+-- ',
        `${text(milestone.title, 'Untitled milestone')}${date ? ` @ ${date}` : ''}`,
        milestone.status,
        'milestone',
      );
    });
    panel.append(milestoneTree);
  }

  visual.replaceChildren(panel);
  visual.hidden = false;
  return true;
}

function showError(message: string): void {
  loading.hidden = true;
  visual.hidden = true;
  error.textContent = message;
  error.hidden = false;
}

function renderResult(result: CallToolResult): void {
  if (result.isError) {
    showError('The roadmap could not be loaded.');
    return;
  }
  error.hidden = true;
  visual.hidden = true;
  if (!renderAsciiRoadmap(result)) {
    showError('The roadmap data arrived in an unsupported format.');
    return;
  }
  loading.hidden = true;
}

const app = new App({ name: 'Proyekto Roadmap', version: '1.2.0' });
app.ontoolresult = renderResult;

void app.connect().catch(() => {
  showError('The roadmap view could not connect to this chat.');
});
