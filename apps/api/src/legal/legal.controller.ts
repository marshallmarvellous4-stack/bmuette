import { Controller, Get, Header, Inject, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { communityPage, privacyPage, termsPage, TERMS_VERSION } from './legal.pages';

// Public pages, so the app stores can link to them and the app can open them in a browser.
@Controller('legal')
export class LegalController {
  constructor(@Inject(ENV) private env: Env) {}
  private ctx() { return { entity: this.env.LEGAL_ENTITY_NAME, support: this.env.SUPPORT_EMAIL }; }

  @Get('terms') @Header('Content-Type', 'text/html; charset=utf-8') terms() { return termsPage(this.ctx()); }
  @Get('privacy') @Header('Content-Type', 'text/html; charset=utf-8') privacy() { return privacyPage(this.ctx()); }
  @Get('community') @Header('Content-Type', 'text/html; charset=utf-8') community() { return communityPage(this.ctx()); }
  @Get('version') version() { return { version: TERMS_VERSION, minAge: this.env.MIN_AGE }; }
}

@Module({ controllers: [LegalController] })
export class LegalModule {}
