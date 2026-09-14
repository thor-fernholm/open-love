import { useState } from 'react';
import type { AgentOutputEvent, TurnDetail, TurnStatus } from '../lib/projects';
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
  }
  return lines;
}

const STATUS_LABEL: Record<TurnStatus, string> = {
  running: 'Generating…',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_DOT: Record<TurnStatus, string> = {
  running: 'bg-accent-amber',
  completed: 'bg-success',
  failed: 'bg-error',
  cancelled: 'bg-muted',
};

/**
 * One exchange in the project's chat history: the prompt as a user bubble,
 * then the result - a live generating indicator while running, or a
 * compact status line with the raw output tucked behind "Show details"
 * once finished (kept for transparency/debugging, not front-and-center).
 */
export function ChatTurn({ turn }: { turn: TurnDetail }) {
  const [expanded, setExpanded] = useState(false);
  const lines = eventsToLines(turn.events);
  const running = turn.status === 'running';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-w-[85%] flex-col gap-1.5 self-end">
        <div className="rounded-lg bg-primary px-4 py-2 text-sm text-on-primary shadow-sm">
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
          <GeneratingIndicator startedAt={turn.startedAt} />
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[turn.status]}`} />
            <span className="text-muted">{STATUS_LABEL[turn.status]}</span>
            {lines.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="text-xs text-primary hover:underline"
              >
                {expanded ? 'Hide details' : 'Show details'}
              </button>
            )}
          </div>
        )}

        {(running || expanded) && lines.length > 0 && <TerminalWindow lines={lines} />}
      </div>
    </div>
  );
}
