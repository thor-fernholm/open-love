import { BadRequestException } from '@nestjs/common';
import { join } from 'path';
import { resolveWithinDir } from './project-store';

describe('resolveWithinDir', () => {
  const root = join('C:', 'projects', 'my-app');

  it('resolves a plain relative path inside the root', () => {
    expect(resolveWithinDir(root, 'index.html')).toBe(join(root, 'index.html'));
    expect(resolveWithinDir(root, 'content/site.json')).toBe(
      join(root, 'content', 'site.json'),
    );
  });

  it('resolves the root itself for an empty path', () => {
    expect(resolveWithinDir(root, '')).toBe(root);
  });

  it('rejects a path that escapes the root via ..', () => {
    expect(() => resolveWithinDir(root, '../../etc/passwd')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => resolveWithinDir(root, 'C:\\Windows\\System32')).toThrow(
      BadRequestException,
    );
  });
});
