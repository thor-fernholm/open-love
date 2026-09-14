import {
  Body,
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { GenerateProjectDto } from './dto/generate-project.dto';
import { ProjectGeneratorService } from './project-generator.service';
import type { ProjectDetail, ProjectSummary } from './project.types';

@Controller('project-generator')
export class ProjectGeneratorController {
  constructor(private readonly projectGenerator: ProjectGeneratorService) {}

  @Post()
  start(
    @Body() dto: GenerateProjectDto,
  ): { jobId: string; projectId: string } {
    return this.projectGenerator.start(dto);
  }

  @Get('projects')
  listProjects(): ProjectSummary[] {
    return this.projectGenerator.listProjects();
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string): ProjectDetail {
    return this.projectGenerator.getProject(id);
  }

  @Sse(':id/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return this.projectGenerator
      .stream(id)
      .pipe(map((event) => ({ type: event.type, data: event })));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string): { cancelled: true } {
    this.projectGenerator.cancel(id);
    return { cancelled: true };
  }
}
