import * as dotenv from 'dotenv';
import * as dotenvExpand from 'dotenv-expand';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BrowserModule } from './browser/browser.module';
import { BrowserController } from './browser/browser.controller';
import { ResponseInterceptor } from './common/api/response.interceptor';
import { CacheModule } from './common/cache/cache.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import configuration from './config/configuration';
import { SkillsModule } from './skills/skills.module';
import { StorageModule } from './storage/storage.module';
import { DouyinModule } from './douyin/douyin.module';
import { XhsModule } from './xhs/xhs.module';
import { MeituanModule } from './meituan/meituan.module';

// 加载 .env 并支持变量引用语法 ${VAR}
const envResult = dotenv.config({ path: '.env' });
dotenvExpand.expand(envResult);

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath:'.env',
      isGlobal: true,
      load: [configuration],
      cache: true,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL || 'info',
          autoLogging: true,
          genReqId: (req) =>
            (req.headers['x-trace-id'] as string | undefined) ?? uuidv4(),
          customProps: (req) => ({ traceId: (req as { id?: string }).id }),
          transport:
            process.env.NODE_ENV === 'production'
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
                },
        },
      }),
    }),
    CacheModule,
    BrowserModule,
    StorageModule,
    AuthModule,
    XhsModule,
    DouyinModule,
    MeituanModule,
    SkillsModule,
  ],
  controllers: [AppController, BrowserController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
