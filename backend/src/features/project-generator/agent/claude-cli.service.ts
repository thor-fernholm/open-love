import { Injectable } from '@nestjs/common';
import { spawnSync } from 'child_process';
import spawn from 'cross-spawn';
import { Subject } from 'rxjs';
import {
  AgentOutputEvent,
  AgentProcessHandle,
  IAgentService,
} from './agent-service.interface';

/**
 * Concrete Strategy: generates a project by shelling out to the `claude`
 * CLI in non-interactive mode, auto-accepting file edits.
 */
@Injectable()
export class ClaudeCliService implements IAgentService {
  run(prompt: string, cwd: string): AgentProcessHandle {
    const output$ = new Subject<AgentOutputEvent>();

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
        '--permission-mode',
        'acceptEdits',
        '--model',
        'claude-haiku-4-5-20251001',
      ],
      { cwd },
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
      output$.next({ type: 'stdout', data: chunk.toString() });
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      output$.next({ type: 'stderr', data: chunk.toString() });
    });

    child.on('error', (err) => {
      output$.next({ type: 'error', message: err.message });
      output$.complete();
    });

    child.on('close', (code) => {
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
