import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BrowserModule } from './browser/browser.module';
import { ResponseInterceptor } from './common/api/response.interceptor';
import { CacheModule } from './common/cache/cache.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import configuration from './config/configuration';
import { SkillsModule } from './skills/skills.module';
import { StorageModule } from './storage/storage.module';
import { DouyinModule } from './douyin/douyin.module';
import { XhsModule } from './xhs/xhs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
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
    SkillsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
