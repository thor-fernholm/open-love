import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * The `stacks/` folder holds the tech-stack/structure conventions doc for
 * "advanced" (dynamic) projects - same live-off-disk pattern as
 * design-guide.ts for visual design: exactly one file is "active" and gets
 * read fresh on every prompt build, so swapping ACTIVE_STACK_FILE takes
 * effect without restarting the backend.
 */
export function getStacksDir(): string {
  return process.env.STACKS_DIR ?? resolve(process.cwd(), '..', 'stacks');
}

export function getActiveStackFile(): string {
  return process.env.ACTIVE_STACK_FILE ?? 'ADVANCED-STACK.md';
}

/** Returns the active stack guide's contents, or null if it's missing/
 *  unreadable - generation still works without one, just with no specific
 *  stack guidance beyond whatever the model defaults to. */
export function readActiveStackGuide(): string | null {
  const path = join(getStacksDir(), getActiveStackFile());
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.warn(
      `[stack-guide] Could not read active stack file at ${path}: ${(err as Error).message}`,
    );
    return null;
  }
}
