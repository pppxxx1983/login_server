import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

interface ListQuery {
  page?: string;
  pageSize?: string;
  startDate?: string;
  endDate?: string;
}

interface RecordBody {
  type: 'login' | 'register';
  date?: string;
}

interface PaymentBody {
  playerId: string;
  amount: number;
  currency?: string;
  productId?: string;
  paidAt?: string;
}

@Controller('daily-stats')
@UseGuards(AdminTokenGuard)
export class DailyStatsController {
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
         login_count AS loginCount,
         new_users AS newUsers,
         peak_online AS peakOnline,
         avg_online AS avgOnline,
         paying_users AS payingUsers,
         retention_d1 AS retentionD1,
         retention_d1_rate AS retentionD1Rate,
         retention_d3 AS retentionD3,
         retention_d3_rate AS retentionD3Rate,
         retention_d7 AS retentionD7,
         retention_d7_rate AS retentionD7Rate,
         retention_d15 AS retentionD15,
         retention_d15_rate AS retentionD15Rate,
         updated_at AS updatedAt
       FROM daily_stats ${where}
       ORDER BY stat_date DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    const [counts]: any = await this.db.pool.query(
      `SELECT COUNT(*) AS total FROM daily_stats ${where}`,
      params,
    );

    return {
      items: rows.map((row: any) => ({
        ...row,
        loginCount: Number(row.loginCount),
        newUsers: Number(row.newUsers),
        peakOnline: Number(row.peakOnline),
        avgOnline: Number(row.avgOnline),
        payingUsers: Number(row.payingUsers),
        retentionD1: Number(row.retentionD1),
        retentionD1Rate: Number(row.retentionD1Rate),
        retentionD3: Number(row.retentionD3),
        retentionD3Rate: Number(row.retentionD3Rate),
        retentionD7: Number(row.retentionD7),
        retentionD7Rate: Number(row.retentionD7Rate),
        retentionD15: Number(row.retentionD15),
        retentionD15Rate: Number(row.retentionD15Rate),
      })),
      total: Number(counts[0].total),
      page,
      pageSize,
    };
  }

  @Post('record')
  async record(@Body() body: RecordBody) {
    const type = body.type === 'register' ? 'register' : 'login';
    const date = this.normalizeDate(body.date);
    if (type === 'register') {
      await this.db.pool.execute(
        `INSERT INTO daily_stats (stat_date, login_count, new_users)
         VALUES (?, 1, 1)
         ON DUPLICATE KEY UPDATE
           login_count = login_count + 1,
           new_users = new_users + 1`,
        [date],
      );
    } else {
      await this.db.pool.execute(
        `INSERT INTO daily_stats (stat_date, login_count, new_users)
         VALUES (?, 1, 0)
         ON DUPLICATE KEY UPDATE
           login_count = login_count + 1`,
        [date],
      );
    }
    return { ok: true, date, type };
  }

  @Post('record-payment')
  async recordPayment(@Body() body: PaymentBody) {
    const playerId = String(body.playerId || '').trim();
    const amount = Number(body.amount);
    if (!playerId || Number.isNaN(amount) || amount <= 0) {
      return { ok: false, error: 'playerId and positive amount are required' };
    }
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    await this.db.pool.execute(
      `INSERT INTO payment_records (player_id, amount, currency, product_id, paid_at)
       VALUES (?, ?, ?, ?, ?)`,
      [playerId, amount, body.currency || 'CNY', body.productId || null, paidAt],
    );
    return { ok: true };
  }

  @Post('sync')
  async sync() {
    await this.syncBasicCounts();
    await this.syncOnlineStats();
    await this.syncPayingUsers();
    await this.syncRetention();
    return { ok: true };
  }

  private async syncBasicCounts() {
    await this.db.pool.execute(`
      INSERT INTO daily_stats (stat_date, new_users)
      SELECT first_seen_date AS stat_date,
             COUNT(*) AS new_users
      FROM player_first_seen
      GROUP BY first_seen_date
      ON DUPLICATE KEY UPDATE
        new_users = VALUES(new_users)
    `);

    await this.db.pool.execute(`
      INSERT INTO daily_stats (stat_date, login_count)
      SELECT login_date AS stat_date,
             COUNT(DISTINCT player_id) AS login_count
      FROM player_daily_logins
      GROUP BY login_date
      ON DUPLICATE KEY UPDATE
        login_count = VALUES(login_count)
    `);
  }

  private async syncOnlineStats() {
    await this.db.pool.execute(`
      INSERT INTO daily_stats (stat_date, peak_online, avg_online)
      SELECT
        stat_date,
        COALESCE(MAX(hourly_players), 0) AS peak_online,
        COALESCE(ROUND(AVG(hourly_players), 0), 0) AS avg_online
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
      GROUP BY stat_date
      ON DUPLICATE KEY UPDATE
        peak_online = VALUES(peak_online),
        avg_online = VALUES(avg_online)
    `);
  }

  private async syncPayingUsers() {
    await this.db.pool.execute(`
      INSERT INTO daily_stats (stat_date, paying_users)
      SELECT DATE(paid_at) AS stat_date,
             COUNT(DISTINCT player_id) AS paying_users
      FROM payment_records
      WHERE paid_at IS NOT NULL
      GROUP BY DATE(paid_at)
      ON DUPLICATE KEY UPDATE
        paying_users = VALUES(paying_users)
    `);
  }

  private async syncRetention() {
    const days = [1, 3, 7, 15];
    for (const day of days) {
      await this.db.pool.execute(
        `
        INSERT INTO daily_stats (stat_date, retention_d${day}, retention_d${day}_rate)
        SELECT
          registered.stat_date,
          COALESCE(retained.retained_count, 0) AS retention_d${day},
          COALESCE(ROUND(retained.retained_count / registered.registered_count * 100, 2), 0) AS retention_d${day}_rate
        FROM (
          SELECT first_seen_date AS stat_date, COUNT(DISTINCT player_id) AS registered_count
          FROM player_first_seen
          GROUP BY first_seen_date
        ) registered
        LEFT JOIN (
          SELECT f.first_seen_date AS stat_date,
                 COUNT(DISTINCT f.player_id) AS retained_count
          FROM player_first_seen f
          INNER JOIN tracking_events t
            ON t.player_id = f.player_id
            AND t.event_name = 'user_login'
            AND DATE(t.client_time) = DATE_ADD(f.first_seen_date, INTERVAL ? DAY)
          GROUP BY f.first_seen_date
        ) retained ON retained.stat_date = registered.stat_date
        ON DUPLICATE KEY UPDATE
          retention_d${day} = VALUES(retention_d${day}),
          retention_d${day}_rate = VALUES(retention_d${day}_rate)
        `,
        [day],
      );
    }
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

  private normalizeDate(date?: string): string {
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
