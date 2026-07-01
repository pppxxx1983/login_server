import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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

@Controller('auto-match-config')
@UseGuards(AdminTokenGuard)
export class AutoMatchConfigController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async getConfig() {
    const [rows]: any = await this.db.pool.query(
      'SELECT pair_count AS pairCount, chance FROM auto_match_config WHERE pair_count BETWEEN 1 AND 8 ORDER BY pair_count DESC',
    );
    const chances: Record<number, number> = {};
    for (let i = 1; i <= 8; i += 1) {
      chances[i] = DEFAULT_CHANCES[i];
    }
    for (const row of rows || []) {
      const pairCount = Number(row.pairCount);
      if (pairCount >= 1 && pairCount <= 8) {
        chances[pairCount] = Number(row.chance);
      }
    }
    return { chances };
  }

  @Post()
  async setConfig(@Body() body: { chances?: Record<number, number> }) {
    const chances = body && typeof body.chances === 'object' ? body.chances : {};
    const values: any[] = [];
    for (let i = 1; i <= 8; i += 1) {
      const raw = chances[i];
      const chance = typeof raw === 'number' && !isNaN(raw) ? Math.max(0, Math.min(1, raw)) : DEFAULT_CHANCES[i];
      values.push([i, chance]);
    }
    await this.db.pool.query(
      'INSERT INTO auto_match_config (pair_count, chance) VALUES ? ON DUPLICATE KEY UPDATE chance=VALUES(chance)',
      [values],
    );
    return this.getConfig();
  }

  @Post('reset')
  async resetConfig() {
    const values = Object.keys(DEFAULT_CHANCES).map((pairCount) => [Number(pairCount), DEFAULT_CHANCES[Number(pairCount)]]);
    await this.db.pool.query(
      'INSERT INTO auto_match_config (pair_count, chance) VALUES ? ON DUPLICATE KEY UPDATE chance=VALUES(chance)',
      [values],
    );
    return this.getConfig();
  }
}
