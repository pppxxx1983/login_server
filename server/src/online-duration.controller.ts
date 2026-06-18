import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';

interface ListQuery {
  date?: string;
}

interface DurationRange {
  label: string;
  min: number;
  max: number;
}

const DURATION_RANGES: DurationRange[] = [
  { label: '0-4', min: 0, max: 4 },
  { label: '5-10', min: 5, max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21-30', min: 21, max: 30 },
  { label: '31-40', min: 31, max: 40 },
  { label: '41-50', min: 41, max: 50 },
  { label: '51-60', min: 51, max: 60 },
  { label: '61-70', min: 61, max: 70 },
  { label: '71-80', min: 71, max: 80 },
  { label: '81-90', min: 81, max: 90 },
  { label: '91-100', min: 91, max: 100 },
  { label: '101-110', min: 101, max: 110 },
  { label: '111-120', min: 111, max: 120 },
  { label: '121-240', min: 121, max: 240 },
  { label: '241-300', min: 241, max: 300 },
  { label: '301-360', min: 301, max: 360 },
  { label: '361-420', min: 361, max: 420 },
  { label: '421-480', min: 421, max: 480 },
  { label: '481-∞', min: 481, max: Infinity },
];

@Controller('online-duration')
@UseGuards(AdminTokenGuard)
export class OnlineDurationController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@Query() query: ListQuery) {
    const date = this.normalizeDate(query.date);

    const [rows]: any = await this.db.pool.query(
      `WITH session_durations AS (
         SELECT
           DATE(client_time) AS stat_date,
           player_id,
           COALESCE(SUM(JSON_UNQUOTE(JSON_EXTRACT(properties, '$.durationMs'))) / 60000, 0) AS duration_minutes
         FROM tracking_events
         WHERE event_name = 'session_end'
           AND player_id IS NOT NULL
           AND client_time IS NOT NULL
         GROUP BY DATE(client_time), player_id
       ),
       paying_players AS (
         SELECT DISTINCT player_id FROM payment_records
       )
       SELECT
         sd.player_id,
         sd.duration_minutes,
         CASE WHEN pp.player_id IS NOT NULL THEN 1 ELSE 0 END AS is_paying
       FROM session_durations sd
       LEFT JOIN paying_players pp ON pp.player_id = sd.player_id
       WHERE sd.stat_date = ?`,
      [date],
    );

    const result = DURATION_RANGES.map((range) => ({
      duration: range.label,
      payingPlayers: 0,
      payingRatio: 0,
      nonPayingPlayers: 0,
      nonPayingRatio: 0,
      totalPlayers: 0,
    }));

    let totalPaying = 0;
    let totalNonPaying = 0;
    let totalPlayers = 0;

    for (const row of rows) {
      const minutes = Number(row.duration_minutes);
      const isPaying = Number(row.is_paying) === 1;
      const range = DURATION_RANGES.find((r) => minutes >= r.min && minutes <= r.max);
      if (!range) continue;

      const item = result.find((r) => r.duration === range.label);
      if (!item) continue;

      item.totalPlayers += 1;
      totalPlayers += 1;
      if (isPaying) {
        item.payingPlayers += 1;
        totalPaying += 1;
      } else {
        item.nonPayingPlayers += 1;
        totalNonPaying += 1;
      }
    }

    for (const item of result) {
      item.payingRatio = totalPaying > 0 ? Number(((item.payingPlayers / totalPaying) * 100).toFixed(2)) : 0;
      item.nonPayingRatio = totalNonPaying > 0 ? Number(((item.nonPayingPlayers / totalNonPaying) * 100).toFixed(2)) : 0;
    }

    return {
      date,
      totalPaying,
      totalNonPaying,
      totalPlayers,
      items: result,
    };
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
