import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getActiveDesignFile,
  getDesignsDir,
  listDesignFiles,
  pickDesignForPrompt,
  readDesignGuide,
} from './design-guide';

function writeDesign(dir: string, filename: string, name: string, tags: string[]): void {
  writeFileSync(
    join(dir, filename),
    `---\nname: ${name}\ntags: ${tags.join(', ')}\n---\nBody text for ${name}.\n`,
  );
}

describe('design-guide', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `openlove-designs-test-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
    process.env.DESIGNS_DIR = dir;
  });

  afterEach(() => {
    delete process.env.DESIGNS_DIR;
    delete process.env.ACTIVE_DESIGN_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('honors DESIGNS_DIR', () => {
    expect(getDesignsDir()).toBe(dir);
  });

  it('has no manual override by default', () => {
    expect(getActiveDesignFile()).toBeNull();
  });

  it('lists only .md files, sorted', () => {
    writeDesign(dir, 'B.md', 'B', []);
    writeDesign(dir, 'A.md', 'A', []);
    writeFileSync(join(dir, 'notes.txt'), 'ignore me');
    expect(listDesignFiles()).toEqual(['A.md', 'B.md']);
  });

  it('returns an empty list rather than throwing when the folder is missing', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(listDesignFiles()).toEqual([]);
  });

  it('reads a design file fresh off disk', () => {
    writeDesign(dir, 'A.md', 'A', []);
    expect(readDesignGuide('A.md')).toContain('Body text for A.');
  });

  it('returns null rather than throwing for a missing design file', () => {
    expect(readDesignGuide('missing.md')).toBeNull();
  });

  it('picks the file whose tags best match the prompt', () => {
    writeDesign(dir, 'DARK.md', 'Dark Tech', ['dark', 'tech', 'startup']);
    writeDesign(dir, 'BAKERY.md', 'Organic', ['bakery', 'cafe', 'organic']);
    expect(pickDesignForPrompt('a cozy neighborhood bakery site', 'proj-1')).toBe('BAKERY.md');
    expect(pickDesignForPrompt('a dark developer tool for startups', 'proj-1')).toBe('DARK.md');
  });

  it('is deterministic - the same prompt and project id always picks the same file', () => {
    writeDesign(dir, 'DARK.md', 'Dark Tech', ['dark', 'tech']);
    writeDesign(dir, 'BAKERY.md', 'Organic', ['bakery', 'cafe']);
    const first = pickDesignForPrompt('a dark saas dashboard', 'proj-42');
    const second = pickDesignForPrompt('a dark saas dashboard', 'proj-42');
    expect(first).toBe(second);
  });

  it('breaks ties (including no match at all) deterministically via the project id, spread across the pool', () => {
    writeDesign(dir, 'A.md', 'A', ['unrelated-tag-one']);
    writeDesign(dir, 'B.md', 'B', ['unrelated-tag-two']);
    writeDesign(dir, 'C.md', 'C', ['unrelated-tag-three']);

    const picks = new Set(
      ['proj-a', 'proj-b', 'proj-c', 'proj-d', 'proj-e'].map((id) =>
        pickDesignForPrompt('a generic small business site', id),
      ),
    );
    // Same id -> same pick every time...
    expect(pickDesignForPrompt('a generic small business site', 'proj-a')).toBe(
      pickDesignForPrompt('a generic small business site', 'proj-a'),
    );
    // ...but different ids aren't all forced onto the same single file.
    expect(picks.size).toBeGreaterThan(1);
  });

  it('returns null when there are no design files at all', () => {
    expect(pickDesignForPrompt('anything', 'proj-1')).toBeNull();
  });

  it('ACTIVE_DESIGN_FILE overrides prompt-based selection entirely', () => {
    writeDesign(dir, 'DARK.md', 'Dark Tech', ['dark', 'tech']);
    writeDesign(dir, 'BAKERY.md', 'Organic', ['bakery', 'cafe']);
    process.env.ACTIVE_DESIGN_FILE = 'BAKERY.md';
    expect(pickDesignForPrompt('a dark developer tool', 'proj-1')).toBe('BAKERY.md');
    expect(getActiveDesignFile()).toBe('BAKERY.md');
  });
});
