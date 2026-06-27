const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { createDefaultDifficultyLevel } = require('../dist/difficulty-config');
const { materializeRange } = require('../dist/difficulty-curve');

const MODE_CONFIG = loadModeConfig();
const VALID_MODES = Object.keys(MODE_CONFIG.modes);

function loadModeConfig() {
  const configPath = path.resolve(__dirname, '../config/difficulty-modes.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Difficulty mode config not found: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function getModeFromArgs() {
  const modeIndex = process.argv.findIndex((arg) => arg === '--mode');
  if (modeIndex !== -1 && process.argv[modeIndex + 1]) {
    return process.argv[modeIndex + 1].trim().toLowerCase();
  }
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  if (modeArg) return modeArg.split('=')[1].trim().toLowerCase();
  return (process.env.DIFFICULTY_MODE || 'normal').trim().toLowerCase();
}

function validateMode(mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid difficulty mode "${mode}". Valid modes: ${VALID_MODES.join(', ')}`);
  }
  return mode;
}

function buildRanges(mode) {
  const config = MODE_CONFIG.modes[mode];
  const ranges = [];

  if (mode === 'normal') {
    for (let bandStart = 1; bandStart <= config.maxLevel; bandStart += 100) {
      const bandEnd = Math.min(config.maxLevel, bandStart + 99);
      const groupSize = (Math.floor((bandStart - 1) / 100) + 1) * 10;
      for (let startLevel = bandStart; startLevel <= bandEnd; startLevel += groupSize) {
        const endLevel = Math.min(bandEnd, startLevel + groupSize - 1);
        const sampleLevel = Math.floor((startLevel + endLevel) / 2);
        ranges.push(createRange(mode, startLevel, endLevel, sampleLevel, config));
      }
    }
    return ranges;
  }

  const { maxLevel, groupSize } = config;
  for (let startLevel = 1; startLevel <= maxLevel; startLevel += groupSize) {
    const endLevel = Math.min(maxLevel, startLevel + groupSize - 1);
    const sampleLevel = Math.floor((startLevel + endLevel) / 2);
    ranges.push(createRange(mode, startLevel, endLevel, sampleLevel, config));
  }
  return ranges;
}

function createRange(mode, startLevel, endLevel, sampleLevel, modeConfig) {
  const value = createDefaultDifficultyLevel(sampleLevel);
  return {
    mode,
    startLevel,
    endLevel,
    config: value,
    curveType: modeConfig.curveType,
    curveAmplitude: modeConfig.curveAmplitude,
    curveCycles: modeConfig.curveCycles,
  };
}

async function main() {
  const mode = validateMode(getModeFromArgs());
  const ranges = buildRanges(mode);

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'vita_game',
  });

  try {
    await ensureSchema(connection);
    await connection.beginTransaction();

    await connection.query(
      `DELETE l FROM game_difficulty_levels l
       JOIN game_difficulty_ranges r ON r.id = l.range_id WHERE r.mode = ?`,
      [mode],
    );
    await connection.query('DELETE FROM game_difficulty_ranges WHERE mode = ?', [mode]);

    for (const item of ranges) {
      const value = item.config;
      const [result] = await connection.execute(
        `INSERT INTO game_difficulty_ranges
         (mode, start_level, end_level, difficulty, grid_w, grid_h, max_layers, min_tiles, max_tiles, chaos, min_available_pairs,
          hidden_ratio, special_pair_count, curve_type, curve_amplitude, curve_cycles) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item.mode, item.startLevel, item.endLevel, value.difficulty, value.gridW, value.gridH, value.maxLayers,
          value.minTiles, value.maxTiles, value.chaos, value.minAvailablePairs, value.hiddenRatio, value.specialPairCount,
          item.curveType, item.curveAmplitude, item.curveCycles],
      );

      const levels = materializeRange({
        ...value,
        id: result.insertId,
        startLevel: item.startLevel,
        endLevel: item.endLevel,
        curveType: item.curveType,
        curveAmplitude: item.curveAmplitude,
        curveCycles: item.curveCycles,
      });

      await connection.query(
        `INSERT INTO game_difficulty_levels
         (mode, level, range_id, difficulty, difficulty_label, curve_factor, grid_w, grid_h, max_layers, min_tiles, max_tiles, chaos,
          min_available_pairs, hidden_ratio, special_pair_count, manual_override) VALUES ?`,
        [levels.map((level) => [item.mode, level.level, level.rangeId, level.difficulty, level.difficultyLabel, level.curveFactor,
          level.gridW, level.gridH, level.maxLayers, level.minTiles, level.maxTiles, level.chaos, level.minAvailablePairs,
          level.hiddenRatio, level.specialPairCount, 0])],
      );
    }

    await connection.commit();
    console.log(JSON.stringify({
      mode,
      insertedRanges: ranges.length,
      insertedLevels: ranges.reduce((sum, item) => sum + item.endLevel - item.startLevel + 1, 0),
      first: ranges[0],
      last: ranges[ranges.length - 1],
    }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

async function ensureSchema(connection) {
  const ensureColumn = async (table, column, definition) => {
    const [rows] = await connection.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1',
      [table, column],
    );
    if (!rows[0]) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  };

  await ensureColumn('game_difficulty_ranges', 'mode', "VARCHAR(32) NOT NULL DEFAULT 'normal'");
  await ensureColumn('game_difficulty_ranges', 'curve_type', "VARCHAR(16) NOT NULL DEFAULT 'wave'");
  await ensureColumn('game_difficulty_ranges', 'curve_amplitude', 'DECIMAL(6,4) NOT NULL DEFAULT 0.1000');
  await ensureColumn('game_difficulty_ranges', 'curve_cycles', 'DECIMAL(6,2) NOT NULL DEFAULT 1.00');
  await ensureColumn('game_difficulty_levels', 'mode', "VARCHAR(32) NOT NULL DEFAULT 'normal'");
  await ensureColumn('game_difficulty_levels', 'range_id', 'INT UNSIGNED NULL');
  await ensureColumn('game_difficulty_levels', 'difficulty_label', "VARCHAR(16) NOT NULL DEFAULT 'normal'");
  await ensureColumn('game_difficulty_levels', 'curve_factor', 'DECIMAL(7,4) NOT NULL DEFAULT 1.0000');
  await ensureColumn('game_difficulty_levels', 'manual_override', 'TINYINT(1) NOT NULL DEFAULT 0');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
