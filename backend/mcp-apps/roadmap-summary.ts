import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const loading = document.querySelector<HTMLElement>('#loading')!;
const error = document.querySelector<HTMLElement>('#error')!;
const visual = document.querySelector<HTMLElement>('#visual')!;

type StatusTone = 'backlog' | 'in-progress' | 'completed' | 'blocked';
type NodeKind = 'epic' | 'feature' | 'empty' | 'milestone';

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
  return text(value).trim().replaceAll(/[-_]+/g, ' ');
}

function statusBadge(value: unknown): HTMLSpanElement | undefined {
  const label = statusLabel(value);
  if (!label) return undefined;
  return element('span', `status-badge status-${statusTone(value)}`, label);
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

function createNode(
  kind: NodeKind,
  title: string,
  status?: unknown,
  label?: string,
): HTMLDivElement {
  const node = element('div', `tree-node ${kind}-node`);
  node.setAttribute('role', 'treeitem');

  const marker = element('span', 'node-marker');
  marker.setAttribute('aria-hidden', 'true');
  const content = element('div', 'node-content');
  if (label) content.append(element('span', 'node-label', label));

  const titleRow = element('div', 'node-title-row');
  titleRow.append(element('span', 'node-title', title));
  const badge = statusBadge(status);
  if (badge) titleRow.append(badge);

  content.append(titleRow);
  node.append(marker, content);
  return node;
}

function createEpicBranch(
  epic: Record<string, unknown>,
  epicIndex: number,
): HTMLElement {
  const branch = element('section', 'epic-branch');
  const epicNode = createNode(
    'epic',
    text(epic.title, 'Untitled epic'),
    epic.status,
    `Epic ${epicIndex + 1}`,
  );
  epicNode.setAttribute('aria-expanded', 'true');
  branch.append(epicNode);

  const children = element('div', 'tree-children');
  children.setAttribute('role', 'group');
  const features = records(epic.features);
  if (features.length === 0) {
    children.append(createNode('empty', 'No features planned yet'));
  } else {
    features.forEach((feature, featureIndex) => {
      children.append(
        createNode(
          'feature',
          text(feature.title, 'Untitled feature'),
          feature.status,
          `Feature ${featureIndex + 1}`,
        ),
      );
    });
  }
  branch.append(children);
  return branch;
}

function appendStat(
  parent: HTMLElement,
  value: number,
  singular: string,
): void {
  const stat = element('span', 'stat');
  stat.append(
    element('strong', undefined, String(value)),
    document.createTextNode(` ${value === 1 ? singular : `${singular}s`}`),
  );
  parent.append(stat);
}

function renderHierarchyRoadmap(result: CallToolResult): boolean {
  const summary = summaryFromResult(result);
  if (!summary) return false;

  const epics = records(summary.epics);
  const features = epics.flatMap((epic) => records(epic.features));
  const milestones = records(summary.milestones);
  const panel = element('section', 'roadmap-hierarchy');
  panel.dataset.roadmapHierarchy = 'true';
  panel.setAttribute(
    'aria-label',
    `${text(summary.title, 'Proyekto Roadmap')} hierarchy`,
  );

  const summaryRow = element('div', 'summary-row');
  summaryRow.append(
    element('h2', 'roadmap-title', text(summary.title, 'Proyekto Roadmap')),
  );
  const roadmapStatus = statusBadge(summary.status);
  if (roadmapStatus) summaryRow.append(roadmapStatus);
  panel.append(summaryRow);

  const stats = element('div', 'stats');
  appendStat(stats, count(summary.epic_count, epics.length), 'epic');
  appendStat(stats, count(summary.feature_count, features.length), 'feature');
  appendStat(stats, count(summary.task_count), 'task');
  panel.append(stats);

  const description = text(summary.description);
  if (description) panel.append(element('p', 'description', description));

  const tree = element('div', 'hierarchy-tree');
  tree.setAttribute('role', 'tree');
  if (epics.length === 0) {
    tree.append(createNode('empty', 'No epics planned yet'));
  } else {
    epics.forEach((epic, epicIndex) => {
      tree.append(createEpicBranch(epic, epicIndex));
    });
  }
  panel.append(tree);

  if (milestones.length > 0) {
    const milestoneSection = element('section', 'milestone-section');
    milestoneSection.append(element('h3', 'section-title', 'Milestones'));
    const milestoneTree = element('div', 'milestone-tree');
    milestoneTree.setAttribute('role', 'tree');
    milestones.forEach((milestone, index) => {
      const date = formatDate(milestone.target_date);
      milestoneTree.append(
        createNode(
          'milestone',
          text(milestone.title, 'Untitled milestone'),
          milestone.status,
          date || `Milestone ${index + 1}`,
        ),
      );
    });
    milestoneSection.append(milestoneTree);
    panel.append(milestoneSection);
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
  if (!renderHierarchyRoadmap(result)) {
    showError('The roadmap data arrived in an unsupported format.');
    return;
  }
  loading.hidden = true;
}

const app = new App({ name: 'Proyekto Roadmap', version: '1.3.0' });
app.ontoolresult = renderResult;

void app.connect().catch(() => {
  showError('The roadmap view could not connect to this chat.');
});
