import { Injectable } from '@nestjs/common';
import type { AgentProvider } from '../project.types';
import { ClaudeCliService } from './claude-cli.service';
import type { IAgentService } from './agent-service.interface';
import { SdkAgentService } from './sdk-agent.service';

/**
 * Picks the IAgentService strategy for a given provider - the runtime
 * equivalent of the fixed AGENT_SERVICE DI binding this replaced. Adding a
 * vendor later (OpenAI, Gemini) means adding a case here, not a new loop -
 * see SdkAgentService, which those providers plug into the same way Ollama
 * does today.
 */
@Injectable()
export class AgentServiceRegistry {
  constructor(
    private readonly claude: ClaudeCliService,
    private readonly sdk: SdkAgentService,
  ) {}

  get(provider: AgentProvider): IAgentService {
    return provider === 'ollama' ? this.sdk : this.claude;
  }
}
