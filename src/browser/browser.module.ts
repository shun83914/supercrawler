import { Global, Module } from '@nestjs/common';
import { BrowserService } from './browser.service';
import { BrowserController } from './browser.controller';
import { PageFactoryService } from './page-factory.service';

@Global()
@Module({
  controllers: [BrowserController],
  providers: [BrowserService, PageFactoryService],
  exports: [BrowserService, PageFactoryService],
})
export class BrowserModule {}
