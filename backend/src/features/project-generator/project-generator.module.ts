import { Module } from '@nestjs/common';
import { AGENT_SERVICE } from './agent/agent-service.interface';
import { ClaudeCliService } from './agent/claude-cli.service';
import { ProjectGeneratorController } from './project-generator.controller';
import { ProjectGeneratorService } from './project-generator.service';

@Module({
  controllers: [ProjectGeneratorController],
  providers: [
    ProjectGeneratorService,
    // Strategy Pattern binding: swap ClaudeCliService for another
    // IAgentService implementation here to change coding agents.
    { provide: AGENT_SERVICE, useClass: ClaudeCliService },
  ],
})
export class ProjectGeneratorModule {}
