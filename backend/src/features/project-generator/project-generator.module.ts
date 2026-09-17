import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AgentServiceRegistry } from './agent/agent-registry.service';
import { ClaudeCliService } from './agent/claude-cli.service';
import { SdkAgentService } from './agent/sdk-agent.service';
import { DynamicPreviewService } from './dynamic-preview.service';
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
    // The live-preview process manager for 'dynamic' projects - main.ts
    // also grabs this instance directly (app.get) for the preview
    // middleware, same pattern as ProjectGeneratorService itself.
    DynamicPreviewService,
  ],
  exports: [DynamicPreviewService, ProjectGeneratorService],
})
export class ProjectGeneratorModule {}
