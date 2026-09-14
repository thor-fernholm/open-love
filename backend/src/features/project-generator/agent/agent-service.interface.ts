import { Observable } from 'rxjs';

/**
 * DI token for the active IAgentService strategy (see ClaudeCliService).
 * TypeScript interfaces don't exist at runtime, so Nest needs a token to bind to.
 */
export const AGENT_SERVICE = Symbol('AGENT_SERVICE');

export type AgentOutputEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string };

export interface AgentProcessHandle {
  /** Emits stdout/stderr chunks, then a single 'exit' or 'error', then completes. */
  output$: Observable<AgentOutputEvent>;
  /** Terminates the underlying process. Safe to call more than once. */
  kill(): void;
}

/**
 * Strategy Pattern contract: any coding-agent CLI capable of generating a
 * project from a natural-language prompt inside a target directory.
 * ClaudeCliService is the concrete strategy today; a different agent CLI
 * could be swapped in later purely via the AGENT_SERVICE provider binding.
 */
export interface IAgentService {
  run(prompt: string, cwd: string): AgentProcessHandle;
}
