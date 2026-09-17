import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatTurn } from '../components/ChatTurn';
import { ExportModal } from '../components/ExportModal';
import { PromptForm, type GenerationStatus } from '../components/PromptForm';
import { getContent } from '../lib/content';
import {
  cancelGeneration,
  exportUrl,
  getPreviewStatus,
  getProject,
  previewUrl,
  renameProject,
  startGeneration,
  streamUrl,
  type AgentOutputEvent,
  type PreviewState,
  type SiteType,
  type TurnDetail,
  type TurnStatus,
} from '../lib/projects';
import { getSettings, type AgentSelection } from '../lib/settings';

const STATUS_STYLES: Record<GenerationStatus, string> = {
  idle: 'bg-surface-card text-muted',
  running: 'bg-accent-amber/20 text-body-strong',
  completed: 'bg-success/15 text-success',
  error: 'bg-error/10 text-error',
  cancelled: 'bg-surface-card text-muted',
};

const PREVIEW_STATUS_LABEL: Record<PreviewState['status'], string> = {
  idle: '',
  installing: 'Installing…',
  generating: 'Preparing DB…',
  building: 'Building…',
  starting: 'Starting…',
  ready: 'Ready',
  failed: 'Preview failed',
};

const DEPLOY_PENDING_STATUSES = new Set<PreviewState['status']>([
  'installing',
  'generating',
  'building',
  'starting',
]);

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// How close to the bottom (in px of remaining scroll) still counts as
// "following along" for the auto-scroll effect below.
const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** A compact version of GeneratingIndicator's braille spinner - just the
 *  glyph, no verb/elapsed-time, for a small inline status badge rather than
 *  a full "working on it" line. */
function useSpinnerFrame(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 90);
    return () => clearInterval(id);
  }, [active]);
  return SPINNER_FRAMES[frame];
}

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
  const [selection, setSelection] = useState<AgentSelection>({ provider: 'claude' });
  // Only meaningful in "new" mode - once a project exists its site type is
  // fixed (read back from getProject() below instead).
  const [siteType, setSiteType] = useState<SiteType>('static');
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'idle' });
  const [jobId, setJobId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnDetail[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  // null = not yet known - treated as not-ready, same as `loading`.
  const [hasContent, setHasContent] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  // Prompts submitted while a turn is already running - sent automatically,
  // one at a time, as each prior turn finishes (see drainQueueIfAny below).
  // Purely client-side/ephemeral, like jobs/preview tracking on the
  // backend - not worth persisting across a reload.
  const [queue, setQueue] = useState<{ prompt: string; attachments: File[] }[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  // Whether the user is currently scrolled near the bottom of the chat -
  // read by the auto-scroll effect below so a new message only yanks the
  // view down when they were already following along, not when they've
  // scrolled up to read earlier history. Starts true (a fresh page load is
  // "at the bottom" until proven otherwise).
  const isNearBottomRef = useRef(true);

  // Derived early (rather than down by the JSX, where it used to live) so
  // sendPrompt/handleGenerate/the drain logic below can all read it
  // directly instead of re-deriving "is something running" themselves.
  const status: GenerationStatus = starting || sending ? 'running' : statusFromTurns(turns);

  // Mirrors `queue` for synchronous reads from inside openStream's SSE
  // handlers below (a plain ref write during render, not a state update -
  // the standard "latest ref" pattern; avoids the handlers closing over a
  // stale `queue` from whenever openStream was originally called, and
  // avoids calling setState from inside a React effect body).
  const queueRef = useRef<{ prompt: string; attachments: File[] }[]>([]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  // Same idea for sendPrompt (defined further down, but openStream needs to
  // call the latest version of it) - breaks what would otherwise be a
  // circular useCallback dependency between openStream and sendPrompt.
  const sendPromptRef = useRef<(promptText: string, files: File[]) => void>(() => {});

  // Called once the just-finished turn's status has already been set -
  // sends the next queued prompt, if any, the same way a direct Send
  // would. A plain callback invoked from a real event (the SSE stream
  // closing), not a React effect, so this can freely call setState.
  const drainQueueIfAny = useCallback(() => {
    const current = queueRef.current;
    if (current.length === 0) return;
    const [next, ...rest] = current;
    queueRef.current = rest;
    setQueue(rest);
    sendPromptRef.current(next.prompt, next.attachments);
  }, []);

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

  const setLastTurnSummary = useCallback((summary: string) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], summary };
      return updated;
    });
  }, []);

  // Re-checks whether the project now has editable content - called after a
  // turn finishes (see openStream's 'exit' handler below), since a build
  // can create content/manifest.json for the first time and the "Edit
  // content" button should appear right then, not only after a reload.
  const refreshHasContent = useCallback(() => {
    if (!id) return;
    getContent(id)
      .then((content) => setHasContent(content.collections.length > 0))
      .catch(() => {
        // Leave whatever was last known - a transient fetch failure
        // shouldn't flip the button off.
      });
  }, [id]);

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

      es.addEventListener('summary', (e: MessageEvent) => {
        const event: AgentOutputEvent = JSON.parse(e.data);
        if (event.type === 'summary') setLastTurnSummary(event.text);
      });

      es.addEventListener('exit', (e: MessageEvent) => {
        const event: AgentOutputEvent = JSON.parse(e.data);
        if (event.type !== 'exit') return;
        appendEventToLastTurn(event);
        closeStream();
        setLastTurnStatus(event.code === 0 ? 'completed' : 'failed');
        // Only a successful build could have changed whether content/
        // manifest.json exists - skip the extra fetch on a failed turn.
        if (event.code === 0) refreshHasContent();
        drainQueueIfAny();
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
        drainQueueIfAny();
      });
    },
    [
      appendEventToLastTurn,
      closeStream,
      setLastTurnStatus,
      setLastTurnSummary,
      refreshHasContent,
      drainQueueIfAny,
    ],
  );

  // Close any open stream on unmount.
  useEffect(() => closeStream, [closeStream]);

  // Auto-scroll the history to the bottom as turns/events come in - but
  // only when the user was already near the bottom (see isNearBottomRef),
  // so scrolling up to read earlier messages doesn't get yanked back down
  // by a new chunk of output arriving.
  useEffect(() => {
    const el = historyRef.current;
    if (el && isNearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const handleHistoryScroll = useCallback(() => {
    const el = historyRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  }, []);

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
        setSiteType(project.siteType ?? 'static');
        setTurns(project.turns);
        const lastTurn = project.turns[project.turns.length - 1];
        if (lastTurn) {
          setSelection({ provider: lastTurn.provider, model: lastTurn.model });
        } else {
          getSettings()
            .then((s) => {
              if (!cancelled) setSelection(s);
            })
            .catch(() => {
              // Keep the Claude Code fallback already in state.
            });
        }
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

  // Cheap check for whether "Edit content" actually leads anywhere - a
  // static project (no content/manifest.json) has nothing to edit, and
  // getContent() never 404s for that case (it returns an empty collection
  // list instead), so this can't be inferred from getProject() above.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getContent(id)
      .then((content) => {
        if (!cancelled) setHasContent(content.collections.length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasContent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Polls the live preview's status for a 'dynamic' project - continuously
  // (not just until first 'ready') since a follow-up turn restarts the
  // preview process, cycling status back through installing/building/etc.
  // Cheap enough as a plain interval for a single-user local tool.
  useEffect(() => {
    if (!id || siteType !== 'dynamic') return;
    let cancelled = false;
    const poll = () => {
      getPreviewStatus(id)
        .then((state) => {
          if (!cancelled) setPreviewState(state);
        })
        .catch(() => {
          // Transient - keep whatever state was last known, try again next tick.
        });
    };
    poll();
    const intervalId = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [id, siteType]);

  // A brand-new project has no turn history to inherit a selection from -
  // start from the persisted global default instead.
  useEffect(() => {
    if (id) return;
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setSelection(s);
      })
      .catch(() => {
        // Keep the Claude Code fallback already in state.
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Actually sends a follow-up prompt into the current (existing) project -
  // shared by a direct Send and by drainQueueIfAny above, so a
  // queued-then-dequeued prompt goes through exactly the same path a
  // typed-and-sent-immediately one does.
  const sendPrompt = useCallback(
    async (promptText: string, files: File[]) => {
      if (!id) return;
      setSending(true);
      setError(null);
      try {
        const { jobId: newJobId } = await startGeneration(
          promptText,
          { projectId: id },
          files,
          selection,
        );
        setJobId(newJobId);
        setTurns((prev) => [
          ...prev,
          {
            turnId: newJobId,
            prompt: promptText,
            startedAt: new Date().toISOString(),
            status: 'running',
            events: [],
            attachments: files.map((file) => ({
              name: file.name,
              path: '',
              mimeType: file.type,
            })),
            provider: selection.provider,
            model: selection.model,
          },
        ]);
        openStream(newJobId);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSending(false);
      }
    },
    [id, selection, openStream],
  );
  // Keep the ref used by drainQueueIfAny pointed at the latest sendPrompt
  // (written from an effect, not during render - see queueRef above).
  useEffect(() => {
    sendPromptRef.current = (promptText, files) => {
      void sendPrompt(promptText, files);
    };
  }, [sendPrompt]);

  async function handleGenerate() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    if (!id) {
      if (starting) return;
      const trimmedName = name.trim();
      if (!trimmedName) return;
      setStarting(true);
      setError(null);
      try {
        const { projectId } = await startGeneration(
          trimmedPrompt,
          { name: trimmedName, siteType },
          attachments,
          selection,
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

    const files = attachments;
    setPrompt('');
    setAttachments([]);
    submitPrompt(trimmedPrompt, files);
  }

  // Routes a prompt to either an immediate send or the queue, depending on
  // whether something's already running - shared by a direct Send
  // (handleGenerate) and by "Retry" on a failed turn (handleRetry) below,
  // so both behave identically once there's text to submit.
  function submitPrompt(promptText: string, files: File[]) {
    if (status === 'running') {
      setQueue((prev) => [...prev, { prompt: promptText, attachments: files }]);
      return;
    }
    void sendPrompt(promptText, files);
  }

  // Resends a failed turn's original prompt - not its attachments, which
  // aren't held onto client-side once a turn has been submitted (they're
  // already saved server-side under that original turn's own folder, not
  // reusable for a new one).
  function handleRetry(turn: TurnDetail) {
    submitPrompt(turn.prompt, []);
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
    // Cancelling is a signal to stop, not "skip ahead" - drop anything
    // queued rather than auto-continuing into it.
    setQueue([]);

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
  const loaded = Boolean(id) && !loading;
  const turnRunning = status === 'running';

  // A static site has nothing to wait on once its turn finishes - it's
  // viewable immediately. A dynamic app additionally needs its own live
  // process to finish installing/building/starting (see
  // dynamic-preview.service.ts), tracked separately in previewState.
  const isReady =
    siteType === 'dynamic' ? previewState.status === 'ready' : loaded && !turnRunning;
  const isDeploying =
    loaded &&
    (turnRunning || (siteType === 'dynamic' && DEPLOY_PENDING_STATUSES.has(previewState.status)));
  const deployFailed = loaded && !turnRunning && siteType === 'dynamic' && previewState.status === 'failed';
  const deployLabel = turnRunning ? 'Generating…' : PREVIEW_STATUS_LABEL[previewState.status];
  const spinnerFrame = useSpinnerFrame(isDeploying);

  const canEditContent = isReady && hasContent === true;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline px-4 py-4 sm:px-6">
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
              className="w-full max-w-xs rounded-sm border border-hairline bg-canvas px-2 py-0.5 font-display text-2xl tracking-tight text-ink outline-none focus:border-primary focus:ring-2 focus:ring-ring/50"
            />
          ) : (
            <h1
              onClick={mode === 'existing' ? startEditingName : undefined}
              title={mode === 'existing' ? 'Click to rename' : undefined}
              className={`flex min-w-0 items-center gap-1.5 font-display text-2xl tracking-tight text-ink ${
                mode === 'existing' ? 'cursor-pointer hover:opacity-70' : ''
              }`}
            >
              <span className="truncate">
                {mode === 'existing' ? projectName ?? 'Loading…' : 'New project'}
              </span>
              {mode === 'existing' && (
                <PencilIcon className="h-4 w-4 flex-shrink-0 text-muted" />
              )}
            </h1>
          )}
          <span
            className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
          >
            {status}
          </span>
        </div>

        {id && (
          <div className="flex flex-wrap items-center gap-2">
            {isDeploying && (
              <span className="flex items-center gap-2 rounded-full bg-accent-amber/20 px-3 py-1 text-sm font-medium text-body-strong">
                <span className="font-mono text-primary">{spinnerFrame}</span>
                {deployLabel}
              </span>
            )}
            {deployFailed && (
              <span
                title={previewState.message}
                className="rounded-full bg-error/10 px-3 py-1 text-sm font-medium text-error"
              >
                {PREVIEW_STATUS_LABEL.failed}
              </span>
            )}
            {isReady && (
              <>
                <span className="rounded-full bg-success/15 px-3 py-1 text-sm font-medium text-success">
                  Ready
                </span>
                {canEditContent && (
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${id}/content`)}
                    className="rounded-sm border border-hairline-strong px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink/5"
                  >
                    Edit content
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    window.open(previewUrl(id), '_blank', 'noopener,noreferrer')
                  }
                  className="rounded-sm border border-primary px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/10"
                >
                  Open preview ↗
                </button>
                <button
                  type="button"
                  onClick={() => setExportModalOpen(true)}
                  className="rounded-sm border border-accent-warm px-4 py-2 text-sm font-medium text-accent-warm transition hover:bg-accent-warm/10"
                >
                  Export website ⬇
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* overflow-y-auto lives on this full-width outer div, not the
          centered column below it, so the scrollbar sits at the pane's
          true right edge instead of floating at the narrower column's
          edge in the middle of the screen. */}
      <div ref={historyRef} onScroll={handleHistoryScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
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
            turns.map((turn) => (
              <ChatTurn key={turn.turnId} turn={turn} onRetry={() => handleRetry(turn)} />
            ))
          )}
          {queue.map((queued, i) => (
            <div key={i} className="flex max-w-[85%] flex-col items-end gap-1 self-end">
              <div className="rounded-lg bg-chat-bubble/50 px-4 py-2 text-sm text-on-primary shadow-sm">
                {queued.prompt}
              </div>
              <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px] text-muted">
                Queued
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-shrink-0 px-4 pb-4 sm:pb-6">
        <PromptForm
          mode={mode}
          name={name}
          onNameChange={setName}
          prompt={prompt}
          status={status}
          onPromptChange={setPrompt}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          selection={selection}
          onSelectionChange={setSelection}
          siteType={siteType}
          onSiteTypeChange={setSiteType}
          onGenerate={handleGenerate}
          onCancel={handleCancel}
        />
      </div>

      {id && (
        <ExportModal
          open={exportModalOpen}
          siteType={siteType}
          onClose={() => setExportModalOpen(false)}
          onConfirm={() => {
            window.open(exportUrl(id), '_blank');
            setExportModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Signals the project title next to it is click-to-rename - shown only
 *  once there's an actual saved project to rename (see the `mode ===
 *  'existing'` guard above). */
function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
    >
      <path
        d="M4.5 15.5 5 12.5l7-7 2.5 2.5-7 7-3 .5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.5 7 13 9.5" strokeLinecap="round" />
    </svg>
  );
}
