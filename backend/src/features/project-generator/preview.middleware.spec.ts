import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { createPreviewMiddleware } from './preview.middleware';
import type { DynamicPreviewService } from './dynamic-preview.service';
import type { ProjectGeneratorService } from './project-generator.service';

/**
 * Regression coverage for a real bug caught in live testing: naive
 * substring matching on "/preview" also matched "/preview-status" (a
 * separate, real controller route sharing the same path prefix), silently
 * swallowing that endpoint into the preview-serving logic instead of
 * letting it reach ProjectGeneratorController. See the afterMarkerChar
 * boundary check in preview.middleware.ts.
 */
describe('createPreviewMiddleware', () => {
  function fakeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      sendFile: jest.fn(),
      redirect: jest.fn(),
      end: jest.fn(),
    } as unknown as Response;
  }

  it('does not treat /preview-status as a preview request - falls through to the real route', () => {
    const projectGenerator = {
      getSiteType: jest.fn(),
      resolvePreviewFile: jest.fn(),
    } as unknown as ProjectGeneratorService;
    const dynamicPreview = { getStatus: jest.fn() } as unknown as DynamicPreviewService;
    const middleware = createPreviewMiddleware(projectGenerator, dynamicPreview);

    const req = { path: '/project-generator/projects/abc123/preview-status' } as Request;
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(projectGenerator.getSiteType).not.toHaveBeenCalled();
    expect(projectGenerator.resolvePreviewFile).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('treats /preview (root) as a static preview request', () => {
    const projectGenerator = {
      getSiteType: jest.fn(() => 'static'),
      resolvePreviewFile: jest.fn(() => '/tmp/fake/index.html'),
    } as unknown as ProjectGeneratorService;
    const dynamicPreview = { getStatus: jest.fn() } as unknown as DynamicPreviewService;
    const middleware = createPreviewMiddleware(projectGenerator, dynamicPreview);

    const req = { path: '/project-generator/projects/abc123/preview/' } as Request;
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(projectGenerator.getSiteType).toHaveBeenCalledWith('abc123');
    expect(projectGenerator.resolvePreviewFile).toHaveBeenCalledWith('abc123', '');
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/fake/index.html', expect.any(Function));
    expect(next).not.toHaveBeenCalled();
  });

  it('treats /preview/sub/path as a static preview request for that sub-path', () => {
    const projectGenerator = {
      getSiteType: jest.fn(() => 'static'),
      resolvePreviewFile: jest.fn(() => '/tmp/fake/styles.css'),
    } as unknown as ProjectGeneratorService;
    const dynamicPreview = { getStatus: jest.fn() } as unknown as DynamicPreviewService;
    const middleware = createPreviewMiddleware(projectGenerator, dynamicPreview);

    const req = { path: '/project-generator/projects/abc123/preview/styles.css' } as Request;
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(projectGenerator.resolvePreviewFile).toHaveBeenCalledWith('abc123', 'styles.css');
  });

  it('serves a status page (not a 404/proxy error) for a dynamic project whose preview is not ready yet', () => {
    const projectGenerator = {
      getSiteType: jest.fn(() => 'dynamic'),
      resolvePreviewFile: jest.fn(),
    } as unknown as ProjectGeneratorService;
    const dynamicPreview = {
      getStatus: jest.fn(() => ({ status: 'building' as const })),
    } as unknown as DynamicPreviewService;
    const middleware = createPreviewMiddleware(projectGenerator, dynamicPreview);

    const req = { path: '/project-generator/projects/abc123/preview/' } as Request;
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Building'));
    expect(projectGenerator.resolvePreviewFile).not.toHaveBeenCalled();
  });

  it('redirects to the live server\'s own port for a ready dynamic project - not a proxy', () => {
    // Regression coverage for a real bug caught in live testing: proxying
    // the dynamic app under this backend's own origin broke every one of
    // its absolute root-relative links/assets (Next.js writes these
    // everywhere) the moment a user clicked through, since the browser
    // resolved them against this backend's origin, not the proxied app's -
    // producing this backend's own 404 JSON for a path like "/login" that
    // only exists on the dynamic app. A redirect puts the browser on the
    // app's own origin for real, so this can't happen.
    const projectGenerator = {
      getSiteType: jest.fn(() => 'dynamic'),
      resolvePreviewFile: jest.fn(),
    } as unknown as ProjectGeneratorService;
    const dynamicPreview = {
      getStatus: jest.fn(() => ({ status: 'ready' as const, port: 61481 })),
    } as unknown as DynamicPreviewService;
    const middleware = createPreviewMiddleware(projectGenerator, dynamicPreview);

    const req = {
      path: '/project-generator/projects/abc123/preview/login',
      url: '/project-generator/projects/abc123/preview/login?next=/home',
    } as Request;
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'http://127.0.0.1:61481/login?next=/home',
    );
    expect(res.sendFile).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('falls through to the real route for a plain GET with no /preview segment at all', () => {
    const projectGenerator = {
      getSiteType: jest.fn(),
      resolvePreviewFile: jest.fn(),
    } as unknown as ProjectGeneratorService;
    const dynamicPreview = { getStatus: jest.fn() } as unknown as DynamicPreviewService;
    const middleware = createPreviewMiddleware(projectGenerator, dynamicPreview);

    const req = { path: '/project-generator/projects/abc123' } as Request;
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(projectGenerator.getSiteType).not.toHaveBeenCalled();
  });
});
