import {
  Body,
  Controller,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { GenerateProjectDto } from './dto/generate-project.dto';
import { ProjectGeneratorService } from './project-generator.service';

@Controller('project-generator')
export class ProjectGeneratorController {
  constructor(private readonly projectGenerator: ProjectGeneratorService) {}

  @Post()
  start(@Body() dto: GenerateProjectDto): { jobId: string } {
    return this.projectGenerator.start(dto);
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
