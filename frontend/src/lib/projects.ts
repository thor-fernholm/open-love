import type { AgentSelection } from './settings';

const API_BASE = 'http://localhost:3000';

/** Mirrors the backend's AgentOutputEvent discriminated union. */
export type AgentOutputEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string };

export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 'static' is the original plain HTML/CSS/JS generator; 'dynamic' scaffolds
 *  a Next.js + Prisma + SQLite app and runs it as a live process for
 *  preview. Fixed at project creation - see SiteTypeToggle. */
export type SiteType = 'static' | 'dynamic';

export type PreviewStatus =
  | 'idle'
  | 'installing'
  | 'generating'
  | 'building'
  | 'starting'
  | 'ready'
  | 'failed';

export interface PreviewState {
  status: PreviewStatus;
  port?: number;
  message?: string;
}

/** A reference file attached to a prompt - see TurnDetail. */
export interface TurnAttachment {
  name: string;
  path: string;
  mimeType: string;
}

/** One prompt submitted against a project, plus its replayed output. */
export interface TurnDetail {
  turnId: string;
  prompt: string;
  startedAt: string;
  status: TurnStatus;
  finishedAt?: string;
  events: AgentOutputEvent[];
  attachments?: TurnAttachment[];
  provider: 'claude' | 'ollama';
  model?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  /** Absent on projects created before this existed - treat as 'static'. */
  siteType?: SiteType;
}

export interface ProjectDetail extends ProjectSummary {
  turns: TurnDetail[];
  /** The job currently streaming into this project, if any. */
  activeJobId: string | null;
}

async function parseOrThrow<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    let message = `${action} failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      // no JSON body - keep the generic message
    }
    throw new Error(message);
  }
  return res.json();
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${API_BASE}/project-generator/projects`);
  return parseOrThrow(res, 'Loading projects');
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const res = await fetch(`${API_BASE}/project-generator/projects/${id}`);
  return parseOrThrow(res, 'Loading project');
}

/**
 * Starts a generation: pass `{ name }` to create a brand-new project, or
 * `{ projectId }` to send a follow-up prompt into an existing one. Always
 * sent as multipart (even with no files) so the endpoint's shape stays
 * uniform regardless of whether anything is attached. `siteType` is only
 * meaningful (and only ever sent) when creating a new project - an existing
 * project's site type is fixed and the backend ignores it on a follow-up.
 */
export async function startGeneration(
  prompt: string,
  target: { name: string; siteType?: SiteType } | { projectId: string },
  attachments: File[] = [],
  selection?: AgentSelection,
): Promise<{ jobId: string; projectId: string }> {
  const form = new FormData();
  form.append('prompt', prompt);
  for (const [key, value] of Object.entries(target)) {
    if (value !== undefined) form.append(key, value);
  }
  for (const file of attachments) {
    form.append('files', file);
  }
  if (selection) {
    form.append('provider', selection.provider);
    if (selection.model) form.append('model', selection.model);
  }
  const res = await fetch(`${API_BASE}/project-generator`, {
    method: 'POST',
    body: form,
  });
  return parseOrThrow(res, 'Starting generation');
}

export async function renameProject(
  id: string,
  name: string,
): Promise<ProjectSummary> {
  const res = await fetch(`${API_BASE}/project-generator/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseOrThrow(res, 'Renaming project');
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/project-generator/projects/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete project (${res.status})`);
  }
}

export async function cancelGeneration(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/project-generator/${jobId}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to cancel generation (${res.status})`);
  }
}

export function streamUrl(jobId: string): string {
  return `${API_BASE}/project-generator/${jobId}/stream`;
}

/** The "Open website" target - serves the project's own files as-is. */
export function previewUrl(projectId: string): string {
  return `${API_BASE}/project-generator/projects/${projectId}/preview/`;
}

/** The "Export" target - a zip of the project's own files, streamed with
 *  Content-Disposition: attachment so navigating to it just downloads. */
export function exportUrl(projectId: string): string {
  return `${API_BASE}/project-generator/projects/${projectId}/export`;
}

/** Polled while a 'dynamic' project's live preview is coming up (see
 *  PreviewStatus) - always `{ status: 'idle' }` for a 'static' project. */
export async function getPreviewStatus(projectId: string): Promise<PreviewState> {
  const res = await fetch(
    `${API_BASE}/project-generator/projects/${projectId}/preview-status`,
  );
  return parseOrThrow(res, 'Loading preview status');
}
