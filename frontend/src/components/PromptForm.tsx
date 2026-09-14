export type GenerationStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

interface PromptFormProps {
  prompt: string;
  status: GenerationStatus;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
}

export function PromptForm({
  prompt,
  status,
  onPromptChange,
  onGenerate,
  onCancel,
}: PromptFormProps) {
  const running = status === 'running';

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={running}
        placeholder="Describe the project you want to generate…"
        rows={4}
        className="w-full resize-none rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-900 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={running || prompt.trim().length === 0}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Generate Project
        </button>
        {running && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
