import { AgentOutputEvent } from './agent/agent-service.interface';

export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

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
