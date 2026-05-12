import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // 接管 Nest 默认 logger 为 pino，所有日志都带 traceId
  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  // 拦截器 / 守卫 / 过滤器已通过 APP_* token 注册在 AppModule
  app.enableShutdownHooks();
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Trace-Id'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SuperCrawler')
    .setDescription(
      'Xiaohongshu scraper API for OpenClaw agent — REST + MCP, see /api/skills/manifest',
    )
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'apiKey')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, doc);

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 5510;
  await app.listen(port);
  Logger.log(
    `supercrawler running on http://localhost:${port}/api (docs: /docs, manifest: /api/skills/manifest)`,
    'Bootstrap',
  );
}

void bootstrap();
