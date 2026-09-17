import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { Observable, Subject } from 'rxjs';
import { AgentServiceRegistry } from './agent/agent-registry.service';
import { AgentOutputEvent, AgentProcessHandle } from './agent/agent-service.interface';
import { SettingsService } from '../settings/settings.service';
import { DynamicPreviewService, PreviewState } from './dynamic-preview.service';
import { GenerateProjectDto } from './dto/generate-project.dto';
import {
  appendTurn,
  appendTurnEvent,
  assertSafeId,
  getAdvancedStarterDir,
  getProjectDir,
  listDirRecursive,
  listProjectIds,
  readAllTurns,
  readMeta,
  resolveWithinDir,
  statBirthtime,
  updateTurnStatus,
  writeMeta,
} from './project-store';
import {
  AgentSelection,
  ProjectDetail,
  ProjectSummary,
  SiteType,
  TurnAttachment,
  TurnDetail,
} from './project.types';

const ATTACHMENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.pdf',
]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\.\./g, '_').slice(-100) || 'file';
}

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface Job {
  id: string;
  projectId: string;
  status: JobStatus;
  projectPath: string;
  handle: AgentProcessHandle;
  output$: Subject<AgentOutputEvent>;
  /** Guards against double-completing the Subject (cancel racing an exit). */
  completed: boolean;
  /** Set when the project itself has been deleted out from under this job -
   *  guards the subscription below from recreating its folder via leftover
   *  in-flight output events that arrive after kill() but before the
   *  underlying process has actually exited. */
  deleted: boolean;
  /** The agent's own short reply, captured off a 'summary' event - see
   *  TurnRecord.summary. Persisted alongside status/finishedAt in
   *  completeJob(). */
  summary?: string;
  /** Newest file mtime under the project dir when this job started - diffed
   *  against the same reading at exit to derive changedFiles below, without
   *  trusting the agent to self-report it. */
  startMtime: number;
  /** Whether any project file actually changed during this run - see
   *  TurnRecord.changedFiles. Set once, at exit. */
  changedFiles?: boolean;
}

@Injectable()
export class ProjectGeneratorService {
  private readonly logger = new Logger(ProjectGeneratorService.name);

  /** Running/finished jobs this process has seen - not persisted, since a
   *  job is just one in-flight CLI invocation; project state itself lives
   *  on disk via project-store so it survives a restart. */
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly agentRegistry: AgentServiceRegistry,
    private readonly settings: SettingsService,
    private readonly dynamicPreview: DynamicPreviewService,
  ) {}

  start(
    dto: GenerateProjectDto,
    files: Express.Multer.File[] = [],
  ): { jobId: string; projectId: string } {
    const siteType: SiteType = dto.projectId
      ? this.getSiteType(dto.projectId)
      : dto.siteType ?? 'static';

    const selection = this.resolveSelection(dto);
    if (selection.provider === 'ollama' && siteType === 'dynamic') {
      throw new BadRequestException(
        'Ollama cannot build advanced (dynamic) projects yet - use Claude Code.',
      );
    }

    const { projectId, projectPath } = dto.projectId
      ? this.resolveExistingProject(dto.projectId)
      : this.createProject(dto.name, siteType);

    // Read before appending this turn below, so it's naturally just the
    // *prior* turns - what the agent should remember, not this one. See
    // agent/prompt-template.ts's buildHistorySection for how it's used
    // (compacted once it's large) and why: without this, every turn started
    // fresh with no memory of what was already asked or answered.
    const history = readAllTurns(projectId).map((turn) => ({
      prompt: turn.prompt,
      summary: turn.summary,
    }));
    const startMtime = this.newestMtime(projectPath);

    const jobId = randomUUID();
    const attachments = this.saveAttachments(projectId, jobId, files);
    appendTurn(projectId, {
      turnId: jobId,
      prompt: dto.prompt,
      startedAt: new Date().toISOString(),
      status: 'running',
      attachments: attachments.length > 0 ? attachments : undefined,
      provider: selection.provider,
      model: selection.model,
    });

    const handle = this.agentRegistry.get(selection.provider).run({
      userPrompt: dto.prompt,
      cwd: projectPath,
      model: selection.model,
      attachments,
      siteType,
      history,
    });
    const output$ = new Subject<AgentOutputEvent>();
    const job: Job = {
      id: jobId,
      projectId,
      status: 'running',
      projectPath,
      handle,
      output$,
      completed: false,
      deleted: false,
      startMtime,
    };
    this.jobs.set(jobId, job);

    handle.output$.subscribe({
      // A Subject's subscribe callbacks run synchronously on its own
      // .next()/.complete() call, and RxJS rethrows anything they throw as
      // an uncaught exception on the next tick - which crashes the entire
      // Node process by default, taking down every other in-flight
      // job/preview with it, not just this one (see healOrphanedTurn above
      // for the recovery this guards against). A single bad write here
      // (e.g. a transient file-write error) shouldn't be able to do that -
      // catch and just fail this job instead.
      next: (event) => {
        try {
          if (!job.deleted) {
            appendTurnEvent(projectId, jobId, event);
          }
          if (event.type === 'summary') {
            job.summary = event.text;
          } else if (event.type === 'exit') {
            job.status = event.code === 0 ? 'completed' : 'failed';
            job.changedFiles = this.newestMtime(projectPath) > job.startMtime;
            // A dynamic project's live preview should reflect this turn's
            // edits - restart is idempotent-safe to call even if nothing was
            // running yet (see DynamicPreviewService.start). Skipped when
            // nothing actually changed (a plain answer/clarifying question,
            // see the Conversation rule in prompt-template.ts) - rebuilding
            // a whole Next.js app for a turn that touched no files would be
            // pure waste.
            if (
              job.status === 'completed' &&
              job.changedFiles &&
              siteType === 'dynamic' &&
              !job.deleted
            ) {
              void this.dynamicPreview.restart(projectId, projectPath);
            }
          } else if (event.type === 'error') {
            job.status = 'failed';
          }
          output$.next(event);
        } catch (err) {
          this.logger.error(
            `Error handling agent output for job ${jobId}: ${(err as Error).message}`,
            (err as Error).stack,
          );
          job.status = 'failed';
        }
      },
      complete: () => {
        try {
          this.completeJob(job);
        } catch (err) {
          this.logger.error(
            `Error completing job ${jobId}: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      },
    });

    return { jobId, projectId };
  }

  /** Polled by the frontend every ~2s for a dynamic project. Also
   *  self-heals: DynamicPreviewService's tracking is in-memory only (see
   *  its own known-limitation note), so an OpenLove backend restart loses
   *  track of an otherwise-fine, already-built preview and leaves it
   *  showing 'idle' forever - nothing would ever kick off a fresh start()
   *  again except a brand new turn completing. Since simply viewing the
   *  project polls this, relaunching from here (a no-op if something's
   *  already tracked) means the preview recovers on its own the next time
   *  someone looks at it. Passes the last *file-changing* turn's finish
   *  time so DynamicPreviewService can skip straight to `npm run start`
   *  when a build already on disk provably postdates it (see its
   *  hasFreshBuild/fastResumeIfBuiltAfter) - deliberately not just the
   *  very last turn's finish time: a trailing answer-only turn (see the
   *  Conversation rule in prompt-template.ts) finishes *after* the build
   *  it didn't touch, which would make an otherwise-fine build look stale
   *  and trigger a pointless full rebuild. This call fires on every
   *  restart even though nothing about the project's code changed, so
   *  redoing install/generate/db-push/build every time would be pure
   *  waste. Only fires at all when there's an actual finished turn to show
   *  - never for one that's still running or that failed. */
  getPreviewStatus(id: string): PreviewState {
    assertSafeId(id);
    const status = this.dynamicPreview.getStatus(id);
    if (status.status === 'idle' && this.getSiteType(id) === 'dynamic') {
      const turns = readAllTurns(id);
      const last = turns[turns.length - 1];
      if (last?.status === 'completed') {
        const lastChanging = [...turns]
          .reverse()
          .find((turn) => turn.status === 'completed' && turn.changedFiles !== false);
        void this.dynamicPreview.start(id, getProjectDir(id), {
          fastResumeIfBuiltAfter: lastChanging?.finishedAt,
        });
      }
    }
    return status;
  }

  stream(jobId: string): Observable<AgentOutputEvent> {
    return this.getJob(jobId).output$.asObservable();
  }

  cancel(jobId: string): void {
    const job = this.getJob(jobId);
    job.handle.kill();
    job.status = 'cancelled';
    this.completeJob(job);
  }

  listProjects(): ProjectSummary[] {
    return listProjectIds()
      .map((id) => readMeta(id) ?? this.legacyMeta(id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProject(id: string): ProjectDetail {
    assertSafeId(id);
    if (!existsSync(getProjectDir(id))) {
      throw new NotFoundException(`No project found with id ${id}`);
    }
    const meta = readMeta(id) ?? this.legacyMeta(id);
    const turns = readAllTurns(id);
    this.healOrphanedTurn(id, turns);
    return {
      ...meta,
      turns,
      activeJobId: this.findActiveJobId(id),
    };
  }

  /**
   * A turn can be left permanently `"running"` if the backend process that
   * was executing it died or restarted mid-turn - `this.jobs` is in-memory
   * only (see its own comment above), so nothing else would ever notice or
   * update it, and the frontend has no job/stream left to attach to either
   * (it renders that as an immediate "Failed"). Detected lazily here, the
   * same self-healing pattern as `getPreviewStatus` uses for
   * `DynamicPreviewService`'s equivalent in-memory tracking: since this is
   * already polled while a project's page is open, a turn's status
   * self-corrects the next time anyone looks, rather than staying stuck
   * "running" forever with no way for the user to even retry.
   */
  private healOrphanedTurn(projectId: string, turns: TurnDetail[]): void {
    const last = turns[turns.length - 1];
    if (!last || last.status !== 'running' || this.jobs.has(last.turnId)) {
      return;
    }
    const finishedAt = new Date().toISOString();
    appendTurnEvent(projectId, last.turnId, {
      type: 'error',
      message:
        'Generation was interrupted (the server restarted mid-run) - try again.',
    });
    updateTurnStatus(projectId, last.turnId, 'failed', finishedAt);
    last.status = 'failed';
    last.finishedAt = finishedAt;
    last.events.push({
      type: 'error',
      message:
        'Generation was interrupted (the server restarted mid-run) - try again.',
    });
  }

  /**
   * Zips up a generated project's own files so it can be downloaded and
   * hosted anywhere - since every generated site is already plain static
   * HTML/CSS/JS with no build step (see agent/prompt-template.ts), the zip
   * *is* the deployable artifact, no packaging needed beyond this.
   * `.openlove/` (attachments, turn history, internal metadata) is left
   * out via listDirRecursive - the same "what's actually part of the site"
   * view the agent's own list_files tool sees.
   */
  exportProject(id: string): StreamableFile {
    assertSafeId(id);
    const root = getProjectDir(id);
    if (!existsSync(root)) {
      throw new NotFoundException(`No project found with id ${id}`);
    }
    const meta = readMeta(id) ?? this.legacyMeta(id);

    const archive = archiver('zip', { zlib: { level: 9 } });
    for (const relPath of listDirRecursive(root, '.')) {
      archive.file(join(root, relPath), { name: relPath });
    }
    void archive.finalize();

    return new StreamableFile(archive, {
      type: 'application/zip',
      disposition: `attachment; filename="${sanitizeFilename(meta.name)}.zip"`,
    });
  }

  renameProject(id: string, name: string): ProjectSummary {
    assertSafeId(id);
    if (!existsSync(getProjectDir(id))) {
      throw new NotFoundException(`No project found with id ${id}`);
    }
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('name cannot be empty');
    }
    const meta = readMeta(id) ?? this.legacyMeta(id);
    const updated: ProjectSummary = { ...meta, name: trimmed };
    writeMeta(id, updated);
    return updated;
  }

  deleteProject(id: string): void {
    assertSafeId(id);
    const projectPath = getProjectDir(id);
    if (!existsSync(projectPath)) {
      throw new NotFoundException(`No project found with id ${id}`);
    }
    // A dynamic project may have a live preview process holding this
    // folder open (or just pointlessly running against a folder that's
    // about to disappear) - stop it before anything else.
    this.dynamicPreview.stop(id);
    // Kill anything still writing into this folder before removing it, and
    // mark it deleted so leftover in-flight events (which can still arrive
    // for a moment after kill()) don't recreate the folder we're about to
    // remove - see the `deleted` flag on Job.
    for (const job of this.jobs.values()) {
      if (job.projectId === id && job.status === 'running') {
        job.deleted = true;
        job.handle.kill();
        job.status = 'cancelled';
        this.completeJob(job);
      }
    }
    // On Windows, a just-killed process can hold the directory as its cwd
    // (or have a handle still closing) for a brief moment after kill()
    // returns, which turns an immediate rmSync into EPERM/EBUSY. maxRetries
    // + retryDelay is Node's own built-in backoff for exactly this class of
    // transient error - simpler and more robust than a custom retry loop.
    rmSync(projectPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }

  /**
   * Resolves a generated project's own file for the "Open website" preview
   * (see preview.middleware.ts), rejecting any sub-path that would escape
   * the project's own folder.
   */
  resolvePreviewFile(projectId: string, subPath: string): string {
    assertSafeId(projectId);
    const root = getProjectDir(projectId);
    if (!existsSync(root)) {
      throw new NotFoundException(`No project found with id ${projectId}`);
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(subPath);
    } catch {
      throw new BadRequestException('Invalid preview path');
    }

    let target = resolveWithinDir(root, decoded);
    if (existsSync(target) && statSync(target).isDirectory()) {
      target = join(target, 'index.html');
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
      throw new NotFoundException('File not found');
    }
    return target;
  }

  private createProject(
    name: string | undefined,
    siteType: SiteType,
  ): {
    projectId: string;
    projectPath: string;
  } {
    if (!name?.trim()) {
      throw new BadRequestException(
        'name is required to start a new project',
      );
    }
    const projectId = randomUUID();
    const projectPath = getProjectDir(projectId);
    if (siteType === 'dynamic') {
      // Seeded from a real, working Next.js + Prisma + SQLite scaffold -
      // the agent extends it (see prompt-template.ts's dynamic
      // conventions) rather than inventing boilerplate from scratch.
      cpSync(getAdvancedStarterDir(), projectPath, { recursive: true });
    } else {
      // Starts from a blank folder - the agent builds whatever the request
      // calls for, guided entirely by buildAgentPrompt's conventions (tech
      // constraint, default design language, optional content manifest)
      // rather than a literal template to copy and edit.
      mkdirSync(projectPath, { recursive: true });
    }
    writeMeta(projectId, {
      id: projectId,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      siteType,
    });
    return { projectId, projectPath };
  }

  /** A project's siteType is fixed at creation - a follow-up always reads
   *  it back off disk rather than trusting a per-request value. Absent
   *  meta (a project that predates this field) is treated as 'static'.
   *  Public: preview.middleware.ts also needs this to decide whether to
   *  proxy to a live dev server or serve files directly. */
  getSiteType(id: string): SiteType {
    assertSafeId(id);
    return readMeta(id)?.siteType ?? 'static';
  }

  /** Which agent builds this turn: an explicit per-request override, else
   *  (for a follow-up) whatever the project's most recent turn used, else
   *  the persisted global default - see features/settings. */
  private resolveSelection(dto: GenerateProjectDto): AgentSelection {
    if (dto.provider) {
      return { provider: dto.provider, model: dto.model };
    }
    if (dto.projectId) {
      const turns = readAllTurns(dto.projectId);
      const last = turns[turns.length - 1];
      if (last) {
        return { provider: last.provider, model: last.model };
      }
    }
    return this.settings.getDefault();
  }

  private resolveExistingProject(projectId: string): {
    projectId: string;
    projectPath: string;
  } {
    assertSafeId(projectId);
    const projectPath = getProjectDir(projectId);
    if (!existsSync(projectPath)) {
      throw new NotFoundException(`No project found with id ${projectId}`);
    }
    return { projectId, projectPath };
  }

  /** Saves any files attached to a prompt under that turn's own folder, so
   *  the agent can read them - see agent/prompt-template.ts. */
  private saveAttachments(
    projectId: string,
    turnId: string,
    files: Express.Multer.File[],
  ): TurnAttachment[] {
    if (files.length === 0) {
      return [];
    }
    if (files.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(`Attach at most ${MAX_ATTACHMENTS} files`);
    }
    const dir = join(getProjectDir(projectId), '.openlove', 'attachments', turnId);
    mkdirSync(dir, { recursive: true });
    return files.map((file, index) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestException(
          `"${file.originalname}" is too large (max 10MB)`,
        );
      }
      const ext = extname(file.originalname).toLowerCase();
      if (!ATTACHMENT_EXTENSIONS.has(ext)) {
        throw new BadRequestException(`Unsupported attachment type "${ext}"`);
      }
      const filename = `${index}-${sanitizeFilename(file.originalname)}`;
      writeFileSync(join(dir, filename), file.buffer);
      return {
        name: file.originalname,
        path: `.openlove/attachments/${turnId}/${filename}`,
        mimeType: file.mimetype,
      };
    });
  }

  /** Display entry for a folder that predates - or never got - metadata. */
  private legacyMeta(id: string): ProjectSummary {
    return { id, name: id, createdAt: statBirthtime(id) };
  }

  private findActiveJobId(projectId: string): string | null {
    for (const job of this.jobs.values()) {
      if (job.projectId === projectId && job.status === 'running') {
        return job.id;
      }
    }
    return null;
  }

  /** Newest mtime (ms) among a project's own files (same exclusion list as
   *  exports/the agent's own list_files - see listDirRecursive), or 0 for
   *  an empty project. Diffed before/after a turn to derive changedFiles
   *  without trusting the agent to self-report whether it edited anything -
   *  see the Conversation rule in prompt-template.ts, which is what makes
   *  an unchanged result actually possible (a plain answer, not a build). */
  private newestMtime(root: string): number {
    let newest = 0;
    for (const relPath of listDirRecursive(root, '.')) {
      try {
        const mtime = statSync(join(root, relPath)).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        // Removed/replaced mid-scan (e.g. a file the agent is actively
        // rewriting) - not worth failing the whole turn over.
      }
    }
    return newest;
  }

  private getJob(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`No job found with id ${jobId}`);
    }
    return job;
  }

  /** Completes (and only completes) the job's Subject exactly once, and
   *  persists the turn's final status at that same moment - centralizing
   *  it here (rather than in both the cancel() and subscribe-complete call
   *  sites) is what keeps a cancel racing a near-simultaneous natural exit
   *  from writing the wrong status. */
  private completeJob(job: Job): void {
    if (job.completed) {
      return;
    }
    job.completed = true;
    if (job.deleted) {
      job.output$.complete();
      return;
    }
    updateTurnStatus(job.projectId, job.id, job.status, new Date().toISOString(), {
      summary: job.summary,
      changedFiles: job.changedFiles,
    });
    job.output$.complete();
  }
}
