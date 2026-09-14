import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PromptForm, type GenerationStatus } from '../components/PromptForm';
import { TerminalWindow, type TerminalLine } from '../components/TerminalWindow';
import {
  cancelGeneration,
  getProject,
  previewUrl,
  startGeneration,
  streamUrl,
  type AgentOutputEvent,
  type TurnDetail,
} from '../lib/projects';

const STATUS_STYLES: Record<GenerationStatus, string> = {
  idle: 'bg-surface-card text-muted',
  running: 'bg-accent-amber/20 text-body-strong',
  completed: 'bg-success/15 text-success',
  error: 'bg-error/10 text-error',
  cancelled: 'bg-surface-card text-muted',
};

/** Flattens every turn's prompt + replayed output into one terminal log,
 *  in submission order - the shape today's single-pane UI renders; a future
 *  chat-history view could instead render `turns` individually. */
function turnsToLines(turns: TurnDetail[]): TerminalLine[] {
  const lines: TerminalLine[] = [];
  for (const turn of turns) {
    lines.push({ type: 'system', text: `> ${turn.prompt}` });
    let sawTerminalEvent = false;
    for (const event of turn.events) {
      if (event.type === 'stdout') {
        lines.push({ type: 'stdout', text: event.data });
      } else if (event.type === 'stderr') {
        lines.push({ type: 'stderr', text: event.data });
      } else if (event.type === 'exit') {
        sawTerminalEvent = true;
        lines.push({ type: 'system', text: `--- exited with code ${event.code} ---` });
      } else if (event.type === 'error') {
        sawTerminalEvent = true;
        lines.push({ type: 'system', text: `--- error: ${event.message} ---` });
      }
    }
    if (turn.status === 'cancelled' && !sawTerminalEvent) {
      lines.push({ type: 'system', text: '--- cancelled ---' });
    }
  }
  return lines;
}

function statusFromTurns(turns: TurnDetail[]): GenerationStatus {
  const last = turns[turns.length - 1];
  if (!last) return 'idle';
  if (last.status === 'failed') return 'error';
  return last.status;
}

interface ProjectPageProps {
  /** Called right after a brand-new project is created, so the sidebar
   *  refetches its list. */
  onProjectCreated: () => void;
}

/**
 * Renders both the empty "new project" state (no :id) and an existing
 * project's chat/log page (:id present) - one component so the terminal
 * and SSE-streaming logic isn't duplicated between the two.
 */
export function ProjectPage({ onProjectCreated }: ProjectPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const appendLine = useCallback((line: TerminalLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const openStream = useCallback(
    (streamJobId: string) => {
      const es = new EventSource(streamUrl(streamJobId));
      eventSourceRef.current = es;

      const onOutput = (type: 'stdout' | 'stderr') => (e: MessageEvent) => {
        const event: AgentOutputEvent = JSON.parse(e.data);
        if (event.type === type) appendLine({ type, text: event.data });
      };

      es.addEventListener('stdout', onOutput('stdout'));
      es.addEventListener('stderr', onOutput('stderr'));

      es.addEventListener('exit', (e: MessageEvent) => {
        const event: AgentOutputEvent = JSON.parse(e.data);
        if (event.type !== 'exit') return;
        appendLine({ type: 'system', text: `--- exited with code ${event.code} ---` });
        closeStream();
        setStatus(event.code === 0 ? 'completed' : 'error');
      });

      // Named "error" SSE events (our server's AgentOutputEvent) and
      // EventSource's own connection-level failures both land here under
      // the same event name - a real server event carries `.data`.
      es.addEventListener('error', (e: MessageEvent) => {
        if ('data' in e && e.data) {
          const event: AgentOutputEvent = JSON.parse(e.data);
          if (event.type === 'error') {
            appendLine({ type: 'system', text: `--- error: ${event.message} ---` });
          }
        } else {
          appendLine({ type: 'system', text: '--- connection lost ---' });
        }
        closeStream();
        setStatus('error');
      });
    },
    [appendLine, closeStream],
  );

  // Close any open stream on unmount.
  useEffect(() => closeStream, [closeStream]);

  // Fetches an existing project's saved state on mount. There's no need to
  // handle `id` *changing* here - App.tsx keys this component by route, so
  // switching projects (or to/from the id-less "new project" state) remounts
  // a fresh instance with its own initial state rather than reusing this one.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    getProject(id)
      .then((project) => {
        if (cancelled) return;
        setProjectName(project.name);
        setLines(turnsToLines(project.turns));
        if (project.activeJobId) {
          setJobId(project.activeJobId);
          setStatus('running');
          openStream(project.activeJobId);
        } else {
          setJobId(null);
          setStatus(statusFromTurns(project.turns));
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, openStream]);

  async function handleGenerate() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || starting) return;

    if (!id) {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      setStarting(true);
      setError(null);
      try {
        const { projectId } = await startGeneration(trimmedPrompt, {
          name: trimmedName,
        });
        onProjectCreated();
        navigate(`/projects/${projectId}`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setStarting(false);
      }
      return;
    }

    appendLine({ type: 'system', text: `> ${trimmedPrompt}` });
    setPrompt('');
    setStatus('running');
    try {
      const { jobId: newJobId } = await startGeneration(trimmedPrompt, {
        projectId: id,
      });
      setJobId(newJobId);
      openStream(newJobId);
    } catch (err) {
      appendLine({
        type: 'system',
        text: `--- failed to start: ${(err as Error).message} ---`,
      });
      setStatus('error');
    }
  }

  async function handleCancel() {
    closeStream();
    appendLine({ type: 'system', text: '--- cancelled ---' });
    setStatus('cancelled');

    // Best-effort: the job may already have finished on the server by the
    // time this arrives, which is fine - nothing left to cancel.
    if (jobId) {
      try {
        await cancelGeneration(jobId);
      } catch {
        // Already finished/gone - the UI has already moved on above.
      }
    }
  }

  const mode: 'new' | 'existing' = id ? 'existing' : 'new';
  const canOpenWebsite = Boolean(id) && !loading && status !== 'running';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate font-display text-2xl tracking-tight text-ink">
            {mode === 'existing' ? projectName ?? 'Loading…' : 'New project'}
          </h1>
          <span
            className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
          >
            {status}
          </span>
        </div>

        {id && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <Link
              to={`/projects/${id}/content`}
              className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink shadow-sm transition hover:bg-surface-soft"
            >
              Edit content
            </Link>
            <button
              type="button"
              disabled={!canOpenWebsite}
              onClick={() =>
                window.open(previewUrl(id), '_blank', 'noopener,noreferrer')
              }
              className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink shadow-sm transition hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open website ↗
            </button>
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">
        {error && (
          <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}

        <PromptForm
          mode={mode}
          name={name}
          onNameChange={setName}
          prompt={prompt}
          status={starting ? 'running' : status}
          onPromptChange={setPrompt}
          onGenerate={handleGenerate}
          onCancel={handleCancel}
        />

        <TerminalWindow
          lines={lines}
          emptyText={
            loading
              ? 'Loading project…'
              : 'Output will appear here once generation starts…'
          }
        />
      </div>
    </div>
  );
}
