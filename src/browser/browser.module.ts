import { Global, Module } from '@nestjs/common';
import { BrowserService } from './browser.service';
import { PageFactoryService } from './page-factory.service';

@Global()
@Module({
  providers: [BrowserService, PageFactoryService],
  exports: [BrowserService, PageFactoryService],
})
export class BrowserModule {}
