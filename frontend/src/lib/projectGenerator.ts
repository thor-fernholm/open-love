const API_BASE = 'http://localhost:3000';

/** Mirrors the backend's AgentOutputEvent discriminated union. */
export type AgentOutputEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string };

export async function startGeneration(
  prompt: string,
  projectName: string,
): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/project-generator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, projectName }),
  });
  if (!res.ok) {
    throw new Error(`Failed to start generation (${res.status})`);
  }
  return res.json();
}

export async function cancelGeneration(jobId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/project-generator/${jobId}/cancel`,
    { method: 'POST' },
  );
  if (!res.ok) {
    throw new Error(`Failed to cancel generation (${res.status})`);
  }
}

export function streamUrl(jobId: string): string {
  return `${API_BASE}/project-generator/${jobId}/stream`;
}
