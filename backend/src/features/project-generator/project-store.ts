import { BadRequestException } from '@nestjs/common';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join, resolve, sep } from 'path';
import { AgentOutputEvent } from './agent/agent-service.interface';
import { ProjectMeta, TurnDetail, TurnRecord, TurnStatus } from './project.types';

/**
 * Filesystem-backed persistence for projects and their generation turns —
 * there is no database, so a project's metadata and logs live in a
 * `.openlove/` dotfolder alongside its own generated files, keeping the two
 * from ever colliding. All paths here are derived purely from a project id,
 * so callers remain responsible for validating that id before it reaches
 * any of these functions (see assertSafeId below).
 */

/**
 * Resolves the repo-root `./generated-projects` directory, per CLAUDE.md's
 * generator spec. Assumes the backend is launched via
 * `cd backend && npm run start:dev` (cwd = backend/), so the repo root is
 * one level up; overridable via GENERATED_PROJECTS_DIR for other setups.
 */
export function getGeneratedProjectsRoot(): string {
  return (
    process.env.GENERATED_PROJECTS_DIR ??
    resolve(process.cwd(), '..', 'generated-projects')
  );
}

/** The repo-root `templates/advanced-starter` folder a new 'dynamic'
 *  project is seeded from (copied wholesale, not built from a blank folder
 *  like a 'static' one) - see ProjectGeneratorService.createProject. */
export function getAdvancedStarterDir(): string {
  return (
    process.env.ADVANCED_STARTER_DIR ??
    resolve(process.cwd(), '..', 'templates', 'advanced-starter')
  );
}

/** Defense in depth beyond DTO-level regexes: never let an id escape the
 *  generated-projects root when used to build a filesystem path. Shared by
 *  every feature that touches a project's files by id. */
export function assertSafeId(id: string): void {
  if (!id || id.includes('..') || /[/\\]/.test(id)) {
    throw new BadRequestException('Invalid id');
  }
}

export function getProjectDir(id: string): string {
  return resolve(getGeneratedProjectsRoot(), id);
}

/**
 * Resolves `relativePath` against `root`, rejecting anything that would
 * escape it (`..` segments, absolute paths, etc.) - the one traversal
 * check shared by the preview server, the agent's file tools, and
 * anywhere else that turns a model- or user-supplied path into a real
 * filesystem path. Throws BadRequestException on escape, exactly like
 * assertSafeId does for ids.
 */
export function resolveWithinDir(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw new BadRequestException('Path escapes the project directory');
  }
  return target;
}

function getMetaDir(id: string): string {
  return join(getProjectDir(id), '.openlove');
}

function getMetaPath(id: string): string {
  return join(getMetaDir(id), 'meta.json');
}

function getTurnsPath(id: string): string {
  return join(getMetaDir(id), 'turns.json');
}

function getTranscriptDir(id: string): string {
  return join(getMetaDir(id), 'transcript');
}

function getTranscriptPath(id: string, turnId: string): string {
  return join(getTranscriptDir(id), `${turnId}.jsonl`);
}

export function writeMeta(id: string, meta: ProjectMeta): void {
  mkdirSync(getMetaDir(id), { recursive: true });
  writeFileSync(getMetaPath(id), JSON.stringify(meta, null, 2));
}

export function readMeta(id: string): ProjectMeta | null {
  try {
    return JSON.parse(readFileSync(getMetaPath(id), 'utf8')) as ProjectMeta;
  } catch {
    return null;
  }
}

/** Fallback "createdAt" for a folder that predates - or never got - metadata. */
export function statBirthtime(id: string): string {
  return statSync(getProjectDir(id)).birthtime.toISOString();
}

function readTurns(id: string): TurnRecord[] {
  try {
    return JSON.parse(readFileSync(getTurnsPath(id), 'utf8')) as TurnRecord[];
  } catch {
    return [];
  }
}

function writeTurns(id: string, turns: TurnRecord[]): void {
  mkdirSync(getMetaDir(id), { recursive: true });
  writeFileSync(getTurnsPath(id), JSON.stringify(turns, null, 2));
}

export function appendTurn(id: string, turn: TurnRecord): void {
  const turns = readTurns(id);
  turns.push(turn);
  writeTurns(id, turns);
}

export function updateTurnStatus(
  id: string,
  turnId: string,
  status: TurnStatus,
  finishedAt: string,
): void {
  const turns = readTurns(id);
  const turn = turns.find((t) => t.turnId === turnId);
  if (!turn) {
    return;
  }
  turn.status = status;
  turn.finishedAt = finishedAt;
  writeTurns(id, turns);
}

/** Appends one raw agent event to a turn's own log file - never rewritten,
 *  only ever appended to, since it streams live while the job runs. */
export function appendTurnEvent(
  id: string,
  turnId: string,
  event: AgentOutputEvent,
): void {
  mkdirSync(getTranscriptDir(id), { recursive: true });
  appendFileSync(getTranscriptPath(id, turnId), JSON.stringify(event) + '\n');
}

function readTurnEvents(id: string, turnId: string): AgentOutputEvent[] {
  let raw: string;
  try {
    raw = readFileSync(getTranscriptPath(id, turnId), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AgentOutputEvent);
}

/** Every turn for a project, each carrying its own replayed event log. */
export function readAllTurns(id: string): TurnDetail[] {
  return readTurns(id).map((turn) => ({
    ...turn,
    events: readTurnEvents(id, turn.turnId),
  }));
}

/** Every project folder under the generated-projects root, metadata or not. */
export function listProjectIds(): string[] {
  const root = getGeneratedProjectsRoot();
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// Never part of "the project" the agent, or an export, should see/ship:
// .openlove is this app's own metadata; node_modules/.next are regenerated
// by `npm install`/`npm run build` on a dynamic project and would otherwise
// bloat every export zip for no reason.
const SKIP_DIR_NAMES = new Set(['.openlove', 'node_modules', '.next']);

/** Every file under `root` (recursive, forward-slash-normalized relative
 *  paths), skipping SKIP_DIR_NAMES. Shared by the agent's own `list_files`
 *  tool (agent/tools.ts) and project export (project-generator.service.ts),
 *  so both see exactly the same "what's actually in this project" view. */
export function listDirRecursive(root: string, relDir: string): string[] {
  const abs = join(root, relDir);
  if (!existsSync(abs)) return [];
  const entries = readdirSync(abs, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const relPath = relDir === '.' ? entry.name : join(relDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listDirRecursive(root, relPath));
    } else {
      results.push(relPath.split('\\').join('/'));
    }
  }
  return results;
}
