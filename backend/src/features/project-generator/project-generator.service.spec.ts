import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { jest } from '@jest/globals';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getProjectDir } from './project-store';
import {
  AgentOutputEvent,
  AgentProcessHandle,
  AgentRunRequest,
  IAgentService,
} from './agent/agent-service.interface';
import { AgentServiceRegistry } from './agent/agent-registry.service';
import { SettingsService } from '../settings/settings.service';
import { DynamicPreviewService, PreviewState } from './dynamic-preview.service';
import { ProjectGeneratorService } from './project-generator.service';

/**
 * A fake IAgentService strategy - demonstrates that ProjectGeneratorService
 * depends only on the IAgentService contract, so a real strategy
 * (ClaudeCliService, SdkAgentService) can be swapped out in tests without
 * changing any orchestration code.
 */
class FakeAgentService implements IAgentService {
  public lastHandle!: { subject: Subject<AgentOutputEvent>; kill: jest.Mock };
  public lastRequest!: AgentRunRequest;

  run(request: AgentRunRequest): AgentProcessHandle {
    this.lastRequest = request;
    const subject = new Subject<AgentOutputEvent>();
    const kill = jest.fn();
    this.lastHandle = { subject, kill };
    return { output$: subject.asObservable(), kill };
  }
}

class FakeDynamicPreview {
  start = jest.fn(async (_id: string, _path: string) => {});
  restart = jest.fn(async (_id: string, _path: string) => {});
  stop = jest.fn((_id: string) => {});
  getStatus = jest.fn((_id: string): PreviewState => ({ status: 'idle' }));
}

describe('ProjectGeneratorService', () => {
  let service: ProjectGeneratorService;
  let agent: FakeAgentService;
  let dynamicPreview: FakeDynamicPreview;
  // Real ESM module namespace objects are frozen, so `fs.mkdirSync` can't
  // be spied on/monkey-patched here (Jest's ESM module mocking is more
  // ceremony than this needs) - instead just point the service at a
  // throwaway temp directory and let it create real folders there.
  let testDir: string;
  let starterDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `openlove-test-${Date.now()}`);
    process.env.GENERATED_PROJECTS_DIR = testDir;
    // A tiny fake starter, standing in for templates/advanced-starter/ - a
    // real Next.js scaffold would be needlessly slow/heavy for a unit test;
    // this just needs to prove the copy-on-create behavior.
    starterDir = join(tmpdir(), `openlove-starter-${Date.now()}`);
    mkdirSync(starterDir, { recursive: true });
    writeFileSync(join(starterDir, 'package.json'), '{"name":"advanced-starter"}');
    process.env.ADVANCED_STARTER_DIR = starterDir;

    agent = new FakeAgentService();
    const registry = { get: () => agent } as unknown as AgentServiceRegistry;
    const settings = {
      getDefault: () => ({ provider: 'claude' as const }),
    } as unknown as SettingsService;
    dynamicPreview = new FakeDynamicPreview();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectGeneratorService,
        { provide: AgentServiceRegistry, useValue: registry },
        { provide: SettingsService, useValue: settings },
        { provide: DynamicPreviewService, useValue: dynamicPreview },
      ],
    }).compile();

    service = moduleRef.get(ProjectGeneratorService);
  });

  afterEach(() => {
    delete process.env.GENERATED_PROJECTS_DIR;
    delete process.env.ADVANCED_STARTER_DIR;
    rmSync(testDir, { recursive: true, force: true });
    rmSync(starterDir, { recursive: true, force: true });
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

  it('passes prior turns as history to the agent, but never the turn currently being started', () => {
    const { projectId } = service.start({ prompt: 'build a todo app', name: 'Todo App' });
    expect(agent.lastRequest.history).toEqual([]); // nothing before the very first turn
    agent.lastHandle.subject.next({ type: 'summary', text: 'Built a basic todo app.' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    service.start({ prompt: 'add dark mode', projectId });

    expect(agent.lastRequest.history).toEqual([
      { prompt: 'build a todo app', summary: 'Built a basic todo app.' },
    ]);
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

  it('seeds a new dynamic project from the advanced-starter template instead of a blank folder', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    const projectPath = getProjectDir(projectId);
    expect(existsSync(join(projectPath, 'package.json'))).toBe(true);
    expect(agent.lastRequest.siteType).toBe('dynamic');
  });

  it('defaults a new project to static and passes that through to the agent', () => {
    service.start({ prompt: 'a site', name: 'Site' });
    expect(agent.lastRequest.siteType).toBe('static');
  });

  it('rejects combining provider: ollama with siteType: dynamic', () => {
    expect(() =>
      service.start({
        prompt: 'x',
        name: 'Name',
        provider: 'ollama',
        model: 'gemma3:4b',
        siteType: 'dynamic',
      }),
    ).toThrow(BadRequestException);
  });

  it('a follow-up on a dynamic project keeps using dynamic even without repeating siteType', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    service.start({ prompt: 'add a field', projectId });
    expect(agent.lastRequest.siteType).toBe('dynamic');
  });

  it('restarts the live preview after a dynamic project turn that actually changed a file', () => {
    const { projectId, jobId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    // Stand in for the agent editing a file mid-turn - restart should only
    // fire when something on disk actually changed (see changedFiles).
    writeFileSync(join(getProjectDir(projectId), 'edited.txt'), 'x');
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    expect(dynamicPreview.restart).toHaveBeenCalledWith(
      projectId,
      getProjectDir(projectId),
    );
    expect(service.getProject(projectId).turns[0].changedFiles).toBe(true);
    void jobId;
  });

  it('does not restart the preview (or mark the turn changed) when a dynamic turn touched no files - e.g. a plain answer', () => {
    const { projectId } = service.start({
      prompt: 'what framework does this use?',
      name: 'App',
      siteType: 'dynamic',
    });
    agent.lastHandle.subject.next({ type: 'summary', text: 'This project uses Next.js.' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    expect(dynamicPreview.restart).not.toHaveBeenCalled();
    const turn = service.getProject(projectId).turns[0];
    expect(turn.changedFiles).toBe(false);
    expect(turn.summary).toBe('This project uses Next.js.');
  });

  it('does not restart the preview when a dynamic project turn fails', () => {
    service.start({ prompt: 'a full app', name: 'App', siteType: 'dynamic' });
    agent.lastHandle.subject.next({ type: 'exit', code: 1 });
    agent.lastHandle.subject.complete();

    expect(dynamicPreview.restart).not.toHaveBeenCalled();
  });

  it('does not touch the preview process for a static project', () => {
    service.start({ prompt: 'a site', name: 'Site' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    expect(dynamicPreview.restart).not.toHaveBeenCalled();
  });

  it('stops the live preview when a project is deleted', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    service.deleteProject(projectId);
    expect(dynamicPreview.stop).toHaveBeenCalledWith(projectId);
  });

  it('passes preview-status requests through to DynamicPreviewService', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    dynamicPreview.getStatus.mockReturnValueOnce({ status: 'building' });
    expect(service.getPreviewStatus(projectId)).toEqual({ status: 'building' });
    expect(dynamicPreview.getStatus).toHaveBeenCalledWith(projectId);
  });

  it('self-heals: relaunches the preview if nothing is tracked but the last turn on a dynamic project completed', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    writeFileSync(join(getProjectDir(projectId), 'edited.txt'), 'x'); // a real build turn
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();
    dynamicPreview.restart.mockClear(); // clear the completion-triggered call above
    dynamicPreview.getStatus.mockReturnValue({ status: 'idle' });
    const finishedAt = service.getProject(projectId).turns[0].finishedAt;

    service.getPreviewStatus(projectId);

    // Passes the last completed turn's finish time through so
    // DynamicPreviewService can skip a redundant rebuild when a build
    // already on disk provably postdates it (see hasFreshBuild) - a
    // backend-restart reconnect like this one changed nothing about the
    // project's code, so redoing install/generate/build would be waste.
    expect(dynamicPreview.start).toHaveBeenCalledWith(projectId, getProjectDir(projectId), {
      fastResumeIfBuiltAfter: finishedAt,
    });
  });

  it('self-heal uses the last file-changing turn\'s finish time, not a trailing answer-only turn\'s - which finishes after a build it never touched, and would otherwise make a perfectly good build look stale', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    writeFileSync(join(getProjectDir(projectId), 'edited.txt'), 'x'); // the actual build
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();
    const buildingTurnFinishedAt = service.getProject(projectId).turns[0].finishedAt;

    // A trailing answer-only follow-up - touches nothing, but finishes
    // (and is timestamped) strictly after the build above.
    service.start({ prompt: 'what does this app do?', projectId });
    agent.lastHandle.subject.next({ type: 'summary', text: 'It manages a todo list.' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();
    expect(service.getProject(projectId).turns[1].changedFiles).toBe(false);

    dynamicPreview.restart.mockClear();
    dynamicPreview.getStatus.mockReturnValue({ status: 'idle' });

    service.getPreviewStatus(projectId);

    expect(dynamicPreview.start).toHaveBeenCalledWith(projectId, getProjectDir(projectId), {
      fastResumeIfBuiltAfter: buildingTurnFinishedAt,
    });
  });

  it('does not relaunch the preview for a static project', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Site' });
    dynamicPreview.getStatus.mockReturnValue({ status: 'idle' });

    service.getPreviewStatus(projectId);

    expect(dynamicPreview.start).not.toHaveBeenCalled();
  });

  it('does not relaunch the preview while the dynamic project\'s turn is still running', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    dynamicPreview.getStatus.mockReturnValue({ status: 'idle' });

    service.getPreviewStatus(projectId);

    expect(dynamicPreview.start).not.toHaveBeenCalled();
  });

  it('does not relaunch the preview after a failed turn', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    agent.lastHandle.subject.next({ type: 'exit', code: 1 });
    agent.lastHandle.subject.complete();
    dynamicPreview.getStatus.mockReturnValue({ status: 'idle' });

    service.getPreviewStatus(projectId);

    expect(dynamicPreview.start).not.toHaveBeenCalled();
  });

  it('does not relaunch when something is already tracked (not idle)', () => {
    const { projectId } = service.start({
      prompt: 'a full app',
      name: 'App',
      siteType: 'dynamic',
    });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();
    dynamicPreview.start.mockClear();
    dynamicPreview.getStatus.mockReturnValue({ status: 'building' });

    service.getPreviewStatus(projectId);

    expect(dynamicPreview.start).not.toHaveBeenCalled();
  });

  /** Regression coverage for a real bug report: a turn left permanently
   *  "running" (e.g. the backend process that was executing it restarted
   *  mid-turn) rendered as an instant, unexplained "Failed" in the chat
   *  with no way to retry - see healOrphanedTurn in
   *  project-generator.service.ts. A fresh ProjectGeneratorService instance
   *  (empty `jobs` Map) pointed at the same on-disk project stands in for
   *  "the backend restarted" without actually restarting a process. */
  async function freshServiceInstance(): Promise<ProjectGeneratorService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectGeneratorService,
        {
          provide: AgentServiceRegistry,
          useValue: { get: () => agent } as unknown as AgentServiceRegistry,
        },
        {
          provide: SettingsService,
          useValue: { getDefault: () => ({ provider: 'claude' as const }) } as unknown as SettingsService,
        },
        { provide: DynamicPreviewService, useValue: dynamicPreview },
      ],
    }).compile();
    return moduleRef.get(ProjectGeneratorService);
  }

  it('heals a turn stuck "running" with no backing job into "failed", with an explanatory event', async () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Site' });
    // Never send an exit/complete - this turn is left "running" forever,
    // exactly like an in-flight job whose process died with the backend.

    const freshService = await freshServiceInstance();
    const healed = freshService.getProject(projectId);

    expect(healed.turns[0].status).toBe('failed');
    expect(healed.turns[0].events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('interrupted'),
    });
    // Persisted to disk, not just patched for this one response.
    expect(service.getProject(projectId).turns[0].status).toBe('failed');
  });

  it('leaves a turn "running" alone when its job is still actually tracked', () => {
    const { projectId } = service.start({ prompt: 'a site', name: 'Site' });
    // Same service instance - the job is still tracked as running.
    expect(service.getProject(projectId).turns[0].status).toBe('running');
  });

  it('does not touch a turn that already completed or failed', () => {
    const { projectId: completedId } = service.start({ prompt: 'a', name: 'A' });
    agent.lastHandle.subject.next({ type: 'exit', code: 0 });
    agent.lastHandle.subject.complete();

    const { projectId: failedId } = service.start({ prompt: 'b', name: 'B' });
    agent.lastHandle.subject.next({ type: 'exit', code: 1 });
    agent.lastHandle.subject.complete();

    expect(service.getProject(completedId).turns[0].status).toBe('completed');
    expect(service.getProject(failedId).turns[0].status).toBe('failed');
  });
});
