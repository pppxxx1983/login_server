const mysql = require('mysql2/promise');

const MODE_CONFIG = {
  normal: { maxLevel: 1000, curveType: 'wave', curveAmplitude: 0.12, curveCycles: 1 },
  signin: { maxLevel: 31, groupSize: 31, curveType: 'wave', curveAmplitude: 0.12, curveCycles: 1 },
  travel: { maxLevel: 120, groupSize: 10, curveType: 'wave', curveAmplitude: 0.12, curveCycles: 1 },
};

const VALID_MODES = Object.keys(MODE_CONFIG);

const profiles = {
  1: { tileScale: 0.88, chaosOffset: -0.12, hiddenOffset: -0.04, availablePairBonus: 2, layerBonus: -1, minSpecialPairs: 1, maxSpecialPairs: 4 },
  2: { tileScale: 1, chaosOffset: 0, hiddenOffset: 0, availablePairBonus: 0, layerBonus: 0, minSpecialPairs: 1, maxSpecialPairs: 7 },
  3: { tileScale: 1.1, chaosOffset: 0.13, hiddenOffset: 0.05, availablePairBonus: -1, layerBonus: 1, minSpecialPairs: 2, maxSpecialPairs: 10 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = (value) => clamp(value, 0, 1);
const evenUp = (value) => value % 2 === 0 ? value : value + 1;
const evenRound = (value) => Math.max(0, Math.round(value / 2) * 2);

function getArg(name) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
}

function getModes() {
  const raw = (getArg('mode') || process.env.DIFFICULTY_MODE || 'all').trim().toLowerCase();
  if (raw === 'all') return VALID_MODES;
  const modes = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = modes.filter((mode) => !VALID_MODES.includes(mode));
  if (invalid.length) throw new Error(`Invalid mode: ${invalid.join(', ')}. Valid modes: all, ${VALID_MODES.join(', ')}`);
  return [...new Set(modes)];
}

function createDefaultDifficultyLevel(level, baseDifficulty = 1) {
  const normalizedLevel = Math.max(1, Math.floor(level));
  const cappedLevel = Math.min(normalizedLevel, 1000);
  const progress = (cappedLevel - 1) / 999;
  const normalizedBase = profiles[baseDifficulty] ? baseDifficulty : 1;
  const phase = (normalizedLevel - 1) % 10;
  const difficulty = phase >= 3 && phase <= 6
    ? (normalizedBase <= 1 ? 2 : 3)
    : (normalizedBase <= 1 ? 1 : 2);
  const profile = profiles[difficulty];
  const gridW = 10 + Math.min(4, Math.floor(progress * 5)) * 2;
  const gridH = 14 + Math.min(2, Math.floor(progress * 3)) * 2;
  let maxLayers = 1;
  if (cappedLevel > 120) maxLayers = 2;
  if (cappedLevel > 260) maxLayers = 3;
  if (cappedLevel > 420) maxLayers = 4;
  if (cappedLevel > 600) maxLayers = 5;
  if (cappedLevel > 760) maxLayers = 6;
  if (cappedLevel > 900) maxLayers = 7;
  if (cappedLevel > 970) maxLayers = 8;
  maxLayers = Math.max(1, Math.min(8, maxLayers + profile.layerBonus));

  const perLayer = Math.floor(gridW / 2) * Math.floor(gridH / 2);
  const capacity = Math.floor(perLayer * ((1 - Math.pow(0.65, maxLayers)) / 0.35) * 1.5);
  let minTiles = Math.floor((22 + Math.floor(progress * progress * 190)) * profile.tileScale);
  let maxTiles = Math.floor((minTiles + 20 + Math.floor(progress * 90)) * profile.tileScale);
  minTiles = evenUp(Math.min(minTiles, capacity));
  maxTiles = evenUp(Math.min(Math.max(minTiles, maxTiles), capacity));

  const totalPairs = (minTiles + maxTiles) / 4;
  const minAvailablePairs = Math.min(Math.max(2, Math.floor(10 - progress * 7) + profile.availablePairBonus), Math.floor(totalPairs / 2));
  const ratioCap = Math.max(1, Math.floor(totalPairs * 0.18));
  const specialPairCount = Math.max(0, Math.min(10, ratioCap, profile.minSpecialPairs + Math.floor(progress * (profile.maxSpecialPairs - profile.minSpecialPairs))));

  return {
    level: normalizedLevel,
    difficulty,
    gridW,
    gridH,
    maxLayers,
    minTiles,
    maxTiles,
    chaos: Math.round(clamp01(0.08 + progress * 0.82 + profile.chaosOffset) * 100) / 100,
    minAvailablePairs,
    hiddenRatio: Math.round(clamp01(0.08 + progress * 0.27 + profile.hiddenOffset) * 100) / 100,
    specialPairCount,
  };
}

function curveOffset(type, progress, cycles) {
  const t = clamp(progress, 0, 1);
  if (type === 'linear') return t * 2 - 1;
  if (type === 'ease') return -Math.cos(Math.PI * t);
  if (type === 'wave') return Math.sin(Math.PI * 2 * Math.max(0.25, cycles) * t);
  return 0;
}

function materializeRange(range) {
  const count = range.endLevel - range.startLevel + 1;
  const levels = [];
  for (let level = range.startLevel; level <= range.endLevel; level++) {
    const progress = count <= 1 ? 0 : (level - range.startLevel) / (count - 1);
    const factor = clamp(1 + range.curveAmplitude * curveOffset(range.curveType, progress, range.curveCycles), 0.25, 3);
    const difficulty = factor < 0.95 ? 1 : (factor > 1.05 ? 3 : 2);
    levels.push({
      rangeId: range.id,
      level,
      difficulty,
      difficultyLabel: difficulty === 1 ? 'easy' : (difficulty === 3 ? 'hard' : 'normal'),
      curveFactor: Math.round(factor * 10000) / 10000,
      gridW: Math.max(2, evenRound(range.gridW * factor)),
      gridH: Math.max(2, evenRound(range.gridH * factor)),
      maxLayers: Math.max(1, Math.round(range.maxLayers * factor)),
      minTiles: evenRound(range.minTiles * factor),
      maxTiles: evenRound(range.maxTiles * factor),
      chaos: Math.round(clamp(range.chaos * factor, 0, 1) * 10000) / 10000,
      minAvailablePairs: Math.max(0, Math.round(range.minAvailablePairs / factor)),
      hiddenRatio: Math.round(clamp(range.hiddenRatio * factor, 0, 1) * 10000) / 10000,
      specialPairCount: Math.max(0, Math.round(range.specialPairCount * factor)),
    });
  }
  return levels;
}

function buildRanges(mode) {
  const config = MODE_CONFIG[mode];
  const ranges = [];

  if (mode === 'normal') {
    for (let bandStart = 1; bandStart <= config.maxLevel; bandStart += 100) {
      const bandEnd = Math.min(config.maxLevel, bandStart + 99);
      const groupSize = (Math.floor((bandStart - 1) / 100) + 1) * 10;
      for (let startLevel = bandStart; startLevel <= bandEnd; startLevel += groupSize) {
        const endLevel = Math.min(bandEnd, startLevel + groupSize - 1);
        ranges.push(createRange(mode, startLevel, endLevel, config));
      }
    }
    return ranges;
  }

  for (let startLevel = 1; startLevel <= config.maxLevel; startLevel += config.groupSize) {
    const endLevel = Math.min(config.maxLevel, startLevel + config.groupSize - 1);
    ranges.push(createRange(mode, startLevel, endLevel, config));
  }
  return ranges;
}

function createRange(mode, startLevel, endLevel, config) {
  const sampleLevel = Math.floor((startLevel + endLevel) / 2);
  const value = createDefaultDifficultyLevel(sampleLevel);
  return {
    mode,
    startLevel,
    endLevel,
    ...value,
    curveType: config.curveType,
    curveAmplitude: config.curveAmplitude,
    curveCycles: config.curveCycles,
  };
}

async function ensureSchema(connection) {
  await connection.query(`
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

  await connection.query(`
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

  await ensureColumn(connection, 'game_difficulty_ranges', 'mode', "VARCHAR(32) NOT NULL DEFAULT 'normal'");
  await ensureColumn(connection, 'game_difficulty_ranges', 'curve_type', "VARCHAR(16) NOT NULL DEFAULT 'wave'");
  await ensureColumn(connection, 'game_difficulty_ranges', 'curve_amplitude', 'DECIMAL(6,4) NOT NULL DEFAULT 0.1000');
  await ensureColumn(connection, 'game_difficulty_ranges', 'curve_cycles', 'DECIMAL(6,2) NOT NULL DEFAULT 1.00');
  await ensureColumn(connection, 'game_difficulty_levels', 'mode', "VARCHAR(32) NOT NULL DEFAULT 'normal'");
  await ensureColumn(connection, 'game_difficulty_levels', 'range_id', 'INT UNSIGNED NULL');
  await ensureColumn(connection, 'game_difficulty_levels', 'difficulty_label', "VARCHAR(16) NOT NULL DEFAULT 'normal'");
  await ensureColumn(connection, 'game_difficulty_levels', 'curve_factor', 'DECIMAL(7,4) NOT NULL DEFAULT 1.0000');
  await ensureColumn(connection, 'game_difficulty_levels', 'manual_override', 'TINYINT(1) NOT NULL DEFAULT 0');
  await migrateDifficultyPrimaryKey(connection);
  await ensureDifficultyRangeIndex(connection);
}

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1',
    [table, column],
  );
  if (!rows[0]) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function migrateDifficultyPrimaryKey(connection) {
  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='game_difficulty_levels'
     AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`,
  );
  const pkCols = cols.map((column) => column.COLUMN_NAME);
  if (pkCols.length === 1 && pkCols[0] === 'level') {
    await connection.query('ALTER TABLE game_difficulty_levels DROP PRIMARY KEY, ADD PRIMARY KEY (mode, level)');
  }
}

async function ensureDifficultyRangeIndex(connection) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='game_difficulty_ranges'
     AND INDEX_NAME='idx_difficulty_range' LIMIT 1`,
  );
  if (!rows[0]) {
    await connection.query('ALTER TABLE game_difficulty_ranges ADD INDEX idx_difficulty_range (mode, start_level, end_level)');
    return;
  }

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='game_difficulty_ranges'
     AND INDEX_NAME='idx_difficulty_range' ORDER BY SEQ_IN_INDEX`,
  );
  const idxCols = cols.map((column) => column.COLUMN_NAME);
  if (idxCols[0] !== 'mode') {
    await connection.query('ALTER TABLE game_difficulty_ranges DROP INDEX idx_difficulty_range, ADD INDEX idx_difficulty_range (mode, start_level, end_level)');
  }
}

async function seedMode(connection, mode) {
  const ranges = buildRanges(mode);
  await connection.query(
    `DELETE l FROM game_difficulty_levels l
     JOIN game_difficulty_ranges r ON r.id = l.range_id WHERE r.mode = ?`,
    [mode],
  );
  await connection.query('DELETE FROM game_difficulty_levels WHERE mode = ?', [mode]);
  await connection.query('DELETE FROM game_difficulty_ranges WHERE mode = ?', [mode]);

  let levelCount = 0;
  for (const range of ranges) {
    const [result] = await connection.execute(
      `INSERT INTO game_difficulty_ranges
       (mode, start_level, end_level, difficulty, grid_w, grid_h, max_layers, min_tiles, max_tiles, chaos, min_available_pairs,
        hidden_ratio, special_pair_count, curve_type, curve_amplitude, curve_cycles) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mode, range.startLevel, range.endLevel, range.difficulty, range.gridW, range.gridH, range.maxLayers,
        range.minTiles, range.maxTiles, range.chaos, range.minAvailablePairs, range.hiddenRatio, range.specialPairCount,
        range.curveType, range.curveAmplitude, range.curveCycles],
    );

    const levels = materializeRange({ ...range, id: result.insertId });
    levelCount += levels.length;
    await connection.query(
      `INSERT INTO game_difficulty_levels
       (mode, level, range_id, difficulty, difficulty_label, curve_factor, grid_w, grid_h, max_layers, min_tiles, max_tiles, chaos,
        min_available_pairs, hidden_ratio, special_pair_count, manual_override) VALUES ?`,
      [levels.map((level) => [mode, level.level, level.rangeId, level.difficulty, level.difficultyLabel, level.curveFactor,
        level.gridW, level.gridH, level.maxLayers, level.minTiles, level.maxTiles, level.chaos, level.minAvailablePairs,
        level.hiddenRatio, level.specialPairCount, 0])],
    );
  }
  return { mode, ranges: ranges.length, levels: levelCount };
}

async function main() {
  const modes = getModes();
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'vita_game',
    charset: 'utf8mb4',
    dateStrings: true,
  });

  try {
    await ensureSchema(connection);
    await connection.beginTransaction();
    const results = [];
    for (const mode of modes) {
      results.push(await seedMode(connection, mode));
    }
    await connection.commit();
    console.log(JSON.stringify({ ok: true, database: process.env.MYSQL_DATABASE || 'vita_game', results }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
