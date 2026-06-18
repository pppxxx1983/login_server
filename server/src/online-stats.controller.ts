import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

interface ListQuery {
  page?: string;
  pageSize?: string;
  startDate?: string;
  endDate?: string;
}

const ONLINE_TIMEOUT_SECONDS = 90;

@Controller('online-stats')
@UseGuards(AdminTokenGuard)
export class OnlineStatsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@Query() query: ListQuery) {
    await this.syncOnlineStats();

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const { where, params } = this.buildDateFilter(query.startDate, query.endDate);

    const [rows]: any = await this.db.pool.query(
      `SELECT
         stat_date AS statDate,
         realtime_online AS realtimeOnline,
         avg_online AS avgOnline,
         total_online AS totalOnline,
         updated_at AS updatedAt
       FROM online_stats ${where}
       ORDER BY stat_date DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    const [counts]: any = await this.db.pool.query(
      `SELECT COUNT(*) AS total FROM online_stats ${where}`,
      params,
    );

    return {
      items: rows.map((row: any) => ({
        ...row,
        realtimeOnline: Number(row.realtimeOnline),
        avgOnline: Number(row.avgOnline),
        totalOnline: Number(row.totalOnline),
      })),
      total: Number(counts[0].total),
      page,
      pageSize,
    };
  }

  @Get('current')
  async current() {
    return { currentOnline: await this.getCurrentOnline() };
  }

  private async getCurrentOnline(): Promise<number> {
    const [rows]: any = await this.db.pool.query(
      `SELECT COUNT(DISTINCT latest.player_id) AS currentOnline
       FROM tracking_events latest
       WHERE latest.server_time >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)
         AND latest.player_id IS NOT NULL
         AND latest.session_id IS NOT NULL
         AND latest.event_name IN ('session_start', 'session_heartbeat', 'app_launch', 'app_switch')
         AND NOT (
           latest.event_name = 'app_switch'
           AND JSON_UNQUOTE(JSON_EXTRACT(latest.properties, '$.switchType')) = 'background'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM tracking_events newer
           WHERE newer.player_id = latest.player_id
             AND newer.session_id = latest.session_id
             AND newer.event_name IN ('session_start', 'session_heartbeat', 'session_end', 'app_launch', 'app_switch')
             AND (
               newer.server_time > latest.server_time
               OR (newer.server_time = latest.server_time AND newer.id > latest.id)
             )
         )`,
      [ONLINE_TIMEOUT_SECONDS],
    );
    return Number(rows[0].currentOnline);
  }

  @Post('sync')
  async sync() {
    await this.syncOnlineStats();
    return { ok: true };
  }

  private async syncOnlineStats() {
    await this.db.pool.execute(`
      INSERT INTO online_stats (stat_date, realtime_online, avg_online, total_online)
      SELECT
        hourly.stat_date,
        COALESCE(SUBSTRING_INDEX(GROUP_CONCAT(hourly.hourly_players ORDER BY hourly.hour DESC SEPARATOR ','), ',', 1) + 0, 0) AS realtime_online,
        COALESCE(ROUND(AVG(hourly.hourly_players), 0), 0) AS avg_online,
        COALESCE(daily.total_players, 0) AS total_online
      FROM (
        SELECT
          DATE(client_time) AS stat_date,
          HOUR(client_time) AS hour,
          COUNT(DISTINCT player_id) AS hourly_players
        FROM tracking_events
        WHERE client_time IS NOT NULL
          AND player_id IS NOT NULL
        GROUP BY DATE(client_time), HOUR(client_time)
      ) hourly
      INNER JOIN (
        SELECT
          DATE(client_time) AS stat_date,
          COUNT(DISTINCT player_id) AS total_players
        FROM tracking_events
        WHERE client_time IS NOT NULL
          AND player_id IS NOT NULL
        GROUP BY DATE(client_time)
      ) daily ON daily.stat_date = hourly.stat_date
      GROUP BY hourly.stat_date, daily.total_players
      ON DUPLICATE KEY UPDATE
        realtime_online = VALUES(realtime_online),
        avg_online = VALUES(avg_online),
        total_online = VALUES(total_online)
    `);

    // 当天的“实时在线”必须与顶部当前在线使用同一口径，不能保留最后一个小时的历史人数。
    const currentOnline = await this.getCurrentOnline();
    await this.db.pool.execute(
      `UPDATE online_stats
       SET realtime_online = ?
       WHERE stat_date = CURRENT_DATE()`,
      [currentOnline],
    );
  }

  private buildDateFilter(startDate?: string, endDate?: string) {
    const clauses: string[] = [];
    const params: string[] = [];
    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      clauses.push('stat_date >= ?');
      params.push(startDate);
    }
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      clauses.push('stat_date <= ?');
      params.push(endDate);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }
}
