import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createPreviewMiddleware } from './features/project-generator/preview.middleware';
import { ProjectGeneratorService } from './features/project-generator/project-generator.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // allow the Vite frontend (port 5173) to call the API
  // Raw Express middleware, not a controller route - see preview.middleware.ts.
  app.use(createPreviewMiddleware(app.get(ProjectGeneratorService)));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
