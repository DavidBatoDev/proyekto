import { Resvg } from '@resvg/resvg-js';

export type RoadmapVisualKind =
  | 'list'
  | 'summary'
  | 'node'
  | 'search'
  | 'changes';

export interface RoadmapVisual {
  svg: string;
  pngBase64: string;
  uri: string;
  alt: string;
}

interface RenderedSvg {
  svg: string;
  alt: string;
}

const WIDTH = 1600;
const SIDE = 56;
const CONTENT_WIDTH = WIDTH - SIDE * 2;
const COLORS = {
  canvas: '#f7f8fc',
  surface: '#ffffff',
  border: '#dfe3ec',
  ink: '#172033',
  muted: '#667085',
  purple: '#6857d9',
  purpleSoft: '#eeeafd',
  blue: '#2563eb',
  green: '#178454',
  greenSoft: '#e8f7ef',
  amber: '#a15c00',
  amberSoft: '#fff3d6',
  red: '#b42318',
  redSoft: '#feeceb',
} as const;

export function createRoadmapVisual(
  kind: RoadmapVisualKind,
  data: unknown,
  uri: string,
): RoadmapVisual {
  const rendered = renderRoadmapSvg(kind, data);
  return {
    ...rendered,
    uri,
    pngBase64: rasterizeRoadmapSvg(rendered.svg),
  };
}

export function renderRoadmapSvg(
  kind: RoadmapVisualKind,
  data: unknown,
): RenderedSvg {
  switch (kind) {
    case 'summary':
      return renderSummary(data);
    case 'list':
      return renderList(data);
    case 'node':
      return renderNode(data);
    case 'search':
      return renderSearch(data);
    case 'changes':
      return renderChanges(data);
  }
}

export function rasterizeRoadmapSvg(svg: string): string {
  const png = new Resvg(svg, {
    background: COLORS.canvas,
    fitTo: { mode: 'width', value: WIDTH },
  })
    .render()
    .asPng();
  return Buffer.from(png).toString('base64');
}

function renderSummary(data: unknown): RenderedSvg {
  const summary = asRecord(data);
  const epics = asRecords(summary.epics);
  const milestones = asRecords(summary.milestones);
  const shownEpics = epics.slice(0, 12);
  const shownMilestones = milestones.slice(0, 12);

  const epicHeights = shownEpics.map((epic) => {
    const count = Math.min(asRecords(epic.features).length, 6);
    return 82 + Math.max(count, 1) * 52 + 24;
  });
  const milestoneHeight =
    shownMilestones.length > 0
      ? 92 + Math.ceil(shownMilestones.length / 2) * 58
      : 0;
  const height =
    190 +
    epicHeights.reduce((total, value) => total + value + 18, 0) +
    milestoneHeight +
    64;
  const title = readText(summary.title, 'Untitled roadmap');
  const description = readText(summary.description, '');
  const parts = [
    svgOpen(height, `${title} roadmap`),
    header(
      title,
      description || 'Roadmap overview',
      readText(summary.status, 'Roadmap'),
    ),
    metrics(
      [
        ['Epics', readCount(summary.epic_count, epics.length)],
        ['Features', readCount(summary.feature_count)],
        ['Tasks', readCount(summary.task_count)],
      ],
      124,
    ),
  ];

  let y = 190;
  for (let index = 0; index < shownEpics.length; index += 1) {
    const epic = shownEpics[index];
    const features = asRecords(epic.features);
    const shownFeatures = features.slice(0, 6);
    const boxHeight = epicHeights[index];
    parts.push(
      card(
        SIDE,
        y,
        CONTENT_WIDTH,
        boxHeight,
        COLORS.surface,
        COLORS.border,
        18,
      ),
      text(SIDE + 28, y + 38, `${index + 1}`, 16, COLORS.purple, 700),
      text(
        SIDE + 68,
        y + 39,
        truncate(readText(epic.title, 'Untitled epic'), 78),
        25,
        COLORS.ink,
        700,
      ),
      badge(
        SIDE + CONTENT_WIDTH - 200,
        y + 18,
        readText(epic.status, `${features.length} features`),
      ),
    );

    let featureY = y + 74;
    if (shownFeatures.length === 0) {
      parts.push(
        text(SIDE + 68, featureY + 25, 'No features yet', 17, COLORS.muted),
      );
    }
    for (const feature of shownFeatures) {
      parts.push(
        line(SIDE + 42, featureY - 8, SIDE + 42, featureY + 35, COLORS.border),
        circle(SIDE + 42, featureY + 14, 7, statusColor(feature.status)),
        text(
          SIDE + 68,
          featureY + 20,
          truncate(readText(feature.title, 'Untitled feature'), 92),
          18,
          COLORS.ink,
          600,
        ),
        text(
          SIDE + CONTENT_WIDTH - 210,
          featureY + 20,
          humanize(readText(feature.status, 'Not started')),
          15,
          COLORS.muted,
          500,
        ),
      );
      featureY += 52;
    }
    if (features.length > shownFeatures.length) {
      parts.push(
        text(
          SIDE + 68,
          featureY + 18,
          `and ${features.length - shownFeatures.length} more features`,
          16,
          COLORS.purple,
          600,
        ),
      );
    }
    y += boxHeight + 18;
  }
  if (epics.length > shownEpics.length) {
    parts.push(
      text(
        SIDE + 28,
        y + 28,
        `and ${epics.length - shownEpics.length} more epics`,
        18,
        COLORS.purple,
        700,
      ),
    );
    y += 54;
  }

  if (shownMilestones.length > 0) {
    parts.push(text(SIDE, y + 32, 'Milestones', 24, COLORS.ink, 700));
    y += 54;
    shownMilestones.forEach((milestone, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = SIDE + column * (CONTENT_WIDTH / 2 + 8);
      const width = CONTENT_WIDTH / 2 - 8;
      const itemY = y + row * 58;
      parts.push(
        card(x, itemY, width, 46, COLORS.purpleSoft, 'none', 12),
        circle(x + 22, itemY + 23, 6, statusColor(milestone.status)),
        text(
          x + 40,
          itemY + 29,
          truncate(readText(milestone.title, 'Untitled milestone'), 46),
          16,
          COLORS.ink,
          600,
        ),
        text(
          x + width - 22,
          itemY + 29,
          formatDate(milestone.target_date),
          14,
          COLORS.muted,
          500,
          'end',
        ),
      );
    });
    y += Math.ceil(shownMilestones.length / 2) * 58;
    if (milestones.length > shownMilestones.length) {
      parts.push(
        text(
          SIDE,
          y + 20,
          `and ${milestones.length - shownMilestones.length} more milestones`,
          16,
          COLORS.purple,
          600,
        ),
      );
    }
  }

  parts.push(svgClose());
  return { svg: parts.join(''), alt: `${title} roadmap overview` };
}

function renderList(data: unknown): RenderedSvg {
  const root = asRecord(data);
  const roadmaps = asRecords(root.roadmaps);
  const shown = roadmaps.slice(0, 20);
  const rows = Math.max(1, Math.ceil(shown.length / 2));
  const height = 156 + rows * 132 + 72;
  const parts = [
    svgOpen(height, 'Proyekto roadmaps'),
    header(
      'Roadmaps',
      `${roadmaps.length} accessible roadmap${roadmaps.length === 1 ? '' : 's'}`,
      'Portfolio',
    ),
  ];
  shown.forEach((roadmap, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = SIDE + column * (CONTENT_WIDTH / 2 + 10);
    const y = 142 + row * 132;
    const width = CONTENT_WIDTH / 2 - 10;
    parts.push(
      card(x, y, width, 112, COLORS.surface, COLORS.border, 16),
      card(x + 20, y + 22, 8, 68, COLORS.purple, 'none', 4),
      text(
        x + 48,
        y + 48,
        truncate(
          readText(roadmap.name ?? roadmap.title, 'Untitled roadmap'),
          42,
        ),
        21,
        COLORS.ink,
        700,
      ),
      text(
        x + 48,
        y + 78,
        humanize(readText(roadmap.status, 'Roadmap')),
        15,
        COLORS.muted,
        500,
      ),
    );
  });
  if (shown.length === 0) {
    parts.push(emptyState(156, 'No roadmaps found'));
  } else if (roadmaps.length > shown.length) {
    parts.push(
      text(
        SIDE,
        height - 36,
        `and ${roadmaps.length - shown.length} more roadmaps`,
        17,
        COLORS.purple,
        600,
      ),
    );
  }
  parts.push(svgClose());
  return { svg: parts.join(''), alt: 'Accessible Proyekto roadmaps' };
}

function renderNode(data: unknown): RenderedSvg {
  const root = asRecord(data);
  const node = asRecord(root.node);
  const childrenRoot = asRecord(root.children);
  const children = asRecords(
    childrenRoot.children ?? childrenRoot.nodes ?? root.children,
  ).slice(0, 20);
  const height = 322 + Math.max(children.length, 1) * 62 + 64;
  const title = readText(node.title, 'Roadmap node');
  const parts = [
    svgOpen(height, `${title} node`),
    header(
      title,
      truncate(readText(node.description, 'Roadmap node details'), 120),
      humanize(readText(node.type, 'Node')),
    ),
    card(SIDE, 146, CONTENT_WIDTH, 126, COLORS.surface, COLORS.border, 18),
    text(
      SIDE + 28,
      184,
      humanize(readText(node.type, 'Node')),
      16,
      COLORS.purple,
      700,
    ),
    text(SIDE + 28, 222, truncate(title, 92), 25, COLORS.ink, 700),
    badge(
      SIDE + CONTENT_WIDTH - 200,
      178,
      readText(node.status ?? node.priority, 'Details'),
    ),
    text(SIDE, 316, 'Immediate children', 23, COLORS.ink, 700),
  ];
  if (children.length === 0) {
    parts.push(emptyState(338, 'No children included'));
  } else {
    children.forEach((child, index) => {
      const y = 338 + index * 62;
      parts.push(
        card(SIDE, y, CONTENT_WIDTH, 48, COLORS.surface, COLORS.border, 12),
        circle(SIDE + 24, y + 24, 6, statusColor(child.status)),
        text(
          SIDE + 46,
          y + 30,
          truncate(readText(child.title, 'Untitled node'), 100),
          17,
          COLORS.ink,
          600,
        ),
        text(
          SIDE + CONTENT_WIDTH - 24,
          y + 30,
          humanize(readText(child.type ?? child.status, 'Node')),
          14,
          COLORS.muted,
          500,
          'end',
        ),
      );
    });
  }
  parts.push(svgClose());
  return { svg: parts.join(''), alt: `${title} roadmap node details` };
}

function renderSearch(data: unknown): RenderedSvg {
  const root = asRecord(data);
  const matches = asRecords(root.matches);
  const shown = matches.slice(0, 20);
  const height = 170 + Math.max(shown.length, 1) * 66 + 70;
  const parts = [
    svgOpen(height, 'Roadmap search results'),
    header(
      'Roadmap search',
      `${matches.length} matching node${matches.length === 1 ? '' : 's'}`,
      'Search',
    ),
  ];
  if (shown.length === 0) {
    parts.push(emptyState(156, 'No matching roadmap nodes'));
  } else {
    shown.forEach((match, index) => {
      const y = 146 + index * 66;
      const score =
        typeof match.score === 'number'
          ? `${Math.round(Math.min(1, Math.max(0, match.score)) * 100)}% match`
          : humanize(readText(match.type, 'Node'));
      parts.push(
        card(SIDE, y, CONTENT_WIDTH, 52, COLORS.surface, COLORS.border, 12),
        card(SIDE, y, 7, 52, typeColor(match.type), 'none', 4),
        text(
          SIDE + 28,
          y + 32,
          truncate(readText(match.title, 'Untitled node'), 92),
          18,
          COLORS.ink,
          650,
        ),
        text(
          SIDE + CONTENT_WIDTH - 28,
          y + 32,
          score,
          14,
          COLORS.muted,
          500,
          'end',
        ),
      );
    });
  }
  if (matches.length > shown.length) {
    parts.push(
      text(
        SIDE,
        height - 34,
        `and ${matches.length - shown.length} more matches`,
        16,
        COLORS.purple,
        600,
      ),
    );
  }
  parts.push(svgClose());
  return { svg: parts.join(''), alt: 'Roadmap node search results' };
}

function renderChanges(data: unknown): RenderedSvg {
  const root = asRecord(data);
  const changes = asRecords(root.changes);
  const shown = changes.slice(0, 20);
  const height = 176 + Math.max(shown.length, 1) * 92 + 70;
  const parts = [
    svgOpen(height, 'Roadmap change history'),
    header(
      'Roadmap history',
      `${changes.length} recent change${changes.length === 1 ? '' : 's'}`,
      'Timeline',
    ),
  ];
  if (shown.length === 0) {
    parts.push(emptyState(156, 'No committed changes found'));
  } else {
    shown.forEach((change, index) => {
      const y = 150 + index * 92;
      if (index < shown.length - 1) {
        parts.push(
          line(SIDE + 15, y + 31, SIDE + 15, y + 105, COLORS.border, 3),
        );
      }
      parts.push(
        circle(SIDE + 15, y + 24, 10, statusColor(change.status)),
        text(SIDE + 44, y + 25, changeTitle(change), 18, COLORS.ink, 700),
        text(
          SIDE + 44,
          y + 53,
          `${readCount(change.operations_count)} operation${readCount(change.operations_count) === 1 ? '' : 's'} · ${formatDate(change.committed_at)}`,
          15,
          COLORS.muted,
          500,
        ),
      );
    });
  }
  if (changes.length > shown.length) {
    parts.push(
      text(
        SIDE,
        height - 34,
        `and ${changes.length - shown.length} more changes`,
        16,
        COLORS.purple,
        600,
      ),
    );
  }
  parts.push(svgClose());
  return { svg: parts.join(''), alt: 'Roadmap change history timeline' };
}

function svgOpen(height: number, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(label)}</title><desc id="desc">A static Proyekto roadmap visualization.</desc><rect width="${WIDTH}" height="${height}" fill="${COLORS.canvas}"/>`;
}

function svgClose(): string {
  return '</svg>';
}

function header(titleValue: string, subtitle: string, label: string): string {
  return [
    text(SIDE, 62, truncate(titleValue, 72), 34, COLORS.ink, 750),
    text(SIDE, 96, truncate(subtitle, 118), 17, COLORS.muted, 500),
    badge(WIDTH - SIDE - 184, 44, label),
  ].join('');
}

function metrics(values: Array<[string, number]>, y: number): string {
  return values
    .map(([label, value], index) => {
      const width = 210;
      const x = SIDE + index * (width + 16);
      return [
        card(x, y, width, 52, COLORS.surface, COLORS.border, 12),
        text(x + 18, y + 32, `${value}`, 20, COLORS.ink, 700),
        text(x + 62, y + 32, label, 15, COLORS.muted, 500),
      ].join('');
    })
    .join('');
}

function badge(x: number, y: number, value: string): string {
  const label = truncate(humanize(value), 18);
  return [
    card(x, y, 184, 36, statusSoftColor(value), 'none', 18),
    text(x + 92, y + 24, label, 14, statusColor(value), 700, 'middle'),
  ].join('');
}

function emptyState(y: number, label: string): string {
  return [
    card(SIDE, y, CONTENT_WIDTH, 82, COLORS.surface, COLORS.border, 16),
    text(WIDTH / 2, y + 49, label, 18, COLORS.muted, 600, 'middle'),
  ].join('');
}

function card(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  radius: number,
): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${stroke === 'none' ? 0 : 1}"/>`;
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  fill: string,
  weight = 500,
  anchor: 'start' | 'middle' | 'end' = 'start',
): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 2,
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function circle(x: number, y: number, radius: number, fill: string): string {
  return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}"/>`;
}

function statusColor(value: unknown): string {
  const normalized = readText(value, '').toLowerCase();
  if (/(done|complete|approved|active|success)/.test(normalized)) {
    return COLORS.green;
  }
  if (/(blocked|rejected|failed|overdue|cancel)/.test(normalized)) {
    return COLORS.red;
  }
  if (/(progress|review|pending|draft|open)/.test(normalized)) {
    return COLORS.amber;
  }
  return COLORS.purple;
}

function statusSoftColor(value: unknown): string {
  const color = statusColor(value);
  if (color === COLORS.green) return COLORS.greenSoft;
  if (color === COLORS.red) return COLORS.redSoft;
  if (color === COLORS.amber) return COLORS.amberSoft;
  return COLORS.purpleSoft;
}

function typeColor(value: unknown): string {
  const type = readText(value, '').toLowerCase();
  if (type === 'task') return COLORS.green;
  if (type === 'feature') return COLORS.blue;
  return COLORS.purple;
}

function changeTitle(change: Record<string, unknown>): string {
  const semantic = asRecord(change.semantic_diff);
  const summary = asRecord(semantic.summary);
  const labels = Object.entries(summary)
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && entry[1] > 0,
    )
    .slice(0, 2)
    .map(([type, count]) => `${count} ${humanize(type).toLowerCase()}`);
  if (labels.length > 0) return truncate(labels.join(' · '), 100);
  return humanize(readText(change.status, 'Roadmap updated'));
}

function formatDate(value: unknown): string {
  const raw = readText(value, '');
  if (!raw) return '';
  const match = /^\d{4}-\d{2}-\d{2}/.exec(raw);
  return match?.[0] ?? truncate(raw, 18);
}

function humanize(value: string): string {
  const normalized = value.replace(/[_-]+/g, ' ').trim();
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : '';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char] ?? char,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function readText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readCount(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}
