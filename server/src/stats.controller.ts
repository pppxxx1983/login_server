import { Controller, Get, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

@Controller('stats')
@UseGuards(AdminTokenGuard)
export class StatsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('summary')
  async summary() {
    const [[players]]: any = await this.db.pool.query('SELECT COUNT(*) AS total FROM player_profiles');
    const [[users]]: any = await this.db.pool.query('SELECT COUNT(*) AS total FROM game_users');
    const [[scores]]: any = await this.db.pool.query('SELECT COUNT(*) AS total FROM level_scores');
    const [[daily]]: any = await this.db.pool.query('SELECT COUNT(*) AS total FROM daily_special_scores');
    const [[events]]: any = await this.db.pool.query('SELECT COUNT(*) AS total FROM tracking_events');

    return {
      totalPlayers: Number(players.total),
      totalGameUsers: Number(users.total),
      totalLevelScores: Number(scores.total),
      totalDailyRecords: Number(daily.total),
      totalTrackingEvents: Number(events.total),
    };
  }
}
