import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

@Controller('players')
@UseGuards(AdminTokenGuard)
export class PlayersController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@Query('keyword') keyword = '', @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safeSize;
    const like = `%${keyword.trim()}%`;
    const where = keyword.trim()
      ? 'WHERE p.player_id LIKE ? OR p.name LIKE ? OR u.account LIKE ? OR u.game_name LIKE ?'
      : '';
    const params = keyword.trim() ? [like, like, like, like] : [];
    const [rows] = await this.db.pool.query(
      `SELECT p.player_id AS playerId, p.name, p.avatar_id AS avatarId,
              p.avatar_frame_id AS avatarFrameId, p.perfect_combo_streak AS perfectComboStreak,
              p.created_at AS createdAt, p.updated_at AS updatedAt,
              u.account, u.game_name AS gameName,
              COUNT(s.id) AS scoreCount, MAX(s.level) AS maxLevel, MAX(s.score) AS maxScore
       FROM player_profiles p
       LEFT JOIN game_users u ON u.player_id = p.player_id
       LEFT JOIN level_scores s ON s.player_id = p.player_id
       ${where}
       GROUP BY p.player_id, p.name, p.avatar_id, p.avatar_frame_id,
                p.perfect_combo_streak, p.created_at, p.updated_at, u.account, u.game_name
       ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, safeSize, offset]
    );
    const [countRows]: any = await this.db.pool.query(
      `SELECT COUNT(*) AS total FROM player_profiles p
       LEFT JOIN game_users u ON u.player_id = p.player_id ${where}`,
      params
    );
    return { items: rows, total: Number(countRows[0].total), page: safePage, pageSize: safeSize };
  }

  @Get(':playerId')
  async detail(@Param('playerId') playerId: string) {
    const [players]: any = await this.db.pool.execute(
      `SELECT p.player_id AS playerId, p.name, p.avatar_id AS avatarId,
              p.avatar_frame_id AS avatarFrameId, p.perfect_combo_streak AS perfectComboStreak,
              p.extra_data AS extraData, p.created_at AS createdAt, p.updated_at AS updatedAt,
              u.account, u.game_name AS gameName
       FROM player_profiles p LEFT JOIN game_users u ON u.player_id = p.player_id
       WHERE p.player_id = ? LIMIT 1`,
      [playerId]
    );
    if (!players[0]) throw new NotFoundException('player not found');
    const [scores] = await this.db.pool.execute(
      `SELECT level, score, combo, special_score AS specialScore, time_ms AS timeMs,
              perfect_combo AS perfectCombo, perfect_clear AS perfectClear, created_at AS createdAt
       FROM level_scores WHERE player_id = ? ORDER BY created_at DESC LIMIT 100`,
      [playerId]
    );
    return { player: players[0], recentScores: scores };
  }
}
