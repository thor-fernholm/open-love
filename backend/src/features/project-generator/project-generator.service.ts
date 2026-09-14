import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { Observable, Subject } from 'rxjs';
import {
  AGENT_SERVICE,
  AgentOutputEvent,
  AgentProcessHandle,
} from './agent/agent-service.interface';
import type { IAgentService } from './agent/agent-service.interface';
import { GenerateProjectDto } from './dto/generate-project.dto';

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface Job {
  id: string;
  status: JobStatus;
  projectName: string;
  projectPath: string;
  handle: AgentProcessHandle;
  output$: Subject<AgentOutputEvent>;
  /** Guards against double-completing the Subject (cancel racing an exit). */
  completed: boolean;
}

/**
 * Resolves the repo-root `./generated-projects` directory, per CLAUDE.md's
 * generator spec. Assumes the backend is launched via
 * `cd backend && npm run start:dev` (cwd = backend/), so the repo root is
 * one level up; overridable via GENERATED_PROJECTS_DIR for other setups.
 */
function getGeneratedProjectsRoot(): string {
  return (
    process.env.GENERATED_PROJECTS_DIR ??
    resolve(process.cwd(), '..', 'generated-projects')
  );
}

@Injectable()
export class ProjectGeneratorService {
  private readonly jobs = new Map<string, Job>();

  constructor(
    @Inject(AGENT_SERVICE) private readonly agentService: IAgentService,
  ) {}

  start(dto: GenerateProjectDto): { jobId: string } {
    // Defense in depth beyond the DTO's regex: never let a project name
    // escape the generated-projects root.
    if (dto.projectName.includes('..') || /[/\\]/.test(dto.projectName)) {
      throw new BadRequestException('Invalid projectName');
    }

    const projectPath = resolve(getGeneratedProjectsRoot(), dto.projectName);
    mkdirSync(projectPath, { recursive: true });

    const jobId = randomUUID();
    const handle = this.agentService.run(dto.prompt, projectPath);
    const output$ = new Subject<AgentOutputEvent>();

    const job: Job = {
      id: jobId,
      status: 'running',
      projectName: dto.projectName,
      projectPath,
      handle,
      output$,
      completed: false,
    };
    this.jobs.set(jobId, job);

    handle.output$.subscribe({
      next: (event) => {
        if (event.type === 'exit') {
          job.status = event.code === 0 ? 'completed' : 'failed';
        } else if (event.type === 'error') {
          job.status = 'failed';
        }
        output$.next(event);
      },
      complete: () => this.completeJob(job),
    });

    return { jobId };
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

  private getJob(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`No job found with id ${jobId}`);
    }
    return job;
  }

  /** Completes (and only completes) the job's Subject exactly once. */
  private completeJob(job: Job): void {
    if (job.completed) {
      return;
    }
    job.completed = true;
    job.output$.complete();
  }
}
