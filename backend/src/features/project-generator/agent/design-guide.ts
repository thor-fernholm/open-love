import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * The `designs/` folder holds one or more design-system reference files
 * (see designs/DESIGN.md, designs/DESIGN.md) - groundwork for letting a
 * user pick one later. For now, exactly one is "active" and gets read
 * fresh off disk on every prompt build (see buildAgentPrompt), so swapping
 * ACTIVE_DESIGN_FILE takes effect without restarting the backend.
 */
export function getDesignsDir(): string {
  return process.env.DESIGNS_DIR ?? resolve(process.cwd(), '..', 'designs');
}

export function getActiveDesignFile(): string {
  return process.env.ACTIVE_DESIGN_FILE ?? 'DESIGN.md';
}

/** Returns the active design guide's contents, or null if it's missing/
 *  unreadable - generation still works without one, just with no specific
 *  design guidance beyond whatever the model defaults to. */
export function readActiveDesignGuide(): string | null {
  const path = join(getDesignsDir(), getActiveDesignFile());
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.warn(
      `[design-guide] Could not read active design file at ${path}: ${(err as Error).message}`,
    );
    return null;
  }
}
