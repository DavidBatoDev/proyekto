import {
  rasterizeRoadmapSvg,
  renderRoadmapSvg,
  type RoadmapVisualKind,
} from './roadmap-visual';

describe('roadmap MCP visuals', () => {
  const summary = {
    roadmap_id: 'roadmap-1',
    title: 'Launch <script>alert("x")</script>',
    description: 'A & B',
    status: 'active',
    epic_count: 13,
    feature_count: 91,
    task_count: 42,
    epics: Array.from({ length: 13 }, (_, epicIndex) => ({
      id: `epic-${epicIndex}`,
      title: `Epic ${epicIndex + 1}`,
      status: epicIndex % 2 ? 'in_progress' : 'done',
      features: Array.from({ length: 7 }, (_, featureIndex) => ({
        id: `feature-${epicIndex}-${featureIndex}`,
        title: `Feature ${featureIndex + 1}`,
        status: 'todo',
      })),
    })),
    milestones: [
      {
        id: 'milestone-1',
        title: 'MVP',
        status: 'pending',
        target_date: '2026-09-01T00:00:00.000Z',
      },
    ],
  };

  it('renders an accessible, escaped, bounded summary SVG', () => {
    const { svg, alt } = renderRoadmapSvg('summary', summary);

    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title id="title">');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toMatch(/<foreignObject|(?:href|src)=["']https?:\/\//);
    expect(svg).toContain('and 1 more epics');
    expect(svg).toContain('and 1 more features');
    expect(alt).toContain('roadmap overview');
  });

  it('rasterizes the generated SVG to a valid PNG', () => {
    const { svg } = renderRoadmapSvg('summary', summary);
    const png = Buffer.from(rasterizeRoadmapSvg(svg), 'base64');

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it.each<RoadmapVisualKind>(['list', 'summary', 'node', 'search', 'changes'])(
    'renders the %s view without external assets',
    (kind) => {
      const payloads: Record<RoadmapVisualKind, unknown> = {
        list: { roadmaps: [{ id: 'r1', name: 'Alpha', status: 'active' }] },
        summary,
        node: {
          node: { id: 'e1', type: 'epic', title: 'Epic', status: 'active' },
          children: {
            children: [{ id: 'f1', type: 'feature', title: 'Feature' }],
          },
        },
        search: {
          matches: [
            { id: 'f1', type: 'feature', title: 'Feature', score: 0.92 },
          ],
        },
        changes: {
          changes: [
            {
              change_id: 'c1',
              status: 'applied',
              operations_count: 2,
              committed_at: '2026-07-20T10:00:00.000Z',
            },
          ],
        },
      };

      const { svg } = renderRoadmapSvg(kind, payloads[kind]);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toMatch(
        /<script|<foreignObject|(?:href|src)=["']https?:\/\//,
      );
    },
  );
});
