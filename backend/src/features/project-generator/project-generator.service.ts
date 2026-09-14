import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { extname, join, resolve, sep } from 'path';
import { Observable, Subject } from 'rxjs';
import {
  AGENT_SERVICE,
  AgentOutputEvent,
  AgentProcessHandle,
} from './agent/agent-service.interface';
import type { IAgentService } from './agent/agent-service.interface';
import { buildAgentPrompt } from './agent/prompt-template';
import { GenerateProjectDto } from './dto/generate-project.dto';
import {
  appendTurn,
  appendTurnEvent,
  assertSafeId,
  getProjectDir,
  listProjectIds,
  readAllTurns,
  readMeta,
  statBirthtime,
  updateTurnStatus,
  writeMeta,
} from './project-store';
import { ProjectDetail, ProjectSummary, TurnAttachment } from './project.types';

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
}

@Injectable()
export class ProjectGeneratorService {
  /** Running/finished jobs this process has seen - not persisted, since a
   *  job is just one in-flight CLI invocation; project state itself lives
   *  on disk via project-store so it survives a restart. */
  private readonly jobs = new Map<string, Job>();

  constructor(
    @Inject(AGENT_SERVICE) private readonly agentService: IAgentService,
  ) {}

  start(
    dto: GenerateProjectDto,
    files: Express.Multer.File[] = [],
  ): { jobId: string; projectId: string } {
    const { projectId, projectPath } = dto.projectId
      ? this.resolveExistingProject(dto.projectId)
      : this.createProject(dto.name);

    const jobId = randomUUID();
    const attachments = this.saveAttachments(projectId, jobId, files);
    appendTurn(projectId, {
      turnId: jobId,
      prompt: dto.prompt,
      startedAt: new Date().toISOString(),
      status: 'running',
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    const handle = this.agentService.run(
      buildAgentPrompt(dto.prompt, attachments),
      projectPath,
    );
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
    };
    this.jobs.set(jobId, job);

    handle.output$.subscribe({
      next: (event) => {
        if (!job.deleted) {
          appendTurnEvent(projectId, jobId, event);
        }
        if (event.type === 'exit') {
          job.status = event.code === 0 ? 'completed' : 'failed';
        } else if (event.type === 'error') {
          job.status = 'failed';
        }
        output$.next(event);
      },
      complete: () => this.completeJob(job),
    });

    return { jobId, projectId };
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
    return {
      ...meta,
      turns: readAllTurns(id),
      activeJobId: this.findActiveJobId(id),
    };
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
    const root = resolve(getProjectDir(projectId));
    if (!existsSync(root)) {
      throw new NotFoundException(`No project found with id ${projectId}`);
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(subPath);
    } catch {
      throw new BadRequestException('Invalid preview path');
    }

    let target = resolve(root, decoded);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new BadRequestException('Invalid preview path');
    }
    if (existsSync(target) && statSync(target).isDirectory()) {
      target = join(target, 'index.html');
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
      throw new NotFoundException('File not found');
    }
    return target;
  }

  private createProject(name: string | undefined): {
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
    // Starts from a blank folder - the agent builds whatever the request
    // calls for, guided entirely by buildAgentPrompt's conventions (tech
    // constraint, default design language, optional content manifest)
    // rather than a literal template to copy and edit.
    mkdirSync(projectPath, { recursive: true });
    writeMeta(projectId, {
      id: projectId,
      name: name.trim(),
      createdAt: new Date().toISOString(),
    });
    return { projectId, projectPath };
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
    updateTurnStatus(
      job.projectId,
      job.id,
      job.status,
      new Date().toISOString(),
    );
    job.output$.complete();
  }
}
