import { FileButton } from './FileButton';
import { ModelSelect } from './ModelSelect';
import { SiteTypeToggle } from './SiteTypeToggle';
import type { SiteType } from '../lib/projects';
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
  /** Only meaningful in "new" mode - an existing project's site type is
   *  fixed, so these are unused (and the toggle hidden) once one exists. */
  siteType: SiteType;
  onSiteTypeChange: (value: SiteType) => void;
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
  siteType,
  onSiteTypeChange,
  onGenerate,
  onCancel,
}: PromptFormProps) {
  const running = status === 'running';
  // In "existing" mode, sending while already running queues instead of
  // blocking (see ProjectPage's queue) - so inputs stay usable and Send
  // stays enabled. "new" mode has nothing to queue against yet (the only
  // in-flight thing is the project's own creation), so it still locks.
  const locked = mode === 'new' && running;
  const canGenerate =
    prompt.trim().length > 0 && (mode === 'existing' ? true : !locked && name.trim().length > 0);

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
            disabled={locked}
            placeholder="e.g. Personal portfolio site"
            className="w-full rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm text-ink shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/50 disabled:opacity-60"
          />
          <SiteTypeToggle
            value={siteType}
            onChange={onSiteTypeChange}
            disabled={locked}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {mode === 'new' && (
          <label htmlFor="prompt" className="text-xs font-medium text-muted">
            What should it build?
          </label>
        )}
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          disabled={locked}
          placeholder={
            mode === 'new'
              ? 'Describe the project you want to generate…'
              : running
                ? 'Type a follow-up - it’ll send once this one finishes…'
                : 'Describe what you’d like to improve, fix, or add next…'
          }
          rows={4}
          className="w-full resize-none rounded-sm border border-hairline bg-canvas p-3 text-sm text-ink shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/50 disabled:opacity-60"
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
            className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-button-inset transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mode === 'new' ? 'Generate Project' : running ? 'Queue' : 'Send'}
          </button>
          {running && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-sm bg-error px-4 py-2 text-sm font-medium text-on-primary shadow-button-inset transition hover:opacity-80"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ModelSelect
            value={selection}
            onChange={onSelectionChange}
            disabled={locked}
            claudeOnly={siteType === 'dynamic'}
          />
          <FileButton
            accept={ATTACHMENT_ACCEPT}
            multiple
            disabled={locked || attachments.length >= MAX_ATTACHMENTS}
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
