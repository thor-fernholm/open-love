import type { NextFunction, Request, Response } from 'express';
import { ProjectGeneratorService } from './project-generator.service';

const PREFIX = '/project-generator/projects/';
const MARKER = '/preview';

/**
 * Serves a generated project's own files as-is (plain static HTML/CSS/JS,
 * matching what the agent actually produces today) so the "Open website"
 * button can open a real page in a new tab.
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
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith(PREFIX)) {
      next();
      return;
    }

    const rest = req.path.slice(PREFIX.length); // "<id>/preview[/sub/path]"
    const markerIndex = rest.indexOf(MARKER);
    if (markerIndex === -1) {
      // e.g. plain GET /project-generator/projects/:id - not a preview
      // request, let the ProjectGeneratorController's own route handle it.
      next();
      return;
    }

    const id = rest.slice(0, markerIndex);
    const afterMarker = rest.slice(markerIndex + MARKER.length);
    const subPath = afterMarker.startsWith('/')
      ? afterMarker.slice(1)
      : afterMarker;

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
