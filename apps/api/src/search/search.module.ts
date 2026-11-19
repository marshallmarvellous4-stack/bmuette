import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { PostsModule } from '../posts/posts.module';
import { SearchController } from './search.controller';
import { TagsController, TagsService } from './tags.controller';
import { SearchService } from './search.service';

@Module({ imports: [PostsModule, MarketModule], controllers: [SearchController, TagsController], providers: [SearchService, TagsService] })
export class SearchModule {}
