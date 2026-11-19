import { Global, Module } from '@nestjs/common';
import { Hub } from './hub';

// One shared Hub for the whole app, so notifications and chat push through the same connections.
@Global()
@Module({ providers: [Hub], exports: [Hub] })
export class HubModule {}
