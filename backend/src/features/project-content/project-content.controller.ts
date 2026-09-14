import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ProjectContent } from './content.types';
import { ProjectContentService } from './project-content.service';

@Controller('project-content')
export class ProjectContentController {
  constructor(private readonly projectContent: ProjectContentService) {}

  @Get(':id')
  getAll(@Param('id') id: string): ProjectContent {
    return this.projectContent.getAll(id);
  }

  @Put(':id/:name')
  update(
    @Param('id') id: string,
    @Param('name') name: string,
    @Body() body: unknown,
  ): { updated: true } {
    this.projectContent.update(id, name, body);
    return { updated: true };
  }

  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): { path: string } {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const path = this.projectContent.saveUpload(id, file.originalname, file.buffer);
    return { path };
  }
}
