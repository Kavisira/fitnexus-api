import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Default Express JSON body limit (100kb) is too small for a monthly
  // progress photo sent as a base64 data URL in the check-in payload
  // (see MembersService.addMetricEntry) — bumped just enough for a
  // client-side-compressed photo, not raw uploads.
  app.use(json({ limit: '4mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const origins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  app.setGlobalPrefix('api');

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`FitNexus API listening on http://localhost:${port}/api`);
}

bootstrap();
