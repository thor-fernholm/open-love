import { useEffect, useState } from 'react';
import {
  CLAUDE_MODELS,
  getOllamaModels,
  type AgentSelection,
  type OllamaModelInfo,
} from '../lib/settings';

const CLAUDE_PREFIX = 'claude:';
const OLLAMA_PREFIX = 'ollama:';

// Matches backend's ClaudeCliService.DEFAULT_CLAUDE_MODEL - the fallback
// when unset.
const DEFAULT_CLAUDE_MODEL = 'haiku';

const DEFAULT_CLASS =
  'rounded-sm border border-hairline bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-ring/50 disabled:opacity-60';

interface ModelSelectProps {
  value: AgentSelection;
  onChange: (selection: AgentSelection) => void;
  disabled?: boolean;
  className?: string;
  /** Advanced (dynamic) projects are Claude Code only for now - hides the
   *  Ollama optgroup entirely and coerces an Ollama selection back to
   *  Claude Code rather than leaving a stale, now-invalid choice in place. */
  claudeOnly?: boolean;
}

/**
 * One dropdown, grouped by provider - Claude Code's model tiers, then every
 * locally-detected Ollama model - so it's clear which model comes from
 * where. Shared by the settings popup (sets the global default) and the
 * chat's per-message override, so both controls stay identical.
 */
export function ModelSelect({
  value,
  onChange,
  disabled,
  className,
  claudeOnly,
}: ModelSelectProps) {
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [ollamaAvailable, setOllamaAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getOllamaModels()
      .then((result) => {
        if (cancelled) return;
        setOllamaAvailable(result.available);
        setModels(result.models);
      })
      .catch(() => {
        if (!cancelled) setOllamaAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (claudeOnly && value.provider === 'ollama') {
      onChange({ provider: 'claude' });
    }
  }, [claudeOnly, value.provider, onChange]);

  const selectValue =
    value.provider === 'ollama' && value.model
      ? `${OLLAMA_PREFIX}${value.model}`
      : `${CLAUDE_PREFIX}${value.model ?? DEFAULT_CLAUDE_MODEL}`;

  function handleChange(raw: string) {
    if (raw.startsWith(OLLAMA_PREFIX)) {
      onChange({ provider: 'ollama', model: raw.slice(OLLAMA_PREFIX.length) });
    } else {
      onChange({ provider: 'claude', model: raw.slice(CLAUDE_PREFIX.length) });
    }
  }

  return (
    <select
      value={selectValue}
      onChange={(e) => handleChange(e.target.value)}
      disabled={disabled}
      className={className ?? DEFAULT_CLASS}
    >
      <optgroup label="Claude Code">
        {CLAUDE_MODELS.map((model) => (
          <option key={model.value} value={`${CLAUDE_PREFIX}${model.value}`}>
            {model.label}
          </option>
        ))}
      </optgroup>
      {!claudeOnly &&
        (models.length === 0 && !ollamaAvailable ? (
          <option value="" disabled>
            Ollama not detected
          </option>
        ) : (
          <optgroup label="Ollama">
            {models.map((model) => (
              <option key={model.name} value={`${OLLAMA_PREFIX}${model.name}`}>
                {model.name}
                {model.supportsTools === false ? ' (no tool support)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}
