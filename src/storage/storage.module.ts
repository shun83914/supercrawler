import { Global, Module } from '@nestjs/common';
import { FileNamingService } from './file-naming.service';
import { JsonlReaderService } from './jsonl-reader.service';
import { JsonlWriterService } from './jsonl-writer.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  controllers: [StorageController],
  providers: [FileNamingService, JsonlWriterService, JsonlReaderService],
  exports: [FileNamingService, JsonlWriterService, JsonlReaderService],
})
export class StorageModule {}
