import { FileButton } from './FileButton';
import { ModelSelect } from './ModelSelect';
import type { AgentSelection } from '../lib/settings';

export type GenerationStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

const ATTACHMENT_ACCEPT = 'image/*,.pdf,.txt,.md,.csv,.json';
const MAX_ATTACHMENTS = 5;

interface PromptFormProps {
  /** "new" shows the project-name field; "existing" sends follow-ups. */
  mode: 'new' | 'existing';
  name: string;
  onNameChange: (value: string) => void;
  prompt: string;
  status: GenerationStatus;
  onPromptChange: (value: string) => void;
  attachments: File[];
  onAttachmentsChange: (files: File[]) => void;
  selection: AgentSelection;
  onSelectionChange: (selection: AgentSelection) => void;
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
  attachments,
  onAttachmentsChange,
  selection,
  onSelectionChange,
  onGenerate,
  onCancel,
}: PromptFormProps) {
  const running = status === 'running';
  const canGenerate =
    !running &&
    prompt.trim().length > 0 &&
    (mode === 'existing' || name.trim().length > 0);

  function addFiles(files: File[]) {
    onAttachmentsChange([...attachments, ...files].slice(0, MAX_ATTACHMENTS));
  }

  function removeFile(index: number) {
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
  }

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

      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {attachments.map((file, i) => (
            <span
              key={`${file.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-2.5 py-1 text-xs text-ink"
            >
              <span className="max-w-[10rem] truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={`Remove ${file.name}`}
                className="text-muted hover:text-error"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
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

        <div className="flex flex-wrap items-center gap-2">
          <ModelSelect value={selection} onChange={onSelectionChange} disabled={running} />
          <FileButton
            accept={ATTACHMENT_ACCEPT}
            multiple
            disabled={running || attachments.length >= MAX_ATTACHMENTS}
            onFiles={addFiles}
          >
            <PaperclipIcon /> Attach
          </FileButton>
        </div>
      </div>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="h-4 w-4"
    >
      <path
        d="M13.5 6.5 8 12a2 2 0 1 0 2.83 2.83l5-5a3.5 3.5 0 0 0-4.95-4.95l-5.5 5.5a5 5 0 0 0 7.07 7.07"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
