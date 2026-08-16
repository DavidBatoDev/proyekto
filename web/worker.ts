interface PreviewMetadata {
  roadmapId: string;
  projectId: string | null;
  roadmapName: string;
  nodeId: string;
  nodeType: 'epic' | 'feature' | 'task';
  title: string;
}

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  BACKEND_API_URL?: string;
}

const NODE_LABELS: Record<PreviewMetadata['nodeType'], string> = {
  epic: 'Epic',
  feature: 'Feature',
  task: 'Task',
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] ?? character,
  );
}

function isCrawler(request: Request): boolean {
  const userAgent = request.headers.get('user-agent') ?? '';
  return /bot|crawler|spider|slack|facebookexternalhit|whatsapp|discord|telegram|linkedin|twitter/i.test(
    userAgent,
  );
}

export function buildPreviewHtml(
  metadata: PreviewMetadata,
  previewUrl: string,
  destinationUrl: string,
): string {
  const typeLabel = NODE_LABELS[metadata.nodeType];
  const title = `${metadata.title} · ${typeLabel}`;
  const description = `${typeLabel} in ${metadata.roadmapName} · Proyekto`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safePreviewUrl = escapeHtml(previewUrl);
  const safeDestinationUrl = escapeHtml(destinationUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle} · Proyekto</title>
    <meta name="description" content="${safeDescription}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Proyekto">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:url" content="${safePreviewUrl}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <link rel="canonical" href="${safeDestinationUrl}">
  </head>
  <body>
    <p>Opening Proyekto…</p>
    <script>window.location.replace(${JSON.stringify(destinationUrl)});</script>
    <noscript><a href="${safeDestinationUrl}">Open in Proyekto</a></noscript>
  </body>
</html>`;
}

async function fetchPreviewMetadata(
  request: Request,
  env: Env,
  roadmapId: string,
  nodeId: string,
): Promise<PreviewMetadata | null> {
  const backendBase = (env.BACKEND_API_URL ?? 'https://api.proyekto.tech').replace(
    /\/$/,
    '',
  );
  const endpoint = `${backendBase}/api/roadmap-shares/preview/${encodeURIComponent(roadmapId)}/${encodeURIComponent(nodeId)}`;
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json', 'user-agent': request.headers.get('user-agent') ?? '' },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: PreviewMetadata };
  return body.data ?? null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/roadmap\/preview\/([^/]+)\/([^/]+)$/);

    if (!match || request.method !== 'GET') {
      return env.ASSETS.fetch(request);
    }

    const roadmapId = decodeURIComponent(match[1]);
    const nodeId = decodeURIComponent(match[2]);
    const metadata = await fetchPreviewMetadata(request, env, roadmapId, nodeId);
    if (!metadata) {
      return new Response('Preview not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const previewUrl = url.toString();
    const destinationUrl = new URL(
      `/project/${encodeURIComponent(metadata.projectId ?? 'n')}/roadmap/${encodeURIComponent(metadata.roadmapId)}?nodeId=${encodeURIComponent(metadata.nodeId)}&view=roadmapView`,
      url.origin,
    ).toString();
    const html = buildPreviewHtml(metadata, previewUrl, destinationUrl);

    if (!isCrawler(request)) {
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
      },
    });
  },
};
