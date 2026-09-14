import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChatTurn } from '../components/ChatTurn';
import { PromptForm, type GenerationStatus } from '../components/PromptForm';
import {
  cancelGeneration,
  getProject,
  previewUrl,
  renameProject,
  startGeneration,
  streamUrl,
  type AgentOutputEvent,
  type TurnDetail,
  type TurnStatus,
} from '../lib/projects';

const STATUS_STYLES: Record<GenerationStatus, string> = {
  idle: 'bg-surface-card text-muted',
  running: 'bg-accent-amber/20 text-body-strong',
  completed: 'bg-success/15 text-success',
  error: 'bg-error/10 text-error',
  cancelled: 'bg-surface-card text-muted',
};

function statusFromTurns(turns: TurnDetail[]): GenerationStatus {
  const last = turns[turns.length - 1];
  if (!last) return 'idle';
  if (last.status === 'failed') return 'error';
  return last.status;
}

interface ProjectPageProps {
  /** Called right after a project is created or renamed, so the sidebar
   *  refetches its list. */
  onProjectsChanged: () => void;
}

/**
 * Renders both the empty "new project" state (no :id) and an existing
 * project's chat history (:id present) - one component so the SSE-
 * streaming logic isn't duplicated between the two. History is one entry
 * per turn (see ChatTurn), not a single flattened transcript.
 */
export function ProjectPage({ onProjectsChanged }: ProjectPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnDetail[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const appendEventToLastTurn = useCallback((event: AgentOutputEvent) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const last = updated[updated.length - 1];
      updated[updated.length - 1] = { ...last, events: [...last.events, event] };
      return updated;
    });
  }, []);

  const setLastTurnStatus = useCallback((status: TurnStatus) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], status };
      return updated;
    });
  }, []);

  const openStream = useCallback(
    (streamJobId: string) => {
      const es = new EventSource(streamUrl(streamJobId));
      eventSourceRef.current = es;

      const onOutput = (type: 'stdout' | 'stderr') => (e: MessageEvent) => {
        const event: AgentOutputEvent = JSON.parse(e.data);
        if (event.type === type) appendEventToLastTurn(event);
      };

      es.addEventListener('stdout', onOutput('stdout'));
      es.addEventListener('stderr', onOutput('stderr'));

      es.addEventListener('exit', (e: MessageEvent) => {
        const event: AgentOutputEvent = JSON.parse(e.data);
        if (event.type !== 'exit') return;
        appendEventToLastTurn(event);
        closeStream();
        setLastTurnStatus(event.code === 0 ? 'completed' : 'failed');
      });

      // Named "error" SSE events (our server's AgentOutputEvent) and
      // EventSource's own connection-level failures both land here under
      // the same event name - a real server event carries `.data`.
      es.addEventListener('error', (e: MessageEvent) => {
        if ('data' in e && e.data) {
          const event: AgentOutputEvent = JSON.parse(e.data);
          if (event.type === 'error') appendEventToLastTurn(event);
        }
        closeStream();
        setLastTurnStatus('failed');
      });
    },
    [appendEventToLastTurn, closeStream, setLastTurnStatus],
  );

  // Close any open stream on unmount.
  useEffect(() => closeStream, [closeStream]);

  // Auto-scroll the history to the bottom as turns/events come in.
  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

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
        setTurns(project.turns);
        if (project.activeJobId) {
          setJobId(project.activeJobId);
          openStream(project.activeJobId);
        } else {
          setJobId(null);
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
    if (!trimmedPrompt || starting || sending) return;

    if (!id) {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      setStarting(true);
      setError(null);
      try {
        const { projectId } = await startGeneration(
          trimmedPrompt,
          { name: trimmedName },
          attachments,
        );
        onProjectsChanged();
        navigate(`/projects/${projectId}`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setStarting(false);
      }
      return;
    }

    setSending(true);
    setError(null);
    try {
      const { jobId: newJobId } = await startGeneration(
        trimmedPrompt,
        { projectId: id },
        attachments,
      );
      setPrompt('');
      setJobId(newJobId);
      setTurns((prev) => [
        ...prev,
        {
          turnId: newJobId,
          prompt: trimmedPrompt,
          startedAt: new Date().toISOString(),
          status: 'running',
          events: [],
          attachments: attachments.map((file) => ({
            name: file.name,
            path: '',
            mimeType: file.type,
          })),
        },
      ]);
      setAttachments([]);
      openStream(newJobId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function startEditingName() {
    if (!projectName) return;
    setNameDraft(projectName);
    setEditingName(true);
  }

  async function commitRename() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!id || !trimmed || trimmed === projectName) return;
    setRenaming(true);
    try {
      const updated = await renameProject(id, trimmed);
      setProjectName(updated.name);
      onProjectsChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRenaming(false);
    }
  }

  async function handleCancel() {
    closeStream();
    setLastTurnStatus('cancelled');

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
  const status: GenerationStatus =
    starting || sending ? 'running' : statusFromTurns(turns);
  const canOpenWebsite = Boolean(id) && !loading && status !== 'running';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          {mode === 'existing' && editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditingName(false);
              }}
              disabled={renaming}
              className="w-full max-w-xs rounded-md border border-hairline bg-canvas px-2 py-0.5 font-display text-2xl tracking-tight text-ink outline-none focus:border-primary"
            />
          ) : (
            <h1
              onClick={mode === 'existing' ? startEditingName : undefined}
              title={mode === 'existing' ? 'Click to rename' : undefined}
              className={`truncate font-display text-2xl tracking-tight text-ink ${
                mode === 'existing' ? 'cursor-pointer hover:opacity-70' : ''
              }`}
            >
              {mode === 'existing' ? projectName ?? 'Loading…' : 'New project'}
            </h1>
          )}
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

      <div
        ref={historyRef}
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6"
      >
        {error && (
          <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-muted">Loading project…</p>
        ) : turns.length === 0 ? (
          <p className="text-sm italic text-muted">
            {mode === 'new'
              ? 'Describe what you want to build below to get started.'
              : 'No history yet.'}
          </p>
        ) : (
          turns.map((turn) => <ChatTurn key={turn.turnId} turn={turn} />)
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl flex-shrink-0 px-4 pb-6">
        <PromptForm
          mode={mode}
          name={name}
          onNameChange={setName}
          prompt={prompt}
          status={status}
          onPromptChange={setPrompt}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onGenerate={handleGenerate}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
