import { Controller, Get, Inject, Injectable, Logger, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Db } from '../db/db.service';
import { ENV, Env } from '../config/env';

const DIR = join(__dirname, '..', '..', 'assets', 'sounds');
const view = (r: any) => ({ id: r.id, title: r.title, artist: r.artist, mood: r.mood, bpm: r.bpm, durationMs: r.duration_ms, color: r.color, url: r.url, uses: r.use_count });

@Injectable()
export class SoundsService implements OnModuleInit {
  private log = new Logger('Sounds');
  constructor(private db: Db, @Inject(ENV) private env: Env) {}

  // The starter library lives in assets/sounds. Every start we make sure each track is in the database with the right address.
  async onModuleInit() {
    const manifest = join(DIR, 'manifest.json');
    if (!existsSync(manifest)) return;
    const base = this.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    for (const t of JSON.parse(readFileSync(manifest, 'utf8')) as any[]) {
      await this.db.query(
        `insert into sounds (file, title, artist, mood, bpm, duration_ms, color, url) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (file) do update set title=excluded.title, artist=excluded.artist, mood=excluded.mood, bpm=excluded.bpm, duration_ms=excluded.duration_ms, color=excluded.color, url=excluded.url`,
        [t.file, t.title, t.artist, t.mood, t.bpm, t.durationMs, t.color, `${base}/assets/sounds/${t.file}`]);
    }
    this.log.log('sound library ready');
  }

  async list(q?: string) {
    const term = (q ?? '').trim().toLowerCase();
    const rows = await this.db.query(
      `select * from sounds where $1 = '' or lower(title) like '%' || $1 || '%' or lower(coalesce(mood,'')) like '%' || $1 || '%' order by use_count desc, title limit 60`, [term]);
    return { items: rows.map(view) };
  }
  async get(id: string) {
    const r = await this.db.one(`select * from sounds where id = $1`, [id]);
    if (!r) throw new NotFoundException('Sound not found');
    return view(r);
  }
}

@Controller('sounds')
export class SoundsController {
  constructor(private s: SoundsService) {}
  @Get() list(@Query('q') q?: string) { return this.s.list(q); }
  @Get(':id') one(@Param('id', ParseUUIDPipe) id: string) { return this.s.get(id); }
}

@Module({ controllers: [SoundsController], providers: [SoundsService], exports: [SoundsService] })
export class SoundsModule {}
