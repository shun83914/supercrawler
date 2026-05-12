import { Global, Module } from '@nestjs/common';
import { ScrapeCacheService } from './scrape-cache.service';

@Global()
@Module({
  providers: [ScrapeCacheService],
  exports: [ScrapeCacheService],
})
export class CacheModule {}
