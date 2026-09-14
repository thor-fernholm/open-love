import { useEffect, useRef, useState } from 'react';
import { PromptForm, type GenerationStatus } from './components/PromptForm';
import { TerminalWindow, type TerminalLine } from './components/TerminalWindow';
import {
  cancelGeneration,
  startGeneration,
  streamUrl,
  type AgentOutputEvent,
} from './lib/projectGenerator';

const STATUS_STYLES: Record<GenerationStatus, string> = {
  idle: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
  running: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  error: 'bg-red-100 text-red-800',
  cancelled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
};

function App() {
  const [prompt, setPrompt] = useState('');
  const [projectName, setProjectName] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  function appendLine(line: TerminalLine) {
    setLines((prev) => [...prev, line]);
  }

  function closeStream() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    const name = projectName ?? crypto.randomUUID();
    if (!projectName) setProjectName(name);

    appendLine({ type: 'system', text: `> ${trimmed}` });
    setPrompt('');
    setStatus('running');

    try {
      const { jobId: newJobId } = await startGeneration(trimmed, name);
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

  function openStream(jobId: string) {
    const es = new EventSource(streamUrl(jobId));
    eventSourceRef.current = es;

    const onOutput = (type: 'stdout' | 'stderr') => (e: MessageEvent) => {
      const event: AgentOutputEvent = JSON.parse(e.data);
      if (event.type === type) {
        appendLine({ type, text: event.data });
      }
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

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10 dark:bg-neutral-950">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
            OpenLove Project Generator
          </h1>
          <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
            >
              {status}
            </span>
            {projectName && <span>Project: {projectName}</span>}
          </div>
        </header>

        <PromptForm
          prompt={prompt}
          status={status}
          onPromptChange={setPrompt}
          onGenerate={handleGenerate}
          onCancel={handleCancel}
        />

        <TerminalWindow lines={lines} />
      </div>
    </div>
  );
}

export default App;
