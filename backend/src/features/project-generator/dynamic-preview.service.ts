import { Injectable } from '@nestjs/common';
import { spawnSync, type ChildProcess } from 'child_process';
import spawn from 'cross-spawn';
import { existsSync, statSync } from 'fs';
import { createConnection, createServer } from 'net';
import { join } from 'path';

export type PreviewStatus =
  | 'idle'
  | 'installing'
  | 'generating'
  | 'building'
  | 'starting'
  | 'ready'
  | 'failed';

export interface PreviewState {
  status: PreviewStatus;
  /** Only meaningful once 'ready' - see preview.middleware.ts. */
  port?: number;
  message?: string;
}

/** Thrown internally when a step is cut short by stop() - distinguishes
 *  "the pipeline was deliberately cancelled" from "the pipeline failed",
 *  so a stop() doesn't get reported back as a failure. */
class StoppedError extends Error {}

interface TrackedPreview {
  status: PreviewStatus;
  port: number;
  message?: string;
  /** Whichever child process is currently active for this pipeline stage -
   *  install, generate, db push, build, or the long-running start. */
  process?: ChildProcess;
  stopped: boolean;
}

/**
 * Manages the live, running Next.js process behind a 'dynamic' project's
 * preview - a genuinely different thing from the static generator's
 * preview, which just serves files off disk with no process involved (see
 * preview.middleware.ts, which branches between the two).
 *
 * One in-memory entry per project (not persisted - same "rebuilt fresh on
 * a backend restart" philosophy as ProjectGeneratorService's own `jobs`
 * map). Known limitation: restarting the OpenLove backend itself loses
 * track of any currently-running preview process's handle - the OS process
 * keeps running and holding its port until manually killed. Acceptable for
 * now; revisit with a PID-file if it becomes a real problem.
 */
@Injectable()
export class DynamicPreviewService {
  private readonly previews = new Map<string, TrackedPreview>();

  /** No-op if this project's preview is already running/starting/ready -
   *  safe to call on every turn without double-launching anything. Starts
   *  fresh (a new pipeline) if the previous attempt failed.
   *
   *  `fastResumeIfBuiltAfter`: an ISO timestamp - when given and there's
   *  proof (see hasFreshBuild) that a successful build already exists and
   *  postdates it, the pipeline skips straight to `npm run start` instead
   *  of repeating install/generate/db-push/build. Only ever passed by
   *  ProjectGeneratorService.getPreviewStatus's self-heal, where nothing
   *  actually changed - just this process's own tracking was lost to a
   *  backend restart. restart() below never passes this, so a real code
   *  change always gets a full rebuild. */
  async start(
    projectId: string,
    projectPath: string,
    opts: { fastResumeIfBuiltAfter?: string } = {},
  ): Promise<void> {
    const existing = this.previews.get(projectId);
    if (existing && existing.status !== 'failed') {
      return;
    }
    const port = await this.getFreePort();
    const entry: TrackedPreview = { status: 'installing', port, stopped: false };
    this.previews.set(projectId, entry);
    const fastResume = this.hasFreshBuild(projectPath, opts.fastResumeIfBuiltAfter);
    void this.runPipeline(projectId, projectPath, entry, fastResume);
  }

  /** Stop then start - call after every successful turn on a dynamic
   *  project so the live preview reflects the latest edit. Always a full
   *  rebuild - the code just changed. */
  async restart(projectId: string, projectPath: string): Promise<void> {
    this.stop(projectId);
    await this.start(projectId, projectPath);
  }

  /** Whether `projectPath` already has a production build that's provably
   *  current - i.e. safe to just launch (`npm run start`) instead of
   *  redoing install/generate/db-push/build. `.next/BUILD_ID` is only ever
   *  (re)written by a successful `next build`, and this is only ever
   *  called after the turn named by `notBefore` has fully finished writing
   *  its edits to disk (the CLI process has already exited by then) - so a
   *  BUILD_ID newer than that turn's finish time can only be from a build
   *  that already compiled that exact code, not a stale earlier one. */
  private hasFreshBuild(projectPath: string, notBefore?: string): boolean {
    if (!notBefore) return false;
    if (!existsSync(join(projectPath, 'node_modules'))) return false;
    const buildIdPath = join(projectPath, '.next', 'BUILD_ID');
    if (!existsSync(buildIdPath)) return false;
    try {
      return statSync(buildIdPath).mtime.getTime() >= Date.parse(notBefore);
    } catch {
      return false;
    }
  }

  stop(projectId: string): void {
    const entry = this.previews.get(projectId);
    if (!entry) return;
    entry.stopped = true;
    if (entry.process) {
      this.killProcess(entry.process);
    }
    this.previews.delete(projectId);
  }

  getStatus(projectId: string): PreviewState {
    const entry = this.previews.get(projectId);
    if (!entry) return { status: 'idle' };
    return {
      status: entry.status,
      port: entry.status === 'ready' ? entry.port : undefined,
      message: entry.message,
    };
  }

  private async runPipeline(
    projectId: string,
    projectPath: string,
    entry: TrackedPreview,
    fastResume = false,
  ): Promise<void> {
    try {
      if (!fastResume) {
        if (!existsSync(`${projectPath}/node_modules`)) {
          entry.status = 'installing';
          await this.runStep(entry, 'npm', ['install'], projectPath);
        }
        entry.status = 'generating';
        await this.runStep(entry, 'npx', ['prisma', 'generate'], projectPath);
        await this.runStep(
          entry,
          'npx',
          ['prisma', 'db', 'push', '--skip-generate'],
          projectPath,
        );
        entry.status = 'building';
        await this.runStep(entry, 'npm', ['run', 'build'], projectPath);
      }

      entry.status = 'starting';
      const child = spawn(
        'npm',
        ['run', 'start', '--', '-p', String(entry.port)],
        { cwd: projectPath },
      );
      entry.process = child;
      child.on('exit', (code) => {
        if (!entry.stopped) {
          entry.status = 'failed';
          entry.message = `Preview process exited unexpectedly (code ${code})`;
        }
      });

      await this.waitForPort(entry.port, 60_000);
      if (entry.stopped) return;
      entry.status = 'ready';
    } catch (err) {
      if (entry.stopped || err instanceof StoppedError) return;
      entry.status = 'failed';
      entry.message = err instanceof Error ? err.message : String(err);
    }
  }

  /** Runs one short-lived pipeline step to completion, rejecting with the
   *  tail of its stderr on a non-zero exit (or StoppedError if stop() cut
   *  it short instead). */
  private runStep(
    entry: TrackedPreview,
    command: string,
    args: string[],
    cwd: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd });
      entry.process = child;
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (entry.stopped) {
          reject(new StoppedError());
        } else if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `${command} ${args.join(' ')} failed (code ${code}): ${stderr.slice(-500)}`,
            ),
          );
        }
      });
    });
  }

  /** Polls a plain TCP connect rather than string-matching Next's log
   *  output, which isn't a stable contract to depend on. */
  private waitForPort(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const socket = createConnection({ port, host: '127.0.0.1' });
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', () => {
          socket.destroy();
          if (Date.now() > deadline) {
            reject(new Error('Timed out waiting for the preview server to start'));
          } else {
            setTimeout(attempt, 300);
          }
        });
      };
      attempt();
    });
  }

  /** Asks the OS for a free ephemeral port by binding to port 0, then
   *  closes the probe immediately so the real process can bind to it - no
   *  extra dependency needed for this. */
  private getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = address && typeof address === 'object' ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
  }

  /** Same Windows process-tree lesson as ClaudeCliService.kill(): a plain
   *  child.kill() only terminates cross-spawn's immediate wrapper, not
   *  npm's actual worker process underneath - taskkill's /T kills the
   *  whole tree. */
  private killProcess(child: ChildProcess): void {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGINT');
    }
  }
}
