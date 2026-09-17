import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DynamicPreviewService } from './dynamic-preview.service';

/**
 * The pipeline itself (npm install / prisma generate / build / start) is
 * real child-process orchestration against a real filesystem path - not
 * meaningfully unit-testable without either a slow real npm project or
 * mocking away the entire point of the class. That path is covered by the
 * manual live end-to-end run instead (create a dynamic project, watch it
 * actually come up). What's tested here is the state-tracking surface
 * that doesn't require spawning anything.
 */
describe('DynamicPreviewService', () => {
  let service: DynamicPreviewService;

  beforeEach(() => {
    service = new DynamicPreviewService();
  });

  it('reports idle for a project nothing has ever been started for', () => {
    expect(service.getStatus('unknown-project')).toEqual({ status: 'idle' });
  });

  it('is a safe no-op to stop a project with no tracked preview', () => {
    expect(() => service.stop('unknown-project')).not.toThrow();
    expect(service.getStatus('unknown-project')).toEqual({ status: 'idle' });
  });

  /**
   * Regression coverage for the backend-restart speedup: a self-heal
   * reconnect should skip straight to `npm run start` (via
   * hasFreshBuild/fastResumeIfBuiltAfter in start()) only when there's
   * real proof the on-disk build already reflects the last completed
   * turn's code - never on a hunch. hasFreshBuild is private; reached
   * directly here since it's pure filesystem logic with no process
   * spawning, unlike the rest of this class (see the class comment above).
   */
  describe('hasFreshBuild (private - the fast-resume proof check)', () => {
    let projectPath: string;

    function hasFreshBuild(notBefore?: string): boolean {
      return (
        service as unknown as {
          hasFreshBuild(path: string, notBefore?: string): boolean;
        }
      ).hasFreshBuild(projectPath, notBefore);
    }

    beforeEach(() => {
      projectPath = join(tmpdir(), `openlove-preview-test-${Date.now()}`);
      mkdirSync(projectPath, { recursive: true });
    });

    afterEach(() => {
      rmSync(projectPath, { recursive: true, force: true });
    });

    it('is false when no timestamp to compare against was given', () => {
      expect(hasFreshBuild(undefined)).toBe(false);
    });

    it('is false when node_modules was never installed', () => {
      mkdirSync(join(projectPath, '.next'), { recursive: true });
      writeFileSync(join(projectPath, '.next', 'BUILD_ID'), 'x');
      expect(hasFreshBuild(new Date().toISOString())).toBe(false);
    });

    it('is false when there is no build at all (BUILD_ID missing)', () => {
      mkdirSync(join(projectPath, 'node_modules'), { recursive: true });
      expect(hasFreshBuild(new Date().toISOString())).toBe(false);
    });

    it('is true when the build postdates the last completed turn', () => {
      mkdirSync(join(projectPath, 'node_modules'), { recursive: true });
      mkdirSync(join(projectPath, '.next'), { recursive: true });
      const buildIdPath = join(projectPath, '.next', 'BUILD_ID');
      writeFileSync(buildIdPath, 'x');
      const turnFinishedAt = new Date(Date.now() - 60_000).toISOString();
      utimesSync(buildIdPath, new Date(), new Date()); // mtime = now, after the turn

      expect(hasFreshBuild(turnFinishedAt)).toBe(true);
    });

    it('is false when the build predates the last completed turn (stale - a real rebuild is needed)', () => {
      mkdirSync(join(projectPath, 'node_modules'), { recursive: true });
      mkdirSync(join(projectPath, '.next'), { recursive: true });
      const buildIdPath = join(projectPath, '.next', 'BUILD_ID');
      writeFileSync(buildIdPath, 'x');
      const staleBuildTime = new Date(Date.now() - 60_000);
      utimesSync(buildIdPath, staleBuildTime, staleBuildTime);
      const turnFinishedAt = new Date().toISOString(); // the turn finished after that build

      expect(hasFreshBuild(turnFinishedAt)).toBe(false);
    });
  });
});
