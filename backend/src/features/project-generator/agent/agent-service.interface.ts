import { Observable } from 'rxjs';
import type { SiteType, TurnAttachment } from '../project.types';

export type AgentOutputEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string };

export interface AgentProcessHandle {
  /** Emits stdout/stderr chunks, then a single 'exit' or 'error', then completes. */
  output$: Observable<AgentOutputEvent>;
  /** Terminates the underlying process/request. Safe to call more than once. */
  kill(): void;
}

export interface AgentRunRequest {
  /** The raw text the user typed - each strategy wraps it with its own
   *  conventions/system prompt (see agent/prompt-template.ts). */
  userPrompt: string;
  cwd: string;
  siteType: SiteType;
  /** Which local/remote model to use - required for providers with more
   *  than one real choice (Ollama); ignored by providers that don't need it. */
  model?: string;
  attachments: TurnAttachment[];
}

/**
 * Strategy Pattern contract: any agent capable of generating/updating a
 * project from a natural-language prompt inside a target directory.
 * ClaudeCliService (shells out to the Claude Code CLI) and SdkAgentService
 * (a tool-use loop against Ollama and, later, other API vendors) are the
 * concrete strategies - see agent/agent-registry.service.ts for how one
 * gets picked per generation.
 */
export interface IAgentService {
  run(request: AgentRunRequest): AgentProcessHandle;
}
