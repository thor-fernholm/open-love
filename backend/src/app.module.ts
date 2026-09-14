import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProjectContentModule } from './features/project-content/project-content.module';
import { ProjectGeneratorModule } from './features/project-generator/project-generator.module';

@Module({
  imports: [ProjectGeneratorModule, ProjectContentModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}