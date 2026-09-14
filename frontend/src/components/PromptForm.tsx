export type GenerationStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

interface PromptFormProps {
  /** "new" shows the project-name field; "existing" sends follow-ups. */
  mode: 'new' | 'existing';
  name: string;
  onNameChange: (value: string) => void;
  prompt: string;
  status: GenerationStatus;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
}

export function PromptForm({
  mode,
  name,
  onNameChange,
  prompt,
  status,
  onPromptChange,
  onGenerate,
  onCancel,
}: PromptFormProps) {
  const running = status === 'running';
  const canGenerate =
    !running &&
    prompt.trim().length > 0 &&
    (mode === 'existing' || name.trim().length > 0);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas p-4 shadow-sm">
      {mode === 'new' && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="project-name"
            className="text-xs font-medium text-muted"
          >
            Project name
          </label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={running}
            placeholder="e.g. Personal portfolio site"
            className="w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-disabled disabled:opacity-60"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="prompt" className="text-xs font-medium text-muted">
          {mode === 'new' ? 'What should it build?' : 'Follow-up prompt'}
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          disabled={running}
          placeholder="Describe the project you want to generate…"
          rows={4}
          className="w-full resize-none rounded-md border border-hairline bg-canvas p-3 text-sm text-ink shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-disabled disabled:opacity-60"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-sm transition hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-muted"
        >
          {mode === 'new' ? 'Generate Project' : 'Send'}
        </button>
        {running && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-error px-4 py-2 text-sm font-medium text-on-primary shadow-sm transition hover:opacity-90"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
