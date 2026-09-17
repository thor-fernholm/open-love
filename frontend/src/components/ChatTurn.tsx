import { useState } from 'react';
import type { AgentOutputEvent, TurnDetail, TurnStatus } from '../lib/projects';
import { CLAUDE_MODELS } from '../lib/settings';
import { GeneratingIndicator } from './GeneratingIndicator';
import { TerminalWindow, type TerminalLine } from './TerminalWindow';

function eventsToLines(events: AgentOutputEvent[]): TerminalLine[] {
  const lines: TerminalLine[] = [];
  for (const event of events) {
    if (event.type === 'stdout') {
      lines.push({ type: 'stdout', text: event.data });
    } else if (event.type === 'stderr') {
      lines.push({ type: 'stderr', text: event.data });
    } else if (event.type === 'exit') {
      lines.push({ type: 'system', text: `--- exited with code ${event.code} ---` });
    } else if (event.type === 'error') {
      lines.push({ type: 'system', text: `--- error: ${event.message} ---` });
    }
    // 'summary' events aren't shown in the raw transcript - they're
    // rendered as the reply bubble itself (see ChatTurn below).
  }
  return lines;
}

const STATUS_LABEL: Record<TurnStatus, string> = {
  running: 'Generating…',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** "Done" implies a build happened - for a turn that only answered a
 *  question or asked one back (changedFiles === false), "Answered" is a
 *  more honest label for what actually happened. */
function statusLabel(turn: TurnDetail): string {
  if (turn.status === 'completed' && turn.changedFiles === false) {
    return 'Answered';
  }
  return STATUS_LABEL[turn.status];
}

const STATUS_DOT: Record<TurnStatus, string> = {
  running: 'bg-accent-amber',
  completed: 'bg-success',
  failed: 'bg-error',
  cancelled: 'bg-muted',
};

/** "Claude Code · Sonnet 5" / "Ollama · gemma4:latest" - matches the
 *  provider/model grouping in ModelSelect, so it's clear which model
 *  actually produced this turn. */
function describeModel(turn: TurnDetail): string {
  if (turn.provider === 'ollama') {
    return turn.model ? `Ollama · ${turn.model}` : 'Ollama';
  }
  if (!turn.model) return 'Claude Code';
  const label = CLAUDE_MODELS.find((m) => m.value === turn.model)?.label ?? turn.model;
  return `Claude Code · ${label}`;
}

interface ChatTurnProps {
  turn: TurnDetail;
  /** Resends this turn's original prompt - only ever rendered for a
   *  'failed' turn (see the button below). */
  onRetry?: () => void;
}

/**
 * One exchange in the project's chat history: the prompt as a user bubble,
 * then the result - a live generating indicator while running, or a
 * compact status line with the raw output tucked behind "Show details"
 * once finished (kept for transparency/debugging, not front-and-center).
 */
export function ChatTurn({ turn, onRetry }: ChatTurnProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = eventsToLines(turn.events);
  const running = turn.status === 'running';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-w-[85%] flex-col gap-1.5 self-end">
        <div className="rounded-lg bg-chat-bubble px-4 py-2 text-sm text-on-primary shadow-sm">
          {turn.prompt}
        </div>
        {turn.attachments && turn.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {turn.attachments.map((attachment) => (
              <span
                key={attachment.name}
                className="max-w-[10rem] truncate rounded-full bg-surface-soft px-2.5 py-1 text-xs text-muted"
                title={attachment.name}
              >
                📎 {attachment.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex max-w-[85%] flex-col gap-2 self-start">
        {running ? (
          <div className="flex items-center gap-2">
            <GeneratingIndicator startedAt={turn.startedAt} />
            {lines.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="text-xs text-primary underline transition hover:opacity-70"
              >
                {expanded ? 'Hide details' : 'Show details'}
              </button>
            )}
          </div>
        ) : (
          <>
            {turn.summary && (
              <div className="rounded-lg bg-surface-card px-4 py-2 text-sm text-body-strong shadow-sm">
                {turn.summary}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[turn.status]}`} />
              <span className="text-muted">{statusLabel(turn)}</span>
              <span className="rounded-full bg-surface-soft px-2 py-0.5 text-xs text-muted">
                {describeModel(turn)}
              </span>
              {lines.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="text-xs text-primary underline transition hover:opacity-70"
                >
                  {expanded ? 'Hide details' : 'Show details'}
                </button>
              )}
              {turn.status === 'failed' && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-xs font-medium text-primary underline transition hover:opacity-70"
                >
                  Retry
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {expanded && lines.length > 0 && <TerminalWindow lines={lines} />}
    </div>
  );
}
