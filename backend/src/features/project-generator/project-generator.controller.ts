import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Patch,
  Post,
  Sse,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { map, Observable } from 'rxjs';
import { GenerateProjectDto } from './dto/generate-project.dto';
import { RenameProjectDto } from './dto/rename-project.dto';
import type { PreviewState } from './dynamic-preview.service';
import { ProjectGeneratorService } from './project-generator.service';
import type { ProjectDetail, ProjectSummary } from './project.types';

@Controller('project-generator')
export class ProjectGeneratorController {
  constructor(private readonly projectGenerator: ProjectGeneratorService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 5, { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  start(
    @Body() dto: GenerateProjectDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): { jobId: string; projectId: string } {
    return this.projectGenerator.start(dto, files);
  }

  @Get('projects')
  listProjects(): ProjectSummary[] {
    return this.projectGenerator.listProjects();
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string): ProjectDetail {
    return this.projectGenerator.getProject(id);
  }

  @Get('projects/:id/export')
  exportProject(@Param('id') id: string): StreamableFile {
    return this.projectGenerator.exportProject(id);
  }

  /** Polled by the frontend while a 'dynamic' project's live preview is
   *  coming up (installing/generating/building/starting) - see
   *  dynamic-preview.service.ts. Always 'idle' for a 'static' project. */
  @Get('projects/:id/preview-status')
  getPreviewStatus(@Param('id') id: string): PreviewState {
    return this.projectGenerator.getPreviewStatus(id);
  }

  @Patch('projects/:id')
  renameProject(
    @Param('id') id: string,
    @Body() dto: RenameProjectDto,
  ): ProjectSummary {
    return this.projectGenerator.renameProject(id, dto.name);
  }

  @Delete('projects/:id')
  @HttpCode(200)
  deleteProject(@Param('id') id: string): { deleted: true } {
    this.projectGenerator.deleteProject(id);
    return { deleted: true };
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
