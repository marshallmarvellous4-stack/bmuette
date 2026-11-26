import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { EmbeddingService } from '../search/embedding.service';
import { CollectionsController } from './collections.controller';
import { InteractionsService } from './interactions.service';
import { InterestService } from './interests.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [MediaModule],
  controllers: [PostsController, CollectionsController],
  providers: [PostsService, InteractionsService, InterestService, EmbeddingService],
  exports: [PostsService, InterestService, EmbeddingService, InteractionsService],
})
export class PostsModule {}
