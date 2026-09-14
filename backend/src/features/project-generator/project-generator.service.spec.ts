import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { jest } from '@jest/globals';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AGENT_SERVICE,
  AgentOutputEvent,
  AgentProcessHandle,
  IAgentService,
} from './agent/agent-service.interface';
import { ProjectGeneratorService } from './project-generator.service';

/**
 * A fake IAgentService strategy - demonstrates that ProjectGeneratorService
 * depends only on the IAgentService contract, so the real ClaudeCliService
 * can be swapped out in tests without changing any orchestration code.
 */
class FakeAgentService implements IAgentService {
  public lastHandle!: { subject: Subject<AgentOutputEvent>; kill: jest.Mock };

  run(): AgentProcessHandle {
    const subject = new Subject<AgentOutputEvent>();
    const kill = jest.fn();
    this.lastHandle = { subject, kill };
    return { output$: subject.asObservable(), kill };
  }
}

describe('ProjectGeneratorService', () => {
  let service: ProjectGeneratorService;
  let agent: FakeAgentService;
  // Real ESM module namespace objects are frozen, so `fs.mkdirSync` can't
  // be spied on/monkey-patched here (Jest's ESM module mocking is more
  // ceremony than this needs) - instead just point the service at a
  // throwaway temp directory and let it create real folders there.
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `openlove-test-${Date.now()}`);
    process.env.GENERATED_PROJECTS_DIR = testDir;

    agent = new FakeAgentService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectGeneratorService,
        { provide: AGENT_SERVICE, useValue: agent },
      ],
    }).compile();

    service = moduleRef.get(ProjectGeneratorService);
  });

  afterEach(() => {
    delete process.env.GENERATED_PROJECTS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('streams output and marks the job completed on a clean exit', (done) => {
    const { jobId } = service.start({
      prompt: 'a todo app',
      projectName: 'todo-app',
    });

    const received: AgentOutputEvent[] = [];
    service.stream(jobId).subscribe({
      next: (event) => received.push(event),
      complete: () => {
        expect(received).toEqual([
          { type: 'stdout', data: 'hello' },
          { type: 'exit', code: 0 },
        ]);
        done();
      },
    });

    agent.lastHandle.subject.next({ type: 'stdout', data: 'hello' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();
  });

  it('kills the process and completes the stream on cancel', (done) => {
    const { jobId } = service.start({
      prompt: 'a todo app',
      projectName: 'todo-app',
    });

    service.stream(jobId).subscribe({ complete: () => done() });

    service.cancel(jobId);

    expect(agent.lastHandle.kill).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException for an unknown job id', () => {
    expect(() => service.stream('does-not-exist')).toThrow(
      NotFoundException,
    );
    expect(() => service.cancel('does-not-exist')).toThrow(
      NotFoundException,
    );
  });

  it('rejects a projectName that attempts path traversal', () => {
    expect(() =>
      service.start({ prompt: 'x', projectName: '../../etc' }),
    ).toThrow();
  });
});
