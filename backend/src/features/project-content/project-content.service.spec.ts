import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getProjectDir } from '../project-generator/project-store';
import type { ContentCollectionSchema } from './content.types';
import { ProjectContentService } from './project-content.service';

const MANIFEST: ContentCollectionSchema[] = [
  {
    name: 'products',
    label: 'Products',
    type: 'list',
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'image', label: 'Photo', type: 'image' },
    ],
  },
  {
    name: 'site',
    label: 'Site',
    type: 'singleton',
    fields: [{ key: 'title', label: 'Title', type: 'text' }],
  },
];

describe('ProjectContentService', () => {
  let service: ProjectContentService;
  let testDir: string;
  const projectId = 'test-project';

  function writeManifest(manifest: ContentCollectionSchema[] | null) {
    const contentDir = join(getProjectDir(projectId), 'content');
    mkdirSync(contentDir, { recursive: true });
    if (manifest) {
      writeFileSync(
        join(contentDir, 'manifest.json'),
        JSON.stringify(manifest),
      );
    }
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `openlove-content-test-${Date.now()}`);
    process.env.GENERATED_PROJECTS_DIR = testDir;
    service = new ProjectContentService();
    mkdirSync(getProjectDir(projectId), { recursive: true });
  });

  afterEach(() => {
    delete process.env.GENERATED_PROJECTS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns no collections for a project with no manifest (a static site)', () => {
    expect(service.getAll(projectId)).toEqual({ collections: [], data: {} });
  });

  it('reads declared collections, defaulting missing data files by type', () => {
    writeManifest(MANIFEST);
    const content = service.getAll(projectId);
    expect(content.collections).toEqual(MANIFEST);
    expect(content.data.products).toEqual([]);
    expect(content.data.site).toEqual({});
  });

  it('writes back an updated list collection', () => {
    writeManifest(MANIFEST);
    service.update(projectId, 'products', [{ title: 'Widget', image: '' }]);
    expect(service.getAll(projectId).data.products).toEqual([
      { title: 'Widget', image: '' },
    ]);
  });

  it('writes back an updated singleton collection', () => {
    writeManifest(MANIFEST);
    service.update(projectId, 'site', { title: 'My Shop' });
    expect(service.getAll(projectId).data.site).toEqual({ title: 'My Shop' });
  });

  it('rejects a collection not declared in the manifest', () => {
    writeManifest(MANIFEST);
    expect(() => service.update(projectId, 'secrets', {})).toThrow(
      BadRequestException,
    );
  });

  it('rejects the wrong shape for a declared collection', () => {
    writeManifest(MANIFEST);
    expect(() => service.update(projectId, 'site', [])).toThrow(
      BadRequestException,
    );
    expect(() => service.update(projectId, 'products', {})).toThrow(
      BadRequestException,
    );
  });

  it('rejects an unsafe collection name before it ever touches the filesystem', () => {
    writeManifest(MANIFEST);
    expect(() => service.update(projectId, '../../etc/passwd', {})).toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException for an unknown project', () => {
    expect(() => service.getAll('does-not-exist')).toThrow(NotFoundException);
  });

  it('rejects a project id that attempts path traversal', () => {
    expect(() => service.getAll('../../etc')).toThrow();
  });

  it('saves an upload under content/uploads and returns its relative path', () => {
    const relativePath = service.saveUpload(
      projectId,
      'photo.png',
      Buffer.from('fake-image-bytes'),
    );
    expect(relativePath).toMatch(/^content\/uploads\/[\w-]+\.png$/);
    const savedBytes = readFileSync(
      join(getProjectDir(projectId), relativePath),
    );
    expect(savedBytes.toString()).toBe('fake-image-bytes');
  });

  it('rejects an upload with a disallowed extension', () => {
    expect(() =>
      service.saveUpload(projectId, 'payload.exe', Buffer.from('x')),
    ).toThrow(BadRequestException);
  });

  it('rejects an upload over the size limit', () => {
    expect(() =>
      service.saveUpload(projectId, 'big.png', Buffer.alloc(6 * 1024 * 1024)),
    ).toThrow(BadRequestException);
  });
});
