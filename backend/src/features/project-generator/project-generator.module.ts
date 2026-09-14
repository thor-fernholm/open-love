import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AgentServiceRegistry } from './agent/agent-registry.service';
import { ClaudeCliService } from './agent/claude-cli.service';
import { SdkAgentService } from './agent/sdk-agent.service';
import { ProjectGeneratorController } from './project-generator.controller';
import { ProjectGeneratorService } from './project-generator.service';

@Module({
  imports: [SettingsModule],
  controllers: [ProjectGeneratorController],
  providers: [
    ProjectGeneratorService,
    // Strategy Pattern: AgentServiceRegistry picks between these at
    // request time (see resolveSelection) rather than a single fixed
    // binding - this is what makes the provider swappable at runtime.
    ClaudeCliService,
    SdkAgentService,
    AgentServiceRegistry,
  ],
})
export class ProjectGeneratorModule {}
