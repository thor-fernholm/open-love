import { Observable } from 'rxjs';
import type { SiteType, TurnAttachment } from '../project.types';

export type AgentOutputEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string }
  /** The agent's short final reply - see TurnRecord.summary. Emitted once,
   *  shortly before 'exit', on a successful run. */
  | { type: 'summary'; text: string };

export interface AgentProcessHandle {
  /** Emits stdout/stderr chunks, then a single 'exit' or 'error', then completes. */
  output$: Observable<AgentOutputEvent>;
  /** Terminates the underlying process/request. Safe to call more than once. */
  kill(): void;
}

/** One earlier turn, reduced to just what's worth feeding back to the
 *  agent as conversation memory - see agent/prompt-template.ts's
 *  buildHistorySection. */
export interface HistoryTurn {
  prompt: string;
  summary?: string;
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
  /** Prior turns on this project, oldest first - lets the agent see the
   *  actual conversation (its own past replies included), not just
   *  whatever it can infer from the files on disk. See buildHistorySection
   *  for how this gets compacted once it's large. */
  history: HistoryTurn[];
  /** Which designs/*.md file this project uses - picked once per project
   *  (see design-guide.ts's pickDesignForPrompt) and passed through here
   *  rather than re-resolved per strategy, so every turn on a project stays
   *  visually consistent. Null for a project with no design file resolved
   *  (predates this feature and hasn't self-healed one yet, or designs/ is
   *  empty). */
  designFile: string | null;
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
