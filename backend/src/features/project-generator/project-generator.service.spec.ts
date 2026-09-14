import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { jest } from '@jest/globals';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getProjectDir } from './project-store';
import {
  AgentOutputEvent,
  AgentProcessHandle,
  IAgentService,
} from './agent/agent-service.interface';
import { AgentServiceRegistry } from './agent/agent-registry.service';
import { SettingsService } from '../settings/settings.service';
import { ProjectGeneratorService } from './project-generator.service';

/**
 * A fake IAgentService strategy - demonstrates that ProjectGeneratorService
 * depends only on the IAgentService contract, so a real strategy
 * (ClaudeCliService, SdkAgentService) can be swapped out in tests without
 * changing any orchestration code.
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
    const registry = { get: () => agent } as unknown as AgentServiceRegistry;
    const settings = {
      getDefault: () => ({ provider: 'claude' as const }),
    } as unknown as SettingsService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectGeneratorService,
        { provide: AgentServiceRegistry, useValue: registry },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();

    service = moduleRef.get(ProjectGeneratorService);
  });

  afterEach(() => {
    delete process.env.GENERATED_PROJECTS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('streams output, persists the turn, and marks the job completed on a clean exit', (done) => {
    const { jobId, projectId } = service.start({
      prompt: 'a todo app',
      name: 'Todo App',
    });

    const received: AgentOutputEvent[] = [];
    service.stream(jobId).subscribe({
      next: (event) => received.push(event),
      complete: () => {
        expect(received).toEqual([
          { type: 'stdout', data: 'hello' },
          { type: 'exit', code: 0 },
        ]);

        const project = service.getProject(projectId);
        expect(project.name).toBe('Todo App');
        expect(project.activeJobId).toBeNull();
        expect(project.turns).toHaveLength(1);
        expect(project.turns[0]).toMatchObject({
          turnId: jobId,
          prompt: 'a todo app',
          status: 'completed',
        });
        expect(project.turns[0].events).toEqual(received);
        done();
      },
    });

    agent.lastHandle.subject.next({ type: 'stdout', data: 'hello' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();
  });

  it('kills the process, completes the stream, and persists a cancelled turn', (done) => {
    const { jobId, projectId } = service.start({
      prompt: 'a todo app',
      name: 'Todo App',
    });

    service.stream(jobId).subscribe({
      complete: () => {
        expect(service.getProject(projectId).turns[0].status).toBe(
          'cancelled',
        );
        done();
      },
    });

    service.cancel(jobId);

    expect(agent.lastHandle.kill).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing project for a follow-up prompt with the same projectId', () => {
    const { projectId } = service.start({ prompt: 'a todo app', name: 'Todo App' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    const followUp = service.start({ prompt: 'add dark mode', projectId });
    expect(followUp.projectId).toBe(projectId);
    expect(service.getProject(projectId).turns).toHaveLength(2);
  });

  it('defaults a new project to the persisted global provider selection', () => {
    const { projectId } = service.start({ prompt: 'a todo app', name: 'Todo App' });
    expect(service.getProject(projectId).turns[0]).toMatchObject({
      provider: 'claude',
    });
  });

  it('honors an explicit per-request provider/model override', () => {
    const { projectId } = service.start({
      prompt: 'a todo app',
      name: 'Todo App',
      provider: 'ollama',
      model: 'gemma3:4b',
    });
    expect(service.getProject(projectId).turns[0]).toMatchObject({
      provider: 'ollama',
      model: 'gemma3:4b',
    });
  });

  it('continues a follow-up with whatever provider/model built the last turn', () => {
    const { projectId } = service.start({
      prompt: 'a todo app',
      name: 'Todo App',
      provider: 'ollama',
      model: 'gemma3:4b',
    });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    service.start({ prompt: 'add dark mode', projectId });
    expect(service.getProject(projectId).turns[1]).toMatchObject({
      provider: 'ollama',
      model: 'gemma3:4b',
    });
  });

  it('throws NotFoundException for an unknown job id', () => {
    expect(() => service.stream('does-not-exist')).toThrow(
      NotFoundException,
    );
    expect(() => service.cancel('does-not-exist')).toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException for an unknown project id', () => {
    expect(() => service.getProject('does-not-exist')).toThrow(
      NotFoundException,
    );
  });

  it('starts a brand-new project from a blank folder (no seeding)', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Site' });
    const projectPath = getProjectDir(projectId);
    expect(existsSync(projectPath)).toBe(true);
    // Only the .openlove metadata dir - nothing seeded into the project itself.
    expect(readdirSync(projectPath)).toEqual(['.openlove']);
  });

  it('requires a name when starting a brand-new project', () => {
    expect(() => service.start({ prompt: 'x' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a projectId that attempts path traversal', () => {
    expect(() =>
      service.start({ prompt: 'x', projectId: '../../etc' }),
    ).toThrow();
  });

  it('lists all projects, newest first', () => {
    const { projectId: first } = service.start({ prompt: 'a', name: 'First' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    const { projectId: second } = service.start({ prompt: 'b', name: 'Second' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    const ids = service.listProjects().map((p) => p.id);
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
  });

  it('resolves an agent-written index.html for the root preview path, and rejects traversal', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Site' });
    // Simulate the agent having written a site into the project folder.
    writeFileSync(join(getProjectDir(projectId), 'index.html'), '<html></html>');
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    expect(service.resolvePreviewFile(projectId, '')).toContain('index.html');
    expect(() =>
      service.resolvePreviewFile(projectId, '../../etc/passwd'),
    ).toThrow(BadRequestException);
  });

  it('404s the preview for a project the agent never wrote an index.html into', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Site' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    expect(() => service.resolvePreviewFile(projectId, '')).toThrow(
      NotFoundException,
    );
  });

  it('renames a project', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Old Name' });
    const updated = service.renameProject(projectId, 'New Name');
    expect(updated.name).toBe('New Name');
    expect(service.getProject(projectId).name).toBe('New Name');
  });

  it('rejects an empty name on rename, and an unknown project id', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Name' });
    expect(() => service.renameProject(projectId, '   ')).toThrow(
      BadRequestException,
    );
    expect(() => service.renameProject('does-not-exist', 'X')).toThrow(
      NotFoundException,
    );
  });

  it('deletes a project, killing any job still running against it first', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Name' });
    const projectPath = getProjectDir(projectId);
    expect(existsSync(projectPath)).toBe(true);

    service.deleteProject(projectId);

    expect(agent.lastHandle.kill).toHaveBeenCalledTimes(1);
    expect(existsSync(projectPath)).toBe(false);
    expect(() => service.getProject(projectId)).toThrow(NotFoundException);
  });

  it('throws NotFoundException deleting an unknown project', () => {
    expect(() => service.deleteProject('does-not-exist')).toThrow(
      NotFoundException,
    );
  });

  it('does not let in-flight output events recreate a deleted project folder', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Name' });
    const projectPath = getProjectDir(projectId);

    service.deleteProject(projectId);
    expect(existsSync(projectPath)).toBe(false);

    // The underlying process can still emit buffered output for a moment
    // after kill() - simulate that arriving after deletion.
    agent.lastHandle.subject.next({ type: 'stdout', data: 'late output' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    expect(existsSync(projectPath)).toBe(false);
  });

  function fakeFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
    return {
      originalname: 'file.txt',
      mimetype: 'text/plain',
      size: 10,
      buffer: Buffer.from('hello'),
      fieldname: 'files',
      encoding: '7bit',
      ...overrides,
    } as Express.Multer.File;
  }

  it('saves attached files under the turn and returns them on the project', () => {
    const files = [
      fakeFile({ originalname: 'brand.txt', mimetype: 'text/plain' }),
      fakeFile({ originalname: 'logo.png', mimetype: 'image/png' }),
    ];
    const { jobId, projectId } = service.start(
      { prompt: 'use these files', name: 'With Attachments' },
      files,
    );

    const turn = service.getProject(projectId).turns[0];
    expect(turn.attachments).toHaveLength(2);
    expect(turn.attachments?.[0]).toMatchObject({ name: 'brand.txt' });
    expect(turn.attachments?.[0].path).toContain(jobId);

    const savedPath = join(getProjectDir(projectId), turn.attachments![0].path);
    expect(existsSync(savedPath)).toBe(true);
  });

  it('rejects an attachment with a disallowed extension', () => {
    expect(() =>
      service.start(
        { prompt: 'x', name: 'Name' },
        [fakeFile({ originalname: 'payload.exe' })],
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an oversized attachment', () => {
    expect(() =>
      service.start(
        { prompt: 'x', name: 'Name' },
        [fakeFile({ originalname: 'big.txt', size: 11 * 1024 * 1024 })],
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects more than the max number of attachments', () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      fakeFile({ originalname: `f${i}.txt` }),
    );
    expect(() => service.start({ prompt: 'x', name: 'Name' }, files)).toThrow(
      BadRequestException,
    );
  });
});
