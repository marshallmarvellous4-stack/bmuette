import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

@Module({ imports: [PostsModule], controllers: [MarketController], providers: [MarketService], exports: [MarketService] })
export class MarketModule {}
