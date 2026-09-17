import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getActiveStackFile,
  getStacksDir,
  readActiveStackGuide,
} from './stack-guide';

describe('stack-guide', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `openlove-stacks-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    process.env.STACKS_DIR = dir;
  });

  afterEach(() => {
    delete process.env.STACKS_DIR;
    delete process.env.ACTIVE_STACK_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to ADVANCED-STACK.md', () => {
    expect(getActiveStackFile()).toBe('ADVANCED-STACK.md');
  });

  it('reads the active stack file fresh off disk', () => {
    writeFileSync(join(dir, 'ADVANCED-STACK.md'), '# Stack A');
    expect(readActiveStackGuide()).toBe('# Stack A');

    writeFileSync(join(dir, 'ADVANCED-STACK.md'), '# Stack A, edited');
    expect(readActiveStackGuide()).toBe('# Stack A, edited');
  });

  it('honors ACTIVE_STACK_FILE to swap which file is active', () => {
    writeFileSync(join(dir, 'OTHER.md'), '# Other stack');
    process.env.ACTIVE_STACK_FILE = 'OTHER.md';
    expect(getActiveStackFile()).toBe('OTHER.md');
    expect(readActiveStackGuide()).toBe('# Other stack');
  });

  it('returns null rather than throwing when the file is missing', () => {
    expect(readActiveStackGuide()).toBeNull();
  });

  it('honors STACKS_DIR', () => {
    expect(getStacksDir()).toBe(dir);
  });
});
