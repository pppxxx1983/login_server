const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'vita_game',
    charset: 'utf8mb4',
    dateStrings: true,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        stat_date DATE NOT NULL PRIMARY KEY,
        login_count INT UNSIGNED NOT NULL DEFAULT 0,
        new_users INT UNSIGNED NOT NULL DEFAULT 0,
        peak_online INT UNSIGNED NOT NULL DEFAULT 0,
        avg_online INT UNSIGNED NOT NULL DEFAULT 0,
        paying_users INT UNSIGNED NOT NULL DEFAULT 0,
        retention_d1 INT UNSIGNED NOT NULL DEFAULT 0,
        retention_d1_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        retention_d3 INT UNSIGNED NOT NULL DEFAULT 0,
        retention_d3_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        retention_d7 INT UNSIGNED NOT NULL DEFAULT 0,
        retention_d7_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        retention_d15 INT UNSIGNED NOT NULL DEFAULT 0,
        retention_d15_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_first_seen (
        player_id VARCHAR(191) NOT NULL PRIMARY KEY,
        first_seen_date DATE NOT NULL,
        first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_first_seen_date (first_seen_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_daily_logins (
        player_id VARCHAR(191) NOT NULL,
        login_date DATE NOT NULL,
        login_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (player_id, login_date),
        INDEX idx_login_date (login_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_records (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        player_id VARCHAR(191) NOT NULL,
        amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        currency VARCHAR(32) NOT NULL DEFAULT 'CNY',
        product_id VARCHAR(191) NULL,
        paid_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_payment_player (player_id),
        INDEX idx_payment_date (paid_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const today = new Date();
    const playerIds = [];
    for (let i = 0; i < 300; i++) {
      playerIds.push(`seed_player_${i}`);
    }

    for (let i = 30; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const statDate = date.toISOString().slice(0, 10);
      const baseNewUsers = Math.floor(Math.random() * 80) + 20;
      const baseLogins = Math.floor(baseNewUsers * (2 + Math.random() * 2));
      const peakOnline = Math.floor(baseLogins * (0.2 + Math.random() * 0.3));
      const avgOnline = Math.floor(peakOnline * (0.4 + Math.random() * 0.3));
      const payingUsers = Math.floor(baseNewUsers * (0.05 + Math.random() * 0.15));

      const startIdx = i * 5 % playerIds.length;
      const dayNewPlayers = playerIds.slice(startIdx, startIdx + baseNewUsers);
      for (const playerId of dayNewPlayers) {
        await pool.execute(
          `INSERT IGNORE INTO player_first_seen (player_id, first_seen_date, first_seen_at)
           VALUES (?, ?, ?)`,
          [playerId, statDate, new Date(date.getTime() + Math.floor(Math.random() * 86400000))],
        );
      }

      const dayLoginPlayers = playerIds.slice(startIdx, startIdx + baseLogins);
      for (const playerId of dayLoginPlayers) {
        await pool.execute(
          `INSERT IGNORE INTO player_daily_logins (player_id, login_date, login_at)
           VALUES (?, ?, ?)`,
          [playerId, statDate, new Date(date.getTime() + Math.floor(Math.random() * 86400000))],
        );
      }

      const paidPlayers = dayNewPlayers.slice(0, payingUsers);
      for (const playerId of paidPlayers) {
        await pool.execute(
          `INSERT INTO payment_records (player_id, amount, currency, product_id, paid_at)
           VALUES (?, ?, 'CNY', 'product_seed', ?)`,
          [playerId, (Math.random() * 100 + 6).toFixed(2), new Date(date.getTime() + Math.floor(Math.random() * 86400000))],
        );
      }

      const retentionD1 = Math.floor(baseNewUsers * (0.25 + Math.random() * 0.35));
      const retentionD3 = Math.floor(baseNewUsers * (0.12 + Math.random() * 0.22));
      const retentionD7 = Math.floor(baseNewUsers * (0.06 + Math.random() * 0.14));
      const retentionD15 = Math.floor(baseNewUsers * (0.02 + Math.random() * 0.08));

      await pool.execute(
        `INSERT INTO daily_stats (
          stat_date, login_count, new_users, peak_online, avg_online, paying_users,
          retention_d1, retention_d1_rate, retention_d3, retention_d3_rate,
          retention_d7, retention_d7_rate, retention_d15, retention_d15_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          login_count = VALUES(login_count),
          new_users = VALUES(new_users),
          peak_online = VALUES(peak_online),
          avg_online = VALUES(avg_online),
          paying_users = VALUES(paying_users),
          retention_d1 = VALUES(retention_d1),
          retention_d1_rate = VALUES(retention_d1_rate),
          retention_d3 = VALUES(retention_d3),
          retention_d3_rate = VALUES(retention_d3_rate),
          retention_d7 = VALUES(retention_d7),
          retention_d7_rate = VALUES(retention_d7_rate),
          retention_d15 = VALUES(retention_d15),
          retention_d15_rate = VALUES(retention_d15_rate)`,
        [
          statDate,
          baseLogins,
          baseNewUsers,
          peakOnline,
          avgOnline,
          payingUsers,
          retentionD1,
          (retentionD1 / baseNewUsers * 100).toFixed(2),
          retentionD3,
          (retentionD3 / baseNewUsers * 100).toFixed(2),
          retentionD7,
          (retentionD7 / baseNewUsers * 100).toFixed(2),
          retentionD15,
          (retentionD15 / baseNewUsers * 100).toFixed(2),
        ],
      );
    }

    console.log('Seeded sample data into daily_stats, player_first_seen, player_daily_logins and payment_records');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
