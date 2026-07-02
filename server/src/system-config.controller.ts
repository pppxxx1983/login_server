import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

const DEFAULT_CHANCES: Record<number, number> = {
  8: 0.25,
  7: 0.40,
  6: 0.60,
  5: 0.80,
  4: 0,
  3: 0,
  2: 0,
  1: 0,
};

const DEFAULT_AGE_SEGMENTS: Record<string, string> = {
  age_segment_1: '0-35',
  age_segment_2: '35-55',
  age_segment_3: '55+',
};

@Controller('system-config')
@UseGuards(AdminTokenGuard)
export class SystemConfigController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async getConfig() {
    const [chanceRows]: any = await this.db.pool.query(
      'SELECT pair_count AS pairCount, chance FROM auto_match_config WHERE pair_count BETWEEN 1 AND 8 ORDER BY pair_count DESC',
    );
    const chances: Record<number, number> = {};
    for (let i = 1; i <= 8; i += 1) {
      chances[i] = DEFAULT_CHANCES[i];
    }
    for (const row of chanceRows || []) {
      const pairCount = Number(row.pairCount);
      if (pairCount >= 1 && pairCount <= 8) {
        chances[pairCount] = Number(row.chance);
      }
    }

    const [segmentRows]: any = await this.db.pool.query(
      'SELECT config_key AS configKey, config_value AS configValue FROM system_config WHERE config_key IN (?, ?, ?)',
      Object.keys(DEFAULT_AGE_SEGMENTS),
    );
    const ageSegments: Record<string, string> = { ...DEFAULT_AGE_SEGMENTS };
    for (const row of segmentRows || []) {
      const key = String(row.configKey);
      if (DEFAULT_AGE_SEGMENTS[key] !== undefined) {
        ageSegments[key] = String(row.configValue || DEFAULT_AGE_SEGMENTS[key]);
      }
    }

    return { chances, ageSegments };
  }

  @Post()
  async setConfig(@Body() body: { chances?: Record<number, number>; ageSegments?: Record<string, string> }) {
    const chances = body && typeof body.chances === 'object' ? body.chances : {};
    const chanceValues: any[] = [];
    for (let i = 1; i <= 8; i += 1) {
      const raw = chances[i];
      const chance = typeof raw === 'number' && !isNaN(raw) ? Math.max(0, Math.min(1, raw)) : DEFAULT_CHANCES[i];
      chanceValues.push([i, chance]);
    }
    await this.db.pool.query(
      'INSERT INTO auto_match_config (pair_count, chance) VALUES ? ON DUPLICATE KEY UPDATE chance=VALUES(chance)',
      [chanceValues],
    );

    const ageSegments = body && typeof body.ageSegments === 'object' ? body.ageSegments : {};
    const segmentValues: any[] = [];
    for (const key of Object.keys(DEFAULT_AGE_SEGMENTS)) {
      const value = typeof ageSegments[key] === 'string' ? ageSegments[key].trim() : DEFAULT_AGE_SEGMENTS[key];
      segmentValues.push([key, value || DEFAULT_AGE_SEGMENTS[key]]);
    }
    if (segmentValues.length) {
      await this.db.pool.query(
        'INSERT INTO system_config (config_key, config_value) VALUES ? ON DUPLICATE KEY UPDATE config_value=VALUES(config_value)',
        [segmentValues],
      );
    }

    return this.getConfig();
  }

  @Post('reset')
  async resetConfig() {
    return this.resetAll();
  }

  @Post('reset/auto-match')
  async resetAutoMatch() {
    const chanceValues = Object.keys(DEFAULT_CHANCES).map((pairCount) => [Number(pairCount), DEFAULT_CHANCES[Number(pairCount)]]);
    await this.db.pool.query(
      'INSERT INTO auto_match_config (pair_count, chance) VALUES ? ON DUPLICATE KEY UPDATE chance=VALUES(chance)',
      [chanceValues],
    );
    return this.getConfig();
  }

  @Post('reset/age-segments')
  async resetAgeSegments() {
    const segmentValues = Object.keys(DEFAULT_AGE_SEGMENTS).map((key) => [key, DEFAULT_AGE_SEGMENTS[key]]);
    await this.db.pool.query(
      'INSERT INTO system_config (config_key, config_value) VALUES ? ON DUPLICATE KEY UPDATE config_value=VALUES(config_value)',
      [segmentValues],
    );
    return this.getConfig();
  }

  private async resetAll() {
    const chanceValues = Object.keys(DEFAULT_CHANCES).map((pairCount) => [Number(pairCount), DEFAULT_CHANCES[Number(pairCount)]]);
    await this.db.pool.query(
      'INSERT INTO auto_match_config (pair_count, chance) VALUES ? ON DUPLICATE KEY UPDATE chance=VALUES(chance)',
      [chanceValues],
    );

    const segmentValues = Object.keys(DEFAULT_AGE_SEGMENTS).map((key) => [key, DEFAULT_AGE_SEGMENTS[key]]);
    await this.db.pool.query(
      'INSERT INTO system_config (config_key, config_value) VALUES ? ON DUPLICATE KEY UPDATE config_value=VALUES(config_value)',
      [segmentValues],
    );

    return this.getConfig();
  }
}
