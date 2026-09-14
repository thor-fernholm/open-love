const API_BASE = 'http://localhost:3000';

export type AgentProvider = 'claude' | 'ollama';

export interface AgentSelection {
  provider: AgentProvider;
  model?: string;
}

// The CLI's tier aliases ("opus"/"sonnet"/"haiku") are what's actually
// stored/sent as AgentSelection.model (see backend's
// ClaudeCliService.DEFAULT_CLAUDE_MODEL) and always resolve to the CLI's
// current model for that tier - these labels are just which version that
// currently is, for display. Shared by ModelSelect (the picker) and
// ChatTurn (labeling a past turn), so both stay in sync when it changes.
export const CLAUDE_MODELS: { value: string; label: string }[] = [
  { value: 'opus', label: 'Opus 5' },
  { value: 'sonnet', label: 'Sonnet 5' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

export interface OllamaModelInfo {
  name: string;
  /** null when the model's capabilities couldn't be determined. */
  supportsTools: boolean | null;
}

export interface OllamaModelsResult {
  available: boolean;
  models: OllamaModelInfo[];
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

/** The app-wide default agent selection - new projects use this unless
 *  overridden per message (see ModelSelect). */
export async function getSettings(): Promise<AgentSelection> {
  const res = await fetch(`${API_BASE}/settings`);
  return parseOrThrow(res, 'Loading settings');
}

export async function updateSettings(
  selection: AgentSelection,
): Promise<AgentSelection> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selection),
  });
  return parseOrThrow(res, 'Saving settings');
}

/** Never rejects on Ollama being unreachable - that's a normal state
 *  (`available: false`), not an error. */
export async function getOllamaModels(): Promise<OllamaModelsResult> {
  const res = await fetch(`${API_BASE}/settings/ollama/models`);
  return parseOrThrow(res, 'Loading Ollama models');
}
