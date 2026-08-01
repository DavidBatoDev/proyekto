import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const loading = document.querySelector<HTMLElement>('#loading')!;
const error = document.querySelector<HTMLElement>('#error')!;
const visual = document.querySelector<HTMLElement>('#visual')!;
const fallback = document.querySelector<HTMLElement>('#fallback')!;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallbackValue = ''): string {
  return typeof value === 'string' ? value : fallbackValue;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function showError(message: string): void {
  loading.hidden = true;
  visual.hidden = true;
  fallback.hidden = true;
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

function appendStatus(parent: HTMLElement, value: unknown): void {
  const status = text(value);
  if (!status) return;
  const label = document.createElement('span');
  label.className = 'status';
  label.textContent = `— ${status.replaceAll('_', ' ')}`;
  parent.append(label);
}

function appendFeatures(parent: HTMLLIElement, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return;
  const list = document.createElement('ul');

  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const item = document.createElement('li');
    item.append(
      document.createTextNode(text(candidate.title, 'Untitled feature')),
    );
    appendStatus(item, candidate.status);
    list.append(item);
  }

  if (list.childElementCount > 0) parent.append(list);
}

function renderTree(result: CallToolResult): boolean {
  if (!isRecord(result.structuredContent)) return false;
  const summary = result.structuredContent;

  const title = document.createElement('h2');
  title.className = 'fallback-title';
  title.textContent = text(summary.title, 'Proyekto Roadmap');

  const counts = document.createElement('p');
  counts.className = 'counts';
  counts.textContent = `${number(summary.epic_count)} epics · ${number(summary.feature_count)} features · ${number(summary.task_count)} tasks`;

  const tree = document.createElement('ul');
  tree.className = 'tree';
  const epics = Array.isArray(summary.epics) ? summary.epics : [];

  for (const candidate of epics) {
    if (!isRecord(candidate)) continue;
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = text(candidate.title, 'Untitled epic');
    item.append(strong);
    appendStatus(item, candidate.status);
    appendFeatures(item, candidate.features);
    tree.append(item);
  }

  fallback.replaceChildren(title, counts, tree);
  fallback.hidden = false;
  return true;
}

function renderResult(result: CallToolResult): void {
  if (result.isError) {
    showError('The roadmap could not be loaded.');
    return;
  }

  error.hidden = true;
  fallback.hidden = true;
  visual.hidden = true;

  if (!renderSvg(result) && !renderPng(result) && !renderTree(result)) {
    showError('The roadmap data arrived, but no displayable visual was found.');
    return;
  }

  loading.hidden = true;
}

const app = new App({ name: 'Proyekto Roadmap', version: '1.0.0' });
app.ontoolresult = renderResult;

void app.connect().catch(() => {
  showError('The roadmap view could not connect to this chat.');
});
