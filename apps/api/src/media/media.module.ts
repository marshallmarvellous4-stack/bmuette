import { Module } from '@nestjs/common';
import { DevUploadController, MediaController } from './media.controller';
import { MediaService } from './media.service';
import { Storage } from './storage';
import { VideoProvider } from './video';

@Module({
  controllers: [MediaController, DevUploadController],
  providers: [MediaService, Storage, VideoProvider],
  exports: [MediaService, Storage, VideoProvider],
})
export class MediaModule {}
