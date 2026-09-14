import { useEffect, useRef } from 'react';

export interface TerminalLine {
  type: 'stdout' | 'stderr' | 'system';
  text: string;
}

const LINE_CLASSES: Record<TerminalLine['type'], string> = {
  stdout: 'text-neutral-200',
  stderr: 'text-red-400',
  system: 'text-neutral-500 italic',
};

export function TerminalWindow({ lines }: { lines: TerminalLine[] }) {
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
      className="h-80 w-full overflow-y-auto rounded-lg bg-neutral-900 p-4 font-mono text-sm shadow-inner"
    >
      {lines.length === 0 ? (
        <p className="text-neutral-500 italic">
          Output will appear here once generation starts…
        </p>
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
