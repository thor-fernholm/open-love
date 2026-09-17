import { Injectable } from '@nestjs/common';
import {
  hasToolCall,
  NoSuchToolError,
  stepCountIs,
  ToolChoiceViolationError,
  ToolLoopAgent,
  type StepResult,
  type ToolSet,
} from 'ai';
import { ollama } from 'ai-sdk-ollama';
import { Subject } from 'rxjs';
import { buildConventions, FINAL_REMINDER } from './prompt-template';
import { createAgentTools } from './tools';
import type {
  AgentOutputEvent,
  AgentProcessHandle,
  AgentRunRequest,
  IAgentService,
} from './agent-service.interface';

const MAX_STEPS = 30;
// Live testing (gemma3:4b) showed occasional steps where the model replies
// with prose only, no tool call - the AI SDK enforces `toolChoice: 'required'`
// by throwing ToolChoiceViolationError rather than retrying it (it retries
// most other errors automatically, but explicitly excludes this one), so a
// single bad step would otherwise fail the whole generation. Retrying the
// call from scratch is cheap here: tools are idempotent (list_files/read_file
// are read-only, write_file just overwrites), and the prompt already tells
// the model to check existing files first, so a restart picks up right where
// the last attempt's writes left off.
const MAX_TOOL_CHOICE_ATTEMPTS = 3;
// Local inference is slower and far more hardware-variable than a hosted
// API - a generous per-step and total budget here avoids the underlying
// fetch timing out (and surfacing as an opaque "fetch failed") on a slow
// machine mid-generation, while still failing eventually if something is
// genuinely stuck.
const STEP_TIMEOUT_MS = 5 * 60 * 1000;
const TOTAL_TIMEOUT_MS = 20 * 60 * 1000;

const TOOL_USE_INSTRUCTIONS = `You have tools to build the site directly in this directory: list_files, read_file, write_file, and done.

This directory may already contain files from earlier work - call list_files (and read_file anything relevant) before you start, so you build on what's there instead of guessing or redoing it from scratch. If the request actually calls for a change, write every file it needs with write_file - one call per file, with that file's complete contents - then call done with a short summary of what you built. If it doesn't (a question, feedback, or a clarifying question of your own per the Conversation rule above) - skip straight to done with zero write_file calls, and put your actual answer in done's summary; that's what the user sees. You must call one of these tools every step, including this one - never respond with only text.`;

/**
 * A real tool-use loop (ToolLoopAgent from the Vercel AI SDK) instead of a
 * CLI process - the strategy every non-Claude provider plugs into. Ollama
 * is the only one wired up today; adding OpenAI/Gemini later means adding
 * a case in resolveModel(), not a new loop.
 */
@Injectable()
export class SdkAgentService implements IAgentService {
  run(request: AgentRunRequest): AgentProcessHandle {
    const output$ = new Subject<AgentOutputEvent>();
    const abortController = new AbortController();

    if (!request.model) {
      // Deferred so callers can subscribe before anything is emitted -
      // mirrors how a real spawn's first event is always async too.
      queueMicrotask(() => {
        output$.next({
          type: 'error',
          message: 'No model selected for this provider.',
        });
        output$.complete();
      });
      return { output$: output$.asObservable(), kill: () => abortController.abort() };
    }

    const tools = createAgentTools(request.cwd);
    const toolNames = Object.keys(tools);
    const instructions = `${buildConventions(request.attachments, request.siteType, request.history, request.designFile)}\n\n${TOOL_USE_INSTRUCTIONS}\n\n${FINAL_REMINDER}`;

    const agent = new ToolLoopAgent({
      // A lower temperature than Ollama's default (0.8) makes tool-calling
      // more consistent - live testing showed the default drifting into
      // plain prose (no tool call) more often than a small, focused
      // file-editing task like this one calls for.
      model: ollama(request.model, { options: { temperature: 0.2 } }),
      instructions,
      tools,
      // A model that guesses a plausible-but-wrong tool name (seen live:
      // "list_files" was right, but "listDir"/"listDirectory" weren't)
      // shouldn't just fail and burn a step - remap it when the intent is
      // unambiguous instead of retrying blind.
      repairToolCall: async ({ toolCall, error }) => {
        if (!(error instanceof NoSuchToolError)) return null;
        const repaired = guessRealToolName(toolCall.toolName, toolNames);
        return repaired ? { ...toolCall, toolName: repaired } : null;
      },
      // Forces every step to call a tool, including `done` for the final
      // one - without this, a model can end the loop early just by
      // replying with plain text instead of acting (observed live: it
      // silently "finished" with nothing written and no error).
      toolChoice: 'required',
      stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('done')],
      onStepFinish: (step: StepResult<ToolSet>) => {
        for (const call of step.toolCalls) {
          output$.next({ type: 'stdout', data: describeToolCall(call) });
          // done's `summary` argument is the model's own short reply (see
          // TOOL_USE_INSTRUCTIONS) - surface it as the chat reply
          // (ChatTurn.tsx's default view), not just a line buried in the
          // raw "Show details" transcript alongside describeToolCall above.
          if (call.toolName === 'done') {
            const summary = String((call.input as { summary?: unknown } | undefined)?.summary ?? '').trim();
            if (summary) {
              output$.next({ type: 'summary', text: summary });
            }
          }
        }
        // toolChoice: 'required' should prevent this, but surface it
        // visibly rather than silently if a model manages to reply with
        // text anyway - better a confusing line than a clean-looking
        // "exit code 0" that quietly wrote nothing.
        if (step.text.trim()) {
          output$.next({ type: 'stdout', data: `${step.text.trim()}\n` });
        }
      },
    });

    generateWithRetries(agent, request, abortController, output$)
      .then(() => {
        output$.next({ type: 'exit', code: 0 });
        output$.complete();
      })
      .catch((err: unknown) => {
        if (abortController.signal.aborted) {
          output$.next({ type: 'exit', code: null });
        } else {
          output$.next({ type: 'error', message: describeError(err) });
        }
        output$.complete();
      });

    return {
      output$: output$.asObservable(),
      kill: () => abortController.abort(),
    };
  }
}

/** Runs the agent, retrying from scratch (same prompt, fresh conversation)
 *  when a step comes back with no tool call at all - see MAX_TOOL_CHOICE_ATTEMPTS
 *  above for why the SDK itself won't retry this one. Every other error
 *  (a real Ollama connection problem, hitting MAX_STEPS, etc.) still fails
 *  immediately, unretried. */
async function generateWithRetries<TOOLS extends ToolSet>(
  agent: ToolLoopAgent<never, TOOLS>,
  request: AgentRunRequest,
  abortController: AbortController,
  output$: Subject<AgentOutputEvent>,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_TOOL_CHOICE_ATTEMPTS; attempt++) {
    try {
      await agent.generate({
        prompt: request.userPrompt,
        abortSignal: abortController.signal,
        timeout: { stepMs: STEP_TIMEOUT_MS, totalMs: TOTAL_TIMEOUT_MS },
      });
      return;
    } catch (err) {
      const isLastAttempt = attempt >= MAX_TOOL_CHOICE_ATTEMPTS;
      if (
        !ToolChoiceViolationError.isInstance(err) ||
        isLastAttempt ||
        abortController.signal.aborted
      ) {
        throw err;
      }
      output$.next({
        type: 'stdout',
        data: `Model replied without using a tool - retrying (attempt ${attempt + 1}/${MAX_TOOL_CHOICE_ATTEMPTS})...\n`,
      });
    }
  }
}

/** Best-effort remap of a hallucinated/misspelled tool name to a real one,
 *  when the intent is unambiguous - see repairToolCall above. */
function guessRealToolName(guessed: string, realNames: string[]): string | null {
  if (realNames.includes(guessed)) return guessed;
  const lower = guessed.toLowerCase();
  if (/list|dir/.test(lower)) return realNames.find((n) => n.startsWith('list')) ?? null;
  if (/read|get|view|open/.test(lower)) return realNames.find((n) => n.startsWith('read')) ?? null;
  if (/write|create|save/.test(lower)) return realNames.find((n) => n.startsWith('write')) ?? null;
  if (/done|finish|complete/.test(lower)) return realNames.find((n) => n === 'done') ?? null;
  return null;
}

/** Node's fetch (undici) errors are often an opaque "fetch failed" with
 *  the actually-useful detail (ECONNREFUSED, timeout, etc.) nested in
 *  `.cause` - surface that instead of the generic wrapper message when
 *  it's there, since that's what actually explains an Ollama connection
 *  problem to whoever's looking at the chat's error line. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let cause = (err as Error & { cause?: unknown }).cause;
  // undici errors can nest several layers deep (e.g. a generic "fetch
  // failed" wrapping another "fetch failed" wrapping the actually useful
  // ECONNRESET/timeout code) - walk the whole chain instead of just one level.
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    parts.push(cause.message);
    cause = (cause as Error & { cause?: unknown }).cause;
  }
  return parts.join(': ');
}

/** Turns one tool call into a human-readable progress line, so the chat
 *  shows real actions (not a raw token stream) while a local model works -
 *  each line corresponds to something that actually just happened on disk. */
function describeToolCall(call: { toolName: string; input?: unknown }): string {
  const input = (call.input ?? {}) as Record<string, unknown>;
  switch (call.toolName) {
    case 'write_file':
      return `Writing ${String(input.path ?? '')}\n`;
    case 'read_file':
      return `Reading ${String(input.path ?? '')}\n`;
    case 'list_files':
      return 'Checking existing files...\n';
    case 'done':
      return `Done: ${String(input.summary ?? '')}\n`;
    default:
      return `${call.toolName}\n`;
  }
}
