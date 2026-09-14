const API_BASE = 'http://localhost:3000';

/** Mirrors the backend's AgentOutputEvent discriminated union. */
export type AgentOutputEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string };

export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** One prompt submitted against a project, plus its replayed output. */
export interface TurnDetail {
  turnId: string;
  prompt: string;
  startedAt: string;
  status: TurnStatus;
  finishedAt?: string;
  events: AgentOutputEvent[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
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
 * `{ projectId }` to send a follow-up prompt into an existing one.
 */
export async function startGeneration(
  prompt: string,
  target: { name: string } | { projectId: string },
): Promise<{ jobId: string; projectId: string }> {
  const res = await fetch(`${API_BASE}/project-generator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...target }),
  });
  return parseOrThrow(res, 'Starting generation');
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
