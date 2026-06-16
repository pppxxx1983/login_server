import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

@Controller('rankings')
@UseGuards(AdminTokenGuard)
export class RankingsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('daily')
  async daily(@Query('date') date?: string, @Query('limit') limit = '100') {
    let rankDate = date;
    if (!rankDate) {
      const [dates]: any = await this.db.pool.query('SELECT MAX(rank_date) AS rankDate FROM daily_special_scores');
      rankDate = dates[0].rankDate || new Date().toISOString().slice(0, 10);
    }
    const effectiveDate = String(rankDate);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const [rows]: any = await this.db.pool.query(
      `SELECT d.player_id AS playerId, COALESCE(p.name, d.display_name, '') AS name,
              p.avatar_id AS avatarId, p.avatar_frame_id AS avatarFrameId,
              d.level, d.score, d.combo, d.special_score AS specialScore,
              d.time_ms AS timeMs, d.updated_at AS updatedAt
       FROM daily_special_scores d
       LEFT JOIN player_profiles p ON p.player_id = d.player_id
       WHERE d.rank_date = ? AND d.special_score > 0
       ORDER BY d.special_score DESC, d.time_ms ASC, d.updated_at ASC LIMIT ?`,
      [effectiveDate, safeLimit]
    );
    return { date: effectiveDate, items: rows.map((row: any, index: number) => ({ rank: index + 1, ...row })) };
  }

  @Get('levels')
  async levels(@Query('level') level = '1', @Query('limit') limit = '100') {
    const safeLevel = Math.max(1, Number(level) || 1);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const [rows]: any = await this.db.pool.query(
      `WITH ranked_scores AS (
         SELECT s.*,
                ROW_NUMBER() OVER (
                  PARTITION BY s.player_id
                  ORDER BY s.score DESC, s.combo DESC, s.time_ms ASC, s.created_at ASC
                ) AS row_num,
                COUNT(*) OVER (PARTITION BY s.player_id) AS attempts
         FROM level_scores s WHERE s.level = ?
       )
       SELECT s.player_id AS playerId, COALESCE(p.name, s.display_name, '') AS name,
              s.score, s.combo, s.time_ms AS timeMs, s.attempts, s.created_at AS updatedAt
       FROM ranked_scores s LEFT JOIN player_profiles p ON p.player_id = s.player_id
       WHERE s.row_num = 1
       ORDER BY s.score DESC, s.combo DESC, s.time_ms ASC LIMIT ?`,
      [safeLevel, safeLimit]
    );
    return { level: safeLevel, items: rows.map((row: any, index: number) => ({ rank: index + 1, ...row })) };
  }
}
