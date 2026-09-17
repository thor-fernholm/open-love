import { Injectable } from '@nestjs/common';
import { spawnSync } from 'child_process';
import spawn from 'cross-spawn';
import { Subject } from 'rxjs';
import { buildClaudePrompt } from './prompt-template';
import type {
  AgentOutputEvent,
  AgentProcessHandle,
  AgentRunRequest,
  IAgentService,
} from './agent-service.interface';

// The CLI's own tier aliases - it resolves each to whatever its current
// snapshot for that tier is, so this doesn't need updating as models age
// out (unlike pinning a dated snapshot id directly).
export const DEFAULT_CLAUDE_MODEL = 'haiku';

/**
 * Concrete Strategy: generates a project by shelling out to the `claude`
 * CLI in non-interactive mode, auto-accepting file edits. The CLI is
 * already its own polished coding agent, so this strategy just wraps the
 * shared conventions around the user's prompt (buildClaudePrompt) rather
 * than driving a tool-use loop itself - see SdkAgentService for the
 * strategy that does.
 */
@Injectable()
export class ClaudeCliService implements IAgentService {
  run(request: AgentRunRequest): AgentProcessHandle {
    const output$ = new Subject<AgentOutputEvent>();
    const prompt = buildClaudePrompt(
      request.userPrompt,
      request.attachments,
      request.siteType,
      request.history,
    );
    // `claude -p` with no --output-format flag (the default) prints only
    // the final assistant text to stdout - no tool-call log, no JSON
    // envelope (confirmed live: even a run that edits files produces
    // exactly one clean sentence on stdout). So the accumulated stdout
    // *is* the agent's short reply - see the 'summary' event on a clean
    // exit below, which is what ChatTurn.tsx shows by default instead of
    // the raw "Show details" transcript.
    let stdout = '';

    // cross-spawn resolves npm-installed `.cmd`/`.bat` shims on Windows
    // (which Node's own child_process.spawn can't launch without a shell)
    // while still passing each argument through as a discrete, correctly
    // escaped token - unlike `spawn(..., { shell: true })`, which merely
    // concatenates args into a shell command line and lets a prompt
    // containing shell metacharacters break out or get mis-split.
    const child = spawn(
      'claude',
      [
        '-p',
        prompt,
        // 'acceptEdits' auto-accepts file writes but NOT Bash tool calls -
        // in non-interactive mode (-p, no TTY) there's no way to approve
        // one, so the CLI just gives up ("I'll pause here rather than
        // keep retrying...") the moment it wants to run a shell command,
        // e.g. `npm install`/`prisma generate` to sanity-check its own
        // work on a dynamic project. This app already lets the agent
        // freely read/write any file in the project folder - extending
        // that same trust to shell commands is consistent with the
        // existing model, not a new category of risk, and dynamic
        // projects need it far more than static ones ever did.
        '--permission-mode',
        'bypassPermissions',
        '--model',
        request.model ?? DEFAULT_CLAUDE_MODEL,
      ],
      { cwd: request.cwd },
    );
    // Immediately signal EOF on stdin (rather than leaving it open-but-idle,
    // which makes the CLI stall for a few seconds probing for piped input,
    // or fully detaching it via stdio:'ignore', which made it exit as a
    // no-op with no output at all) - generation is driven entirely by the
    // `-p` prompt argument, so there is nothing to pipe in.
    child.stdin!.end();

    // stdout/stderr are only null when stdio is overridden away from the
    // 'pipe' default, which we never do here.
    child.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      output$.next({ type: 'stdout', data: text });
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      output$.next({ type: 'stderr', data: chunk.toString() });
    });

    child.on('error', (err) => {
      output$.next({ type: 'error', message: err.message });
      output$.complete();
    });

    child.on('close', (code) => {
      const summary = stdout.trim();
      if (code === 0 && summary) {
        output$.next({ type: 'summary', text: summary });
      }
      output$.next({ type: 'exit', code });
      output$.complete();
    });

    return {
      output$: output$.asObservable(),
      kill: () => {
        if (process.platform === 'win32' && child.pid) {
          // A plain child.kill() on Windows only terminates cross-spawn's
          // immediate child - since `claude` is launched via a shell/.cmd
          // wrapper there, the actual worker process underneath can be
          // orphaned and keep running (and keep the project directory
          // locked as its cwd) indefinitely. taskkill's /T kills the
          // whole process tree, not just the wrapper - and this must be
          // spawnSync, not async spawn: callers that immediately try to
          // delete the project directory right after kill() need the
          // process tree to actually be gone by the time kill() returns,
          // not just "asked to die at some point soon".
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        } else {
          child.kill('SIGINT');
        }
      },
    };
  }
}
