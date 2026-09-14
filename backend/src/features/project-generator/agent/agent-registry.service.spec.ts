import { AgentServiceRegistry } from './agent-registry.service';
import { ClaudeCliService } from './claude-cli.service';
import { SdkAgentService } from './sdk-agent.service';

describe('AgentServiceRegistry', () => {
  it("resolves 'claude' to ClaudeCliService and 'ollama' to SdkAgentService", () => {
    const claude = new ClaudeCliService();
    const sdk = new SdkAgentService();
    const registry = new AgentServiceRegistry(claude, sdk);

    expect(registry.get('claude')).toBe(claude);
    expect(registry.get('ollama')).toBe(sdk);
  });
});
