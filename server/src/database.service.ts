import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPool, Pool } from 'mysql2/promise';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  readonly pool: Pool = createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'vita_game',
    charset: 'utf8mb4',
    connectionLimit: 10,
    waitForConnections: true,
    dateStrings: true,
  });

  async onModuleInit() {
    await this.pool.query('SELECT 1');
    await this.createAdminTables();
    await this.createTrackingTable();
    await this.createDailyStatsTable();
    await this.createDifficultyTable();
    await this.seedDefaultAdmin();
  }

  private async createDifficultyTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS game_difficulty_levels (
        mode VARCHAR(32) NOT NULL DEFAULT 'normal',
        level INT UNSIGNED NOT NULL,
        difficulty TINYINT UNSIGNED NOT NULL,
        grid_w SMALLINT UNSIGNED NOT NULL,
        grid_h SMALLINT UNSIGNED NOT NULL,
        max_layers SMALLINT UNSIGNED NOT NULL,
        min_tiles SMALLINT UNSIGNED NOT NULL,
        max_tiles SMALLINT UNSIGNED NOT NULL,
        chaos DECIMAL(5,4) NOT NULL,
        min_available_pairs SMALLINT UNSIGNED NOT NULL,
        hidden_ratio DECIMAL(5,4) NOT NULL,
        special_pair_count SMALLINT UNSIGNED NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (mode, level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS game_difficulty_ranges (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        mode VARCHAR(32) NOT NULL DEFAULT 'normal',
        start_level INT UNSIGNED NOT NULL,
        end_level INT UNSIGNED NOT NULL,
        difficulty TINYINT UNSIGNED NOT NULL,
        grid_w SMALLINT UNSIGNED NOT NULL,
        grid_h SMALLINT UNSIGNED NOT NULL,
        max_layers SMALLINT UNSIGNED NOT NULL,
        min_tiles SMALLINT UNSIGNED NOT NULL,
        max_tiles SMALLINT UNSIGNED NOT NULL,
        chaos DECIMAL(5,4) NOT NULL,
        min_available_pairs SMALLINT UNSIGNED NOT NULL,
        hidden_ratio DECIMAL(5,4) NOT NULL,
        special_pair_count SMALLINT UNSIGNED NOT NULL,
        curve_type VARCHAR(16) NOT NULL DEFAULT 'wave',
        curve_amplitude DECIMAL(6,4) NOT NULL DEFAULT 0.1000,
        curve_cycles DECIMAL(6,2) NOT NULL DEFAULT 1.00,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_difficulty_range (mode, start_level, end_level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await this.ensureColumn('game_difficulty_ranges', 'mode', "VARCHAR(32) NOT NULL DEFAULT 'normal'");
    await this.ensureColumn('game_difficulty_ranges', 'curve_type', "VARCHAR(16) NOT NULL DEFAULT 'wave'");
    await this.ensureColumn('game_difficulty_ranges', 'curve_amplitude', 'DECIMAL(6,4) NOT NULL DEFAULT 0.1000');
    await this.ensureColumn('game_difficulty_ranges', 'curve_cycles', 'DECIMAL(6,2) NOT NULL DEFAULT 1.00');
    await this.ensureColumn('game_difficulty_levels', 'mode', "VARCHAR(32) NOT NULL DEFAULT 'normal'");
    await this.ensureColumn('game_difficulty_levels', 'range_id', 'INT UNSIGNED NULL');
    await this.ensureColumn('game_difficulty_levels', 'difficulty_label', "VARCHAR(16) NOT NULL DEFAULT 'normal'");
    await this.ensureColumn('game_difficulty_levels', 'curve_factor', 'DECIMAL(7,4) NOT NULL DEFAULT 1.0000');
    await this.ensureColumn('game_difficulty_levels', 'manual_override', 'TINYINT(1) NOT NULL DEFAULT 0');
    await this.migrateDifficultyPrimaryKey();
    await this.ensureDifficultyRangeIndex();
  }

  private async migrateDifficultyPrimaryKey() {
    const [rows]: any = await this.pool.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_difficulty_levels'
       AND CONSTRAINT_NAME = 'PRIMARY' AND CONSTRAINT_TYPE = 'PRIMARY KEY' LIMIT 1`
    );
    if (!rows[0]) return;
    const [cols]: any = await this.pool.query(
      `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_difficulty_levels'
       AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`
    );
    const pkCols = cols.map((c: any) => c.COLUMN_NAME);
    if (pkCols.length === 1 && pkCols[0] === 'level') {
      await this.pool.query('ALTER TABLE game_difficulty_levels DROP PRIMARY KEY, ADD PRIMARY KEY (mode, level)');
    }
  }

  private async ensureDifficultyRangeIndex() {
    const [rows]: any = await this.pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_difficulty_ranges'
       AND INDEX_NAME = 'idx_difficulty_range' LIMIT 1`
    );
    if (!rows[0]) {
      await this.pool.query('ALTER TABLE game_difficulty_ranges ADD INDEX idx_difficulty_range (mode, start_level, end_level)');
    } else {
      const [cols]: any = await this.pool.query(
        `SELECT COLUMN_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_difficulty_ranges'
         AND INDEX_NAME = 'idx_difficulty_range' ORDER BY SEQ_IN_INDEX`
      );
      const idxCols = cols.map((c: any) => c.COLUMN_NAME);
      if (idxCols[0] !== 'mode') {
        await this.pool.query('ALTER TABLE game_difficulty_ranges DROP INDEX idx_difficulty_range, ADD INDEX idx_difficulty_range (mode, start_level, end_level)');
      }
    }
  }

  private async ensureColumn(table: string, column: string, definition: string) {
    const [rows]: any = await this.pool.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, column],
    );
    if (!rows[0]) await this.pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async createAdminTables() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS admin_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'admin',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_token (token),
        INDEX idx_admin (admin_id),
        FOREIGN KEY (admin_id) REFERENCES admin_accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  private async createTrackingTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(96) NOT NULL UNIQUE,
        event_name VARCHAR(64) NOT NULL,
        player_id VARCHAR(191) NULL,
        session_id VARCHAR(96) NULL,
        platform VARCHAR(32) NULL,
        app_version VARCHAR(32) NULL,
        client_time DATETIME(3) NOT NULL,
        server_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        properties JSON NULL,
        user_ip VARCHAR(45) NULL,
        INDEX idx_tracking_event_time (event_name, client_time),
        INDEX idx_tracking_player_time (player_id, client_time),
        INDEX idx_tracking_server_time (server_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  private async createDailyStatsTable() {
    await this.pool.query(`
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

    await this.pool.query(`
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

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS player_first_seen (
        player_id VARCHAR(191) NOT NULL PRIMARY KEY,
        first_seen_date DATE NOT NULL,
        first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_first_seen_date (first_seen_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS player_daily_logins (
        player_id VARCHAR(191) NOT NULL,
        login_date DATE NOT NULL,
        login_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (player_id, login_date),
        INDEX idx_login_date (login_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS online_stats (
        stat_date DATE NOT NULL PRIMARY KEY,
        realtime_online INT UNSIGNED NOT NULL DEFAULT 0,
        avg_online INT UNSIGNED NOT NULL DEFAULT 0,
        total_online INT UNSIGNED NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.addColumnIfMissing('daily_stats', 'peak_online', 'INT UNSIGNED NOT NULL DEFAULT 0');
    await this.addColumnIfMissing('daily_stats', 'avg_online', 'INT UNSIGNED NOT NULL DEFAULT 0');
    await this.addColumnIfMissing('daily_stats', 'paying_users', 'INT UNSIGNED NOT NULL DEFAULT 0');
    await this.addColumnIfMissing('daily_stats', 'retention_d1', 'INT UNSIGNED NOT NULL DEFAULT 0');
    await this.addColumnIfMissing('daily_stats', 'retention_d1_rate', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00');
    await this.addColumnIfMissing('daily_stats', 'retention_d3', 'INT UNSIGNED NOT NULL DEFAULT 0');
    await this.addColumnIfMissing('daily_stats', 'retention_d3_rate', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00');
    await this.addColumnIfMissing('daily_stats', 'retention_d7', 'INT UNSIGNED NOT NULL DEFAULT 0');
    await this.addColumnIfMissing('daily_stats', 'retention_d7_rate', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00');
    await this.addColumnIfMissing('daily_stats', 'retention_d15', 'INT UNSIGNED NOT NULL DEFAULT 0');
    await this.addColumnIfMissing('daily_stats', 'retention_d15_rate', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00');
  }

  private async addColumnIfMissing(table: string, column: string, definition: string) {
    const [rows]: any = await this.pool.execute(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    if (rows.length === 0) {
      await this.pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private async seedDefaultAdmin() {
    const [rows]: any = await this.pool.query('SELECT 1 FROM admin_accounts LIMIT 1');
    if (rows.length) return;

    const username = 'admin';
    const password = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
    const salt = randomBytes(16).toString('base64');
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const passwordHash = `${salt}:${derivedKey.toString('base64')}`;

    await this.pool.execute(
      `INSERT INTO admin_accounts (username, password_hash, role, is_active)
       VALUES (?, ?, 'admin', 1)`,
      [username, passwordHash],
    );

    this.logger.log(`Default admin account created: ${username}`);
  }
}
