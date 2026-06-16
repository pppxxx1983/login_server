import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

@Controller('tracking')
@UseGuards(AdminTokenGuard)
export class TrackingController {
  constructor(private readonly db: DatabaseService) {}

  @Get('event-names')
  async eventNames() {
    const [rows]: any = await this.db.pool.query(
      `SELECT event_name AS eventName, COUNT(*) AS total,
              MIN(client_time) AS firstTime, MAX(client_time) AS lastTime
       FROM tracking_events GROUP BY event_name ORDER BY event_name`
    );
    return { items: rows.map((row: any) => ({ ...row, total: Number(row.total) })) };
  }

  @Get('events')
  async events(
    @Query('eventNames') eventNames = '',
    @Query('playerId') playerId = '',
    @Query('start') start = '',
    @Query('end') end = '',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    const names = this.parseNames(eventNames);
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const { where, params } = this.filters(names, playerId, start, end);
    const [rows]: any = await this.db.pool.query(
      `SELECT id, event_id AS eventId, event_name AS eventName, player_id AS playerId,
              session_id AS sessionId, platform, app_version AS appVersion,
              client_time AS clientTime, server_time AS serverTime, properties, user_ip AS userIp
       FROM tracking_events ${where}
       ORDER BY client_time DESC LIMIT ? OFFSET ?`,
      [...params, safeSize, (safePage - 1) * safeSize]
    );
    const [counts]: any = await this.db.pool.query(
      `SELECT COUNT(*) AS total FROM tracking_events ${where}`,
      params
    );
    return { items: rows, total: Number(counts[0].total), page: safePage, pageSize: safeSize };
  }

  @Get('timeline')
  async timeline(
    @Query('eventNames') eventNames = '',
    @Query('start') start = '',
    @Query('end') end = '',
    @Query('grain') grain = 'hour',
  ) {
    const names = this.parseNames(eventNames);
    if (!names.length) return { grain, items: [] };
    const safeGrain = grain === 'day' ? 'day' : 'hour';
    const bucketSql = safeGrain === 'day'
      ? `DATE_FORMAT(client_time, '%Y-%m-%d 00:00:00')`
      : `DATE_FORMAT(client_time, '%Y-%m-%d %H:00:00')`;
    const { where, params } = this.filters(names, '', start, end);
    const [rows]: any = await this.db.pool.query(
      `SELECT ${bucketSql} AS bucket, event_name AS eventName, COUNT(*) AS count
       FROM tracking_events ${where}
       GROUP BY bucket, event_name ORDER BY bucket, event_name`,
      params
    );
    return { grain: safeGrain, items: rows.map((row: any) => ({ ...row, count: Number(row.count) })) };
  }

  private parseNames(value: string): string[] {
    return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 30);
  }

  private filters(names: string[], playerId: string, start: string, end: string) {
    const clauses: string[] = [];
    const params: any[] = [];
    if (names.length) {
      clauses.push(`event_name IN (${names.map(() => '?').join(',')})`);
      params.push(...names);
    }
    if (playerId.trim()) {
      clauses.push('player_id = ?');
      params.push(playerId.trim());
    }
    if (start) {
      clauses.push('client_time >= ?');
      params.push(new Date(start));
    }
    if (end) {
      clauses.push('client_time <= ?');
      params.push(new Date(end));
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }
}
