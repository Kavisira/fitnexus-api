import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, text } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Default Express JSON body limit (100kb) is too small for a monthly
  // progress photo sent as a base64 data URL in the check-in payload
  // (see MembersService.addMetricEntry) — bumped just enough for a
  // client-side-compressed photo, not raw uploads.
  app.use(json({ limit: '4mb' }));

  // ADMS biometric devices POST attendance logs as plain tab-separated
  // text, not JSON — Express's json() parser silently leaves req.body
  // undefined for that content type, so /iclock/* gets its own text
  // body parser ahead of everything else.
  app.use('/iclock', text({ type: () => true, limit: '2mb' }));

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

  // Excluded from the /api prefix: biometric ADMS devices are hardcoded
  // in firmware to call exactly /iclock/cdata and /iclock/getrequest,
  // with no way to configure an extra path segment on the device side.
  app.setGlobalPrefix('api', { exclude: ['iclock/cdata', 'iclock/getrequest'] });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`FitNexus API listening on http://localhost:${port}/api`);
}

bootstrap();
