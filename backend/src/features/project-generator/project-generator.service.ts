import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';
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
import { ProjectDetail, ProjectSummary } from './project.types';

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

  start(dto: GenerateProjectDto): { jobId: string; projectId: string } {
    const { projectId, projectPath } = dto.projectId
      ? this.resolveExistingProject(dto.projectId)
      : this.createProject(dto.name);

    const jobId = randomUUID();
    appendTurn(projectId, {
      turnId: jobId,
      prompt: dto.prompt,
      startedAt: new Date().toISOString(),
      status: 'running',
    });

    const handle = this.agentService.run(
      buildAgentPrompt(dto.prompt),
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
    };
    this.jobs.set(jobId, job);

    handle.output$.subscribe({
      next: (event) => {
        appendTurnEvent(projectId, jobId, event);
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
    updateTurnStatus(
      job.projectId,
      job.id,
      job.status,
      new Date().toISOString(),
    );
    job.output$.complete();
  }
}
