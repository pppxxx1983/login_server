import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.useStaticAssets(join(__dirname, '..', '..', 'web', 'dist'));
  app.enableCors({ origin: true, allowedHeaders: ['Content-Type', 'Authorization'] });
  const host = process.env.ADMIN_API_HOST || '127.0.0.1';
  const port = Number(process.env.ADMIN_API_PORT || 8791);
  await app.listen(port, host);
  console.log(`Analytics UI listening on http://${host}:${port}`);
  console.log(`Analytics API listening on http://${host}:${port}/api`);
}

bootstrap();
