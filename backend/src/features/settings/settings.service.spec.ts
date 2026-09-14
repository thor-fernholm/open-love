import { jest } from '@jest/globals';
import { rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let settingsFile: string;

  beforeEach(() => {
    settingsFile = join(tmpdir(), `openlove-settings-test-${Date.now()}.json`);
    process.env.SETTINGS_FILE = settingsFile;
    service = new SettingsService();
  });

  afterEach(() => {
    delete process.env.SETTINGS_FILE;
    rmSync(settingsFile, { force: true });
    jest.restoreAllMocks();
  });

  it('defaults to Claude Haiku when no settings file exists yet', () => {
    expect(service.getDefault()).toEqual({ provider: 'claude', model: 'haiku' });
  });

  it('round-trips a persisted selection', () => {
    service.setDefault({ provider: 'ollama', model: 'gemma3:4b' });
    expect(service.getDefault()).toEqual({
      provider: 'ollama',
      model: 'gemma3:4b',
    });
  });

  it('falls back to the default if the settings file is corrupt', () => {
    service.setDefault({ provider: 'ollama', model: 'gemma3:4b' });
    writeFileSync(settingsFile, 'not json');
    expect(service.getDefault()).toEqual({ provider: 'claude', model: 'haiku' });
  });

  it('reports Ollama unavailable rather than throwing when unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await service.listOllamaModels()).toEqual({
      available: false,
      models: [],
    });
  });

  it('lists installed models with a best-effort tool-support hint', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ models: [{ name: 'gemma3:4b' }] }), {
          status: 200,
        }),
      )
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ capabilities: ['tools'] }), {
          status: 200,
        }),
      );
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as never);

    const result = await service.listOllamaModels();
    expect(result).toEqual({
      available: true,
      models: [{ name: 'gemma3:4b', supportsTools: true }],
    });
  });
});
