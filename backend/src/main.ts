import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Agent, setGlobalDispatcher } from 'undici';
import { AppModule } from './app.module';
import { createPreviewMiddleware } from './features/project-generator/preview.middleware';
import { ProjectGeneratorService } from './features/project-generator/project-generator.service';

// Local model inference (Ollama, via SdkAgentService) can take much longer
// per request than undici's default fetch timeouts (5 minutes for both
// headers and body) - without raising these, a slow generation step fails
// with an opaque "fetch failed" regardless of any timeout configured at
// the AI SDK call site, since that's a higher-level abstraction that
// doesn't override undici's own connection-level defaults. This affects
// every fetch() in the process (also used by SettingsService's Ollama
// calls), which is exactly the point - it's a process-wide default, not
// something to configure per call site.
setGlobalDispatcher(
  new Agent({ headersTimeout: 20 * 60 * 1000, bodyTimeout: 20 * 60 * 1000 }),
);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // allow the Vite frontend (port 5173) to call the API
  // Raw Express middleware, not a controller route - see preview.middleware.ts.
  app.use(createPreviewMiddleware(app.get(ProjectGeneratorService)));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
