import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProjectGeneratorModule } from './features/project-generator/project-generator.module';

@Module({
  imports: [
    ProjectGeneratorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}