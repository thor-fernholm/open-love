import type { NextFunction, Request, Response } from 'express';
import { DynamicPreviewService, PreviewStatus } from './dynamic-preview.service';
import { ProjectGeneratorService } from './project-generator.service';

const PREFIX = '/project-generator/projects/';
const MARKER = '/preview';

const STATUS_LABEL: Record<PreviewStatus, string> = {
  idle: 'Starting…',
  installing: 'Installing dependencies…',
  generating: 'Preparing the database…',
  building: 'Building…',
  starting: 'Starting the server…',
  ready: 'Ready',
  failed: 'Failed to start',
};

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** A small status page shown in place of the proxied app while a
 *  'dynamic' project's live preview is still coming up - auto-refreshes
 *  every 2s until it's ready (see dynamic-preview.service.ts). */
function renderStartingPage(status: PreviewStatus, message?: string): string {
  const refresh = status === 'failed' ? '' : '<meta http-equiv="refresh" content="2">';
  const detail = message
    ? `<p>${escapeHtml(message)}</p>`
    : '<p>This can take a minute or two the first time (installing dependencies, building).</p>';
  return `<!doctype html><html><head><meta charset="utf-8">${refresh}<title>${STATUS_LABEL[status]}</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f7f4ed;color:#1c1c1c}main{max-width:28rem;padding:2rem;text-align:center}p{color:#5f5f5d;font-size:0.875rem}</style></head><body><main><h1>${STATUS_LABEL[status]}</h1>${detail}</main></body></html>`;
}

/**
 * Serves a generated project's own files - either directly off disk (a
 * 'static' project, plain HTML/CSS/JS) or, for a 'dynamic' project, a
 * redirect to its live running server's own port (see
 * dynamic-preview.service.ts) - not a transparent proxy. Next.js (like most
 * frameworks) writes root-relative absolute links/asset URLs everywhere
 * (`href="/login"`, `_next/static/...`) assuming it owns the whole origin;
 * proxying it under a sub-path here breaks every one of those the moment a
 * user clicks through, since the browser resolves them against this
 * backend's own origin, not the proxied app's. A real redirect instead puts
 * the browser genuinely on the app's own origin (its own port), so
 * everything it links to resolves correctly with no proxy involved at all.
 *
 * Registered as raw Express middleware in main.ts, rather than a Nest
 * `@Get()` route with a wildcard segment, so an arbitrary nested asset path
 * - e.g. `/preview/styles.css` referenced by a generated `index.html` -
 * works regardless of which path-to-regexp wildcard syntax the installed
 * Express version expects: matching here is plain prefix/substring logic on
 * `req.path`, not a route pattern.
 */
export function createPreviewMiddleware(
  projectGenerator: ProjectGeneratorService,
  dynamicPreview: DynamicPreviewService,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith(PREFIX)) {
      next();
      return;
    }

    const rest = req.path.slice(PREFIX.length); // "<id>/preview[/sub/path]"
    const markerIndex = rest.indexOf(MARKER);
    // The character right after "/preview" must end the string or start a
    // new path segment - otherwise this is some other route under the
    // same :id that merely starts with the same letters, e.g.
    // "/preview-status" (a real, separate controller route) matching
    // MARKER as a bare substring of "/preview-status" without this check.
    const afterMarkerChar = rest[markerIndex + MARKER.length];
    if (
      markerIndex === -1 ||
      (afterMarkerChar !== undefined && afterMarkerChar !== '/')
    ) {
      // e.g. plain GET /project-generator/projects/:id, or .../preview-status
      // - not a preview request, let the real controller route handle it.
      next();
      return;
    }

    const id = rest.slice(0, markerIndex);
    const afterMarker = rest.slice(markerIndex + MARKER.length);
    const subPath = afterMarker.startsWith('/') ? afterMarker.slice(1) : afterMarker;

    if (projectGenerator.getSiteType(id) === 'dynamic') {
      const preview = dynamicPreview.getStatus(id);
      if (preview.status !== 'ready' || !preview.port) {
        res
          .status(200)
          .type('html')
          .send(renderStartingPage(preview.status, preview.message));
        return;
      }
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(302, `http://127.0.0.1:${preview.port}/${subPath}${query}`);
      return;
    }

    let filePath: string;
    try {
      filePath = projectGenerator.resolvePreviewFile(id, subPath);
    } catch {
      res.status(404).end();
      return;
    }

    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).end();
      }
    });
  };
}
