const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'vita_game',
    dateStrings: true,
  });

  await pool.execute(`
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

  await pool.execute(`
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

  const [online] = await pool.query('SELECT * FROM online_stats ORDER BY stat_date DESC');
  const [daily] = await pool.query('SELECT stat_date, peak_online, avg_online FROM daily_stats ORDER BY stat_date DESC');
  console.log(JSON.stringify({ online, daily }, null, 2));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
