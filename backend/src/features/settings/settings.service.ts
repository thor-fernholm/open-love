import { Injectable } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_CLAUDE_MODEL } from '../project-generator/agent/claude-cli.service';
import type { AgentSelection } from '../project-generator/project.types';

// Matches ClaudeCliService's own fallback, so a settings page loaded before
// any explicit save shows the model that's actually in effect rather than
// a blank/misleading selection.
const DEFAULT_SELECTION: AgentSelection = {
  provider: 'claude',
  model: DEFAULT_CLAUDE_MODEL,
};

/** Repo-root sibling, alongside designs/ and generated-projects/ - local
 *  machine config, not part of the generated output, gitignored. */
function getSettingsPath(): string {
  return (
    process.env.SETTINGS_FILE ??
    resolve(process.cwd(), '..', 'openlove-settings.json')
  );
}

function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
}

export interface OllamaModelInfo {
  name: string;
  /** null when the model's capabilities couldn't be determined. */
  supportsTools: boolean | null;
}

export interface OllamaModelsResult {
  available: boolean;
  models: OllamaModelInfo[];
}

/**
 * Persists the app-wide default agent selection (one small JSON file - no
 * database in this app) and detects locally-installed Ollama models. Both
 * generation (project-generator) and the frontend's settings/model-picker
 * UI depend on this.
 */
@Injectable()
export class SettingsService {
  getDefault(): AgentSelection {
    try {
      const raw = JSON.parse(readFileSync(getSettingsPath(), 'utf8')) as {
        provider?: unknown;
        model?: unknown;
      };
      if (raw.provider === 'claude' || raw.provider === 'ollama') {
        return {
          provider: raw.provider,
          model: typeof raw.model === 'string' ? raw.model : undefined,
        };
      }
    } catch {
      // No file yet, or it's unreadable/invalid - fall back to the default.
    }
    return DEFAULT_SELECTION;
  }

  setDefault(selection: AgentSelection): AgentSelection {
    writeFileSync(getSettingsPath(), JSON.stringify(selection, null, 2));
    return selection;
  }

  /** Never throws - Ollama not running/reachable is a normal, expected
   *  state, not an error. */
  async listOllamaModels(): Promise<OllamaModelsResult> {
    const base = getOllamaBaseUrl();
    let names: string[];
    try {
      const res = await fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { available: false, models: [] };
      const data = (await res.json()) as { models?: { name: string }[] };
      names = (data.models ?? []).map((m) => m.name);
    } catch {
      return { available: false, models: [] };
    }
    const models = await Promise.all(
      names.map((name) => this.describeModel(base, name)),
    );
    return { available: true, models };
  }

  /** Best-effort per-model capability check via Ollama's /api/show - used
   *  purely to hint the UI, never blocks listing a model that can't be
   *  described (supportsTools comes back null, not an error). */
  private async describeModel(
    base: string,
    name: string,
  ): Promise<OllamaModelInfo> {
    try {
      const res = await fetch(`${base}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { name, supportsTools: null };
      const data = (await res.json()) as { capabilities?: string[] };
      return {
        name,
        supportsTools: Array.isArray(data.capabilities)
          ? data.capabilities.includes('tools')
          : null,
      };
    } catch {
      return { name, supportsTools: null };
    }
  }
}
