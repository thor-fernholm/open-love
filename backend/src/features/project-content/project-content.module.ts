import { Module } from '@nestjs/common';
import { ProjectContentController } from './project-content.controller';
import { ProjectContentService } from './project-content.service';

@Module({
  controllers: [ProjectContentController],
  providers: [ProjectContentService],
})
export class ProjectContentModule {}
