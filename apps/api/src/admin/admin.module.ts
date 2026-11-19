import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthGuard } from '../common/auth.guard';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { ErrorLogFilter } from './errors.filter';
import { ModerationService } from './moderation.service';

@Module({
  
  controllers: [AdminController],
  providers: [AdminService, ModerationService, AdminGuard, AuthGuard, { provide: APP_FILTER, useClass: ErrorLogFilter }],
})
export class AdminModule {}
