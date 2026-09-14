import { useEffect, useRef } from 'react';

export interface TerminalLine {
  type: 'stdout' | 'stderr' | 'system';
  text: string;
}

const LINE_CLASSES: Record<TerminalLine['type'], string> = {
  stdout: 'text-on-dark',
  stderr: 'text-error',
  system: 'text-on-dark-soft italic',
};

export function TerminalWindow({
  lines,
  emptyText = 'Output will appear here once generation starts…',
}: {
  lines: TerminalLine[];
  emptyText?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      ref={scrollRef}
      className="h-96 w-full overflow-y-auto rounded-lg bg-surface-dark p-4 font-mono text-sm shadow-inner ring-1 ring-surface-dark-elevated"
    >
      {lines.length === 0 ? (
        <p className="text-on-dark-soft italic">{emptyText}</p>
      ) : (
        lines.map((line, i) => (
          <pre
            key={i}
            className={`whitespace-pre-wrap break-words ${LINE_CLASSES[line.type]}`}
          >
            {line.text}
          </pre>
        ))
      )}
    </div>
  );
}
