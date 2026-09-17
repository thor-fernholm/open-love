import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

/**
 * The `designs/` folder holds a pool of design-system reference files, each
 * with a short frontmatter (`name`, `tags`) plus a compact, concrete spec
 * (palette/type/spacing/shadow/do's-and-don'ts) - see any DESIGN-*.md for
 * the shape. Which one a project uses is picked per-project (see
 * pickDesignForPrompt below) rather than one global file for everyone, so
 * different requests end up visually distinct instead of converging on the
 * same look. Every file is read fresh off disk on every call - no caching,
 * so adding/editing a file in designs/ takes effect immediately.
 */
export function getDesignsDir(): string {
  return process.env.DESIGNS_DIR ?? resolve(process.cwd(), '..', 'designs');
}

/** Optional manual override: when set, every project uses exactly this one
 *  file, bypassing pickDesignForPrompt entirely - useful for testing or
 *  temporarily rolling back to a single known-good design. Unset by
 *  default, which is what makes per-project variety actually happen. */
export function getActiveDesignFile(): string | null {
  return process.env.ACTIVE_DESIGN_FILE ?? null;
}

/** Every design file available to pick from, sorted for a stable order. */
export function listDesignFiles(): string[] {
  try {
    return readdirSync(getDesignsDir())
      .filter((name) => name.toLowerCase().endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/** Reads one design file's contents by name, or null if it's missing/
 *  unreadable - generation still works without one, just with no specific
 *  design guidance beyond whatever the model defaults to. */
export function readDesignGuide(filename: string): string | null {
  const path = join(getDesignsDir(), filename);
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.warn(
      `[design-guide] Could not read design file at ${path}: ${(err as Error).message}`,
    );
    return null;
  }
}

interface DesignMeta {
  tags: string[];
}

/** Pulls `tags` out of a design file's frontmatter (a simple `---`-fenced
 *  block, `key: value` lines) - no YAML dependency needed for something
 *  this small. Falls back to no tags (score 0) for a file with none. */
function parseDesignMeta(content: string): DesignMeta {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  if (!match) return { tags: [] };
  const tagsLine = /^tags:\s*(.+)$/m.exec(match[1]);
  if (!tagsLine) return { tags: [] };
  return {
    tags: tagsLine[1]
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** Deterministic string hash (djb2) - same input always hashes the same, so
 *  re-evaluating a tie-break (e.g. on self-heal, well after the original
 *  pick) never flips the result. Not cryptographic, just needs to spread
 *  evenly. */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Picks which design file a project should use. Scores every file in
 * designs/ by how many of its frontmatter tags appear as a substring of
 * the (lowercased) prompt - a cheap keyword match, not a model call, so it
 * costs nothing beyond a bit of string comparison and stays fast even with
 * a large pool. The highest scorer wins; ties (including "nothing matched
 * at all" - every file scored 0) are broken deterministically by hashing
 * `projectId` over just the tied candidates, so the result is still
 * reproducible but spreads evenly across the pool instead of always
 * landing on the same file when there's no keyword signal.
 *
 * `ACTIVE_DESIGN_FILE`, if set, overrides this entirely (see
 * getActiveDesignFile) - every project gets that one file regardless of
 * prompt. Returns null if designs/ has no files at all.
 */
export function pickDesignForPrompt(prompt: string, projectId: string): string | null {
  const override = getActiveDesignFile();
  if (override) return override;

  const files = listDesignFiles();
  if (files.length === 0) return null;

  const lowerPrompt = prompt.toLowerCase();
  const scored = files.map((file) => {
    const content = readDesignGuide(file);
    const meta = content ? parseDesignMeta(content) : { tags: [] };
    const score = meta.tags.filter((tag) => lowerPrompt.includes(tag)).length;
    return { file, score };
  });

  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const tied = scored.filter((entry) => entry.score === maxScore).map((entry) => entry.file);
  if (tied.length === 1) return tied[0];

  return tied[hashString(projectId) % tied.length];
}
