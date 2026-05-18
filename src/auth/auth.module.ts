import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginMetadataService } from './login-metadata.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginMetadataService],
  exports: [AuthService],
})
export class AuthModule {}
