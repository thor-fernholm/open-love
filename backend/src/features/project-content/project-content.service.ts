import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { extname, join } from 'path';
import { assertSafeId, getProjectDir } from '../project-generator/project-store';
import type { ContentCollectionSchema, ProjectContent } from './content.types';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
]);

/**
 * Reads/writes a project's `content/*.json` files, driven entirely by
 * whatever collections that project's own `content/manifest.json` declares
 * (written by the agent at generation time - a project that never declared
 * one is a plain static site with nothing to edit here). This app only
 * ever edits collection *data*, never the schema itself - that keeps the
 * editor generic instead of needing a schema-builder UI.
 */
@Injectable()
export class ProjectContentService {
  getAll(projectId: string): ProjectContent {
    assertSafeId(projectId);
    this.assertProjectExists(projectId);
    const collections = this.readManifest(projectId);
    const data: Record<string, unknown> = {};
    for (const collection of collections) {
      data[collection.name] =
        this.readCollectionData(projectId, collection.name) ??
        (collection.type === 'list' ? [] : {});
    }
    return { collections, data };
  }

  update(projectId: string, name: string, data: unknown): void {
    assertSafeId(projectId);
    this.assertProjectExists(projectId);
    this.assertSafeCollectionName(name);

    const collections = this.readManifest(projectId);
    const schema = collections.find((c) => c.name === name);
    if (!schema) {
      throw new BadRequestException(`Unknown content collection "${name}"`);
    }
    this.assertShape(schema, data);

    writeFileSync(this.collectionPath(projectId, name), JSON.stringify(data, null, 2));
  }

  /** Saves an uploaded image under the project's own content/uploads/
   *  folder and returns its path relative to the project root - servable
   *  as-is by preview.middleware.ts, no other wiring needed. */
  saveUpload(projectId: string, originalName: string, buffer: Buffer): string {
    assertSafeId(projectId);
    this.assertProjectExists(projectId);

    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('File is too large (max 5MB)');
    }
    const ext = extname(originalName).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`Unsupported image type "${ext}"`);
    }

    const uploadsDir = join(getProjectDir(projectId), 'content', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    writeFileSync(join(uploadsDir, filename), buffer);
    return `content/uploads/${filename}`;
  }

  private readManifest(projectId: string): ContentCollectionSchema[] {
    const path = join(getProjectDir(projectId), 'content', 'manifest.json');
    if (!existsSync(path)) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new BadRequestException(
        'content/manifest.json is not valid JSON on disk',
      );
    }
    return Array.isArray(parsed) ? (parsed as ContentCollectionSchema[]) : [];
  }

  private readCollectionData(projectId: string, name: string): unknown {
    const path = this.collectionPath(projectId, name);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new BadRequestException(
        `content/${name}.json is not valid JSON on disk`,
      );
    }
  }

  private collectionPath(projectId: string, name: string): string {
    return join(getProjectDir(projectId), 'content', `${name}.json`);
  }

  private assertProjectExists(projectId: string): void {
    if (!existsSync(getProjectDir(projectId))) {
      throw new NotFoundException(`No project found with id ${projectId}`);
    }
  }

  /** Collection names come from the agent-written manifest, not a fixed
   *  enum, so they get the same "never let this become a path traversal"
   *  treatment assertSafeId gives project ids. */
  private assertSafeCollectionName(name: string): void {
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new BadRequestException(`Invalid content collection name "${name}"`);
    }
  }

  private assertShape(schema: ContentCollectionSchema, data: unknown): void {
    const isArray = Array.isArray(data);
    const isPlainObject = typeof data === 'object' && data !== null && !isArray;
    if (schema.type === 'list' && !isArray) {
      throw new BadRequestException(`"${schema.name}" must be a JSON array`);
    }
    if (schema.type === 'singleton' && !isPlainObject) {
      throw new BadRequestException(`"${schema.name}" must be a JSON object`);
    }
  }
}
