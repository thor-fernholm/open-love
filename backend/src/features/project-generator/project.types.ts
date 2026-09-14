import { AgentOutputEvent } from './agent/agent-service.interface';

export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Which agent strategy builds a turn. 'claude' shells out to the Claude
 *  Code CLI; 'ollama' runs a local tool-use loop against Ollama - see
 *  agent/agent-registry.service.ts. More providers (openai, gemini, ...)
 *  plug in the same way later. */
export type AgentProvider = 'claude' | 'ollama';

export interface AgentSelection {
  provider: AgentProvider;
  /** Which local model for 'ollama' (required in practice - nothing runs
   *  without one); which tier alias ('opus' | 'sonnet' | 'haiku') for
   *  'claude' - see ClaudeCliService.DEFAULT_CLAUDE_MODEL for the fallback
   *  when unset. */
  model?: string;
}

/** A reference file the user attached to a prompt, saved under that turn's
 *  own folder so the agent can read it - see ProjectGeneratorService.start. */
export interface TurnAttachment {
  name: string;
  /** Relative to the project root, e.g. ".openlove/attachments/<turnId>/logo.png". */
  path: string;
  mimeType: string;
}

/**
 * One prompt submitted against a project ("turn"). `turnId` is the job id
 * that ran it. Kept separate from the raw event log (see TurnDetail) so a
 * future chat-history UI can list turns (prompt + status) cheaply without
 * reading every byte of output ever produced.
 */
export interface TurnRecord {
  turnId: string;
  prompt: string;
  startedAt: string;
  status: TurnStatus;
  finishedAt?: string;
  attachments?: TurnAttachment[];
  provider: AgentProvider;
  model?: string;
}

/** A turn plus its replayed raw output - what today's terminal view renders. */
export interface TurnDetail extends TurnRecord {
  events: AgentOutputEvent[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
}

export type ProjectSummary = ProjectMeta;

export interface ProjectDetail extends ProjectMeta {
  turns: TurnDetail[];
  /** The job id currently streaming into this project, if any. */
  activeJobId: string | null;
}
