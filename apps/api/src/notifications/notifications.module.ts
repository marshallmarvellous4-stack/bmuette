import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { Notifications } from './notifications.service';

@Global()
@Module({ controllers: [NotificationsController], providers: [Notifications], exports: [Notifications] })
export class NotificationsModule {}
