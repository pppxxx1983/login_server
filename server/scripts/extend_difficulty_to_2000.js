const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const TARGET_MAX_LEVEL = 2000;
const SOURCE_MAX_LEVEL = 1000;
const DEFAULT_SOURCE_SQL = 'C:/Users/admin/Downloads/difficulty_config.sql';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function splitTuple(text) {
  const values = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) { current += char; escaped = false; }
      else if (char === '\\') escaped = true;
      else if (char === "'") quoted = false;
      else current += char;
    } else if (char === "'") quoted = true;
    else if (char === ',') { values.push(current.trim()); current = ''; }
    else current += char;
  }
  values.push(current.trim());
  return values;
}

function readInsertTuples(sql, table) {
  const marker = `INSERT INTO \`${table}\``;
  const insertAt = sql.indexOf(marker);
  if (insertAt < 0) throw new Error(`missing INSERT for ${table}`);
  const valuesAt = sql.indexOf('VALUES', insertAt);
  const statementEnd = sql.indexOf(';', valuesAt);
  if (valuesAt < 0 || statementEnd < 0) throw new Error(`invalid INSERT for ${table}`);
  const body = sql.slice(valuesAt + 6, statementEnd);
  const tuples = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let tupleStart = -1;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") quoted = true;
    else if (char === '(' && depth++ === 0) tupleStart = index + 1;
    else if (char === ')' && --depth === 0) tuples.push(splitTuple(body.slice(tupleStart, index)));
  }
  return tuples;
}

function parseSource(sql) {
  const ranges = readInsertTuples(sql, 'game_difficulty_ranges').map((v) => ({
    sourceId: Number(v[0]), mode: v[1], startLevel: Number(v[2]), endLevel: Number(v[3]),
    difficulty: Number(v[4]), gridW: Number(v[5]), gridH: Number(v[6]), maxLayers: Number(v[7]),
    minTiles: Number(v[8]), maxTiles: Number(v[9]), chaos: Number(v[10]),
    minAvailablePairs: Number(v[11]), hiddenRatio: Number(v[12]), specialPairCount: Number(v[13]),
    curveType: v[14], curveAmplitude: Number(v[15]), curveCycles: Number(v[16]),
  })).filter((item) => item.mode === 'normal');
  const levels = readInsertTuples(sql, 'game_difficulty_levels').map((v) => ({
    mode: v[0], level: Number(v[1]), sourceRangeId: Number(v[2]), difficulty: Number(v[3]),
    difficultyLabel: v[4], curveFactor: Number(v[5]), manualOverride: Number(v[6]),
    gridW: Number(v[7]), gridH: Number(v[8]), maxLayers: Number(v[9]), minTiles: Number(v[10]),
    maxTiles: Number(v[11]), chaos: Number(v[12]), minAvailablePairs: Number(v[13]),
    hiddenRatio: Number(v[14]), specialPairCount: Number(v[15]), updatedAt: v[16],
  })).filter((item) => item.mode === 'normal');
  return { ranges, levels };
}

function missingSpans(levels, maxLevel) {
  const present = new Set(levels.map((item) => item.level));
  const spans = [];
  let start = null;
  for (let level = 1; level <= maxLevel; level += 1) {
    if (!present.has(level) && start === null) start = level;
    if (present.has(level) && start !== null) { spans.push([start, level - 1]); start = null; }
  }
  if (start !== null) spans.push([start, maxLevel]);
  return spans;
}

function weightedProfile(ranges, startLevel, endLevel) {
  const fields = ['gridW', 'gridH', 'maxLayers', 'minTiles', 'maxTiles', 'chaos', 'minAvailablePairs', 'hiddenRatio', 'specialPairCount'];
  const totals = Object.fromEntries(fields.map((field) => [field, 0]));
  let weight = 0;
  for (const range of ranges) {
    const overlap = Math.max(0, Math.min(endLevel, range.endLevel) - Math.max(startLevel, range.startLevel) + 1);
    if (!overlap) continue;
    weight += overlap;
    for (const field of fields) totals[field] += range[field] * overlap;
  }
  if (weight !== endLevel - startLevel + 1) throw new Error(`source ranges do not cover ${startLevel}-${endLevel}`);
  return Object.fromEntries(fields.map((field) => [field, totals[field] / weight]));
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const even = (value) => Math.max(2, Math.round(value / 2) * 2);

function normalizeExtendedProfile(profile) {
  const gridW = even(clamp(profile.gridW, 2, 20));
  const gridH = even(clamp(profile.gridH, 2, 20));
  const maxLayers = Math.round(clamp(profile.maxLayers, 1, 8));
  const perLayer = Math.floor(gridW / 2) * Math.floor(gridH / 2);
  const capacity = Math.floor(perLayer * ((1 - Math.pow(0.65, maxLayers)) / 0.35) * 1.5);
  const minTiles = even(clamp(profile.minTiles, 2, Math.min(280, capacity)));
  const maxTiles = even(clamp(profile.maxTiles, minTiles, Math.min(360, capacity)));
  return {
    difficulty: 2, gridW, gridH, maxLayers, minTiles, maxTiles,
    chaos: Number(clamp(profile.chaos, 0, 0.95).toFixed(4)),
    minAvailablePairs: Math.round(clamp(profile.minAvailablePairs, 3, 12)),
    hiddenRatio: Number(clamp(profile.hiddenRatio, 0, 0.4).toFixed(4)),
    specialPairCount: Math.round(clamp(profile.specialPairCount, 0, 8)),
    curveType: 'wave', curveAmplitude: 0.12, curveCycles: 1,
  };
}

function buildExtensionRanges(sourceRanges) {
  const oldPeak = weightedProfile(sourceRanges, 601, 700);
  const oldRecovery = weightedProfile(sourceRanges, 701, 800);
  const latestPeak = weightedProfile(sourceRanges, 801, 900);
  const latestRecovery = weightedProfile(sourceRanges, 901, 1000);
  const fields = Object.keys(oldPeak);
  const result = [];
  for (let block = 0; block < 10; block += 1) {
    const peak = block % 2 === 0;
    const steps = Math.floor(block / 2) + 1;
    const previous = peak ? oldPeak : oldRecovery;
    const latest = peak ? latestPeak : latestRecovery;
    const extrapolated = {};
    for (const field of fields) extrapolated[field] = latest[field] + (latest[field] - previous[field]) * steps;
    result.push({
      sourceId: null, mode: 'normal', startLevel: 1001 + block * 100, endLevel: 1100 + block * 100,
      ...normalizeExtendedProfile(extrapolated),
    });
  }
  return result;
}

function materialize(range, rangeId) {
  const rows = [];
  const count = range.endLevel - range.startLevel + 1;
  for (let level = range.startLevel; level <= range.endLevel; level += 1) {
    const progress = count <= 1 ? 0 : (level - range.startLevel) / (count - 1);
    const factor = clamp(1 + range.curveAmplitude * Math.sin(Math.PI * 2 * range.curveCycles * progress), 0.25, 3);
    rows.push({
      mode: 'normal', level, rangeId, difficulty: factor < 0.95 ? 1 : (factor > 1.05 ? 3 : 2),
      difficultyLabel: factor < 0.95 ? 'easy' : (factor > 1.05 ? 'hard' : 'normal'),
      curveFactor: Number(factor.toFixed(4)), manualOverride: 0,
      gridW: even(clamp(range.gridW * factor, 2, 20)), gridH: even(clamp(range.gridH * factor, 2, 20)),
      maxLayers: Math.round(clamp(range.maxLayers * factor, 1, 8)),
      minTiles: even(clamp(range.minTiles * factor, 2, 280)),
      maxTiles: even(clamp(range.maxTiles * factor, Math.min(280, even(range.minTiles * factor)), 360)),
      chaos: Number(clamp(range.chaos * factor, 0, 0.95).toFixed(4)),
      minAvailablePairs: Math.round(clamp(range.minAvailablePairs / factor, 3, 12)),
      hiddenRatio: Number(clamp(range.hiddenRatio * factor, 0, 0.4).toFixed(4)),
      specialPairCount: Math.round(clamp(range.specialPairCount * factor, 0, 8)), updatedAt: null,
    });
  }
  return rows;
}

async function insertRange(connection, range) {
  const [result] = await connection.execute(
    `INSERT INTO game_difficulty_ranges
     (mode,start_level,end_level,difficulty,grid_w,grid_h,max_layers,min_tiles,max_tiles,chaos,min_available_pairs,
      hidden_ratio,special_pair_count,curve_type,curve_amplitude,curve_cycles) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['normal', range.startLevel, range.endLevel, range.difficulty, range.gridW, range.gridH, range.maxLayers,
      range.minTiles, range.maxTiles, range.chaos, range.minAvailablePairs, range.hiddenRatio,
      range.specialPairCount, range.curveType, range.curveAmplitude, range.curveCycles],
  );
  return result.insertId;
}

async function insertLevels(connection, levels) {
  if (!levels.length) return;
  await connection.query(
    `INSERT INTO game_difficulty_levels
     (mode,level,range_id,difficulty,difficulty_label,curve_factor,manual_override,grid_w,grid_h,max_layers,min_tiles,max_tiles,
      chaos,min_available_pairs,hidden_ratio,special_pair_count,updated_at) VALUES ?`,
    [levels.map((item) => ['normal', item.level, item.rangeId, item.difficulty, item.difficultyLabel, item.curveFactor,
      item.manualOverride, item.gridW, item.gridH, item.maxLayers, item.minTiles, item.maxTiles, item.chaos,
      item.minAvailablePairs, item.hiddenRatio, item.specialPairCount, item.updatedAt || new Date()])],
  );
}

async function main() {
  const sourcePath = path.resolve(argument('source-sql', DEFAULT_SOURCE_SQL));
  const dryRun = process.argv.includes('--dry-run');
  const source = parseSource(fs.readFileSync(sourcePath, 'utf8'));
  const gaps = missingSpans(source.levels, SOURCE_MAX_LEVEL);
  if (!source.levels.length || gaps.some(([start, end]) => start < 111 || end > 230)) {
    throw new Error(`unexpected source coverage; gaps=${JSON.stringify(gaps)}`);
  }
  const extensionRanges = buildExtensionRanges(source.ranges);
  if (dryRun) {
    console.log(JSON.stringify({ sourcePath, sourceRanges: source.ranges.length, sourceLevels: source.levels.length, gaps, extensionRanges }, null, 2));
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'vita_game', charset: 'utf8mb4', dateStrings: true,
  });
  try {
    const [localRanges] = await connection.query(
      `SELECT id,mode,start_level AS startLevel,end_level AS endLevel,difficulty,grid_w AS gridW,grid_h AS gridH,
       max_layers AS maxLayers,min_tiles AS minTiles,max_tiles AS maxTiles,chaos,min_available_pairs AS minAvailablePairs,
       hidden_ratio AS hiddenRatio,special_pair_count AS specialPairCount,curve_type AS curveType,
       curve_amplitude AS curveAmplitude,curve_cycles AS curveCycles
       FROM game_difficulty_ranges WHERE mode='normal' ORDER BY start_level`,
    );
    const [localLevels] = await connection.query(
      `SELECT mode,level,range_id AS rangeId,difficulty,difficulty_label AS difficultyLabel,curve_factor AS curveFactor,
       manual_override AS manualOverride,grid_w AS gridW,grid_h AS gridH,max_layers AS maxLayers,min_tiles AS minTiles,
       max_tiles AS maxTiles,chaos,min_available_pairs AS minAvailablePairs,hidden_ratio AS hiddenRatio,
       special_pair_count AS specialPairCount,updated_at AS updatedAt
       FROM game_difficulty_levels WHERE mode='normal' ORDER BY level`,
    );
    const localByLevel = new Map(localLevels.map((item) => [Number(item.level), item]));
    for (const [start, end] of gaps) {
      for (let level = start; level <= end; level += 1) {
        if (!localByLevel.has(level)) throw new Error(`local database cannot fill missing source level ${level}`);
      }
    }

    await connection.beginTransaction();
    await connection.query("DELETE FROM game_difficulty_levels WHERE mode='normal'");
    await connection.query("DELETE FROM game_difficulty_ranges WHERE mode='normal'");

    const sourceRangeMap = new Map();
    for (const range of source.ranges.sort((a, b) => a.startLevel - b.startLevel)) {
      sourceRangeMap.set(range.sourceId, await insertRange(connection, range));
    }
    await insertLevels(connection, source.levels.map((item) => ({ ...item, rangeId: sourceRangeMap.get(item.sourceRangeId) })));

    for (const [gapStart, gapEnd] of gaps) {
      for (const localRange of localRanges) {
        const startLevel = Math.max(gapStart, Number(localRange.startLevel));
        const endLevel = Math.min(gapEnd, Number(localRange.endLevel));
        if (endLevel < startLevel) continue;
        const rangeId = await insertRange(connection, { ...localRange, startLevel, endLevel });
        await insertLevels(connection, Array.from({ length: endLevel - startLevel + 1 }, (_, offset) => ({
          ...localByLevel.get(startLevel + offset), rangeId,
        })));
      }
    }

    for (const range of extensionRanges) {
      const rangeId = await insertRange(connection, range);
      await insertLevels(connection, materialize(range, rangeId));
    }

    const [[summary]] = await connection.query(
      `SELECT COUNT(*) AS levelCount,COUNT(DISTINCT level) AS distinctLevels,MIN(level) AS minLevel,MAX(level) AS maxLevel
       FROM game_difficulty_levels WHERE mode='normal'`,
    );
    if (Number(summary.levelCount) !== TARGET_MAX_LEVEL || Number(summary.distinctLevels) !== TARGET_MAX_LEVEL
      || Number(summary.minLevel) !== 1 || Number(summary.maxLevel) !== TARGET_MAX_LEVEL) {
      throw new Error(`post-import validation failed: ${JSON.stringify(summary)}`);
    }
    await connection.commit();
    console.log(JSON.stringify({ ok: true, sourcePath, preservedSourceLevels: source.levels.length, filledGaps: gaps,
      extendedLevels: 1000, normalLevels: Number(summary.levelCount), extensionRanges }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
