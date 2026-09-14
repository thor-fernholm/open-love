import { useEffect, useState } from 'react';

// The same braille-spinner frames Claude Code's own CLI cycles through.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 90;

const VERBS = [
  'Thinking',
  'Building',
  'Assembling',
  'Crafting',
  'Wiring things up',
  'Polishing',
];
const VERB_INTERVAL_MS = 2200;

function elapsedLabel(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  return `${seconds}s`;
}

/** A Claude-Code-CLI-flavored "working on it" indicator: a cycling braille
 *  spinner, a rotating one-word verb, and a ticking elapsed-time counter. */
export function GeneratingIndicator({ startedAt }: { startedAt: string }) {
  const [frame, setFrame] = useState(0);
  const [verbIndex, setVerbIndex] = useState(0);
  const [elapsed, setElapsed] = useState(() => elapsedLabel(startedAt));

  useEffect(() => {
    const spinnerId = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    const verbId = setInterval(
      () => setVerbIndex((v) => (v + 1) % VERBS.length),
      VERB_INTERVAL_MS,
    );
    const elapsedId = setInterval(() => setElapsed(elapsedLabel(startedAt)), 1000);
    return () => {
      clearInterval(spinnerId);
      clearInterval(verbId);
      clearInterval(elapsedId);
    };
  }, [startedAt]);

  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className="font-mono text-primary">{SPINNER_FRAMES[frame]}</span>
      <span>{VERBS[verbIndex]}…</span>
      <span className="text-muted-soft">({elapsed})</span>
    </div>
  );
}
