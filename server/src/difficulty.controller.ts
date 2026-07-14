import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { AdminTokenGuard } from './admin-token.guard';
import { DifficultyCurveType, DifficultyRangeConfig, materializeRange, MaterializedDifficultyLevel } from './difficulty-curve';
import { createDefaultDifficultyLevel } from './difficulty-config';

const VALID_MODES = ['normal', 'travel', 'signin'];
const MODE_CONFIG: Record<string, { maxLevel: number; groupSize: number }> = {
  normal: { maxLevel: 2000, groupSize: 0 },
  travel: { maxLevel: 120, groupSize: 10 },
  signin: { maxLevel: 31, groupSize: 31 },
};

@Controller('difficulty')
@UseGuards(AdminTokenGuard)
export class DifficultyController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@Query('mode') mode = 'normal') {
    const safeMode = this.validateMode(mode);
    const [rows]: any = await this.db.pool.query(
      `SELECT id, mode, start_level AS startLevel, end_level AS endLevel, difficulty,
              grid_w AS gridW, grid_h AS gridH, max_layers AS maxLayers,
              min_tiles AS minTiles, max_tiles AS maxTiles, chaos,
              min_available_pairs AS minAvailablePairs, hidden_ratio AS hiddenRatio,
              special_pair_count AS specialPairCount, curve_type AS curveType,
              curve_amplitude AS curveAmplitude, curve_cycles AS curveCycles, updated_at AS updatedAt
       FROM game_difficulty_ranges WHERE mode = ? ORDER BY start_level, end_level`,
      [safeMode],
    );
    return { items: rows.map(this.normalizeRange), total: rows.length };
  }

  @Get(':id/levels')
  async levels(@Param('id', ParseIntPipe) id: number, @Query('mode') mode = 'normal') {
    const safeMode = this.validateMode(mode);
    const [rows]: any = await this.db.pool.query(
      `SELECT mode, level, difficulty, difficulty_label AS difficultyLabel, curve_factor AS curveFactor, manual_override AS manualOverride,
              grid_w AS gridW, grid_h AS gridH, max_layers AS maxLayers, min_tiles AS minTiles,
              max_tiles AS maxTiles, chaos, min_available_pairs AS minAvailablePairs,
              hidden_ratio AS hiddenRatio, special_pair_count AS specialPairCount
       FROM game_difficulty_levels WHERE range_id = ? AND mode = ? ORDER BY level`, [id, safeMode],
    );
    return { items: rows.map(this.normalizeLevel), total: rows.length };
  }

  @Post()
  async create(@Body() body: DifficultyRangeConfig & { mode?: string }) {
    const mode = this.validateMode(body.mode);
    const value = this.validate(body, mode);
    await this.assertNoOverlap(mode, value.startLevel, value.endLevel);
    const connection = await this.db.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result]: any = await connection.execute(
        `INSERT INTO game_difficulty_ranges
         (mode,start_level,end_level,difficulty,grid_w,grid_h,max_layers,min_tiles,max_tiles,chaos,min_available_pairs,
          hidden_ratio,special_pair_count,curve_type,curve_amplitude,curve_cycles) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [mode, ...this.params(value)],
      );
      await this.replaceLevels(connection, mode, { ...value, id: result.insertId });
      await connection.commit();
      return { id: result.insertId, mode, ...value };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: DifficultyRangeConfig & { mode?: string }) {
    const mode = this.validateMode(body.mode);
    const value = this.validate(body, mode);
    await this.assertNoOverlap(mode, value.startLevel, value.endLevel, id);
    const connection = await this.db.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result]: any = await connection.execute(
        `UPDATE game_difficulty_ranges SET start_level=?,end_level=?,difficulty=?,grid_w=?,grid_h=?,max_layers=?,
         min_tiles=?,max_tiles=?,chaos=?,min_available_pairs=?,hidden_ratio=?,special_pair_count=?,curve_type=?,
         curve_amplitude=?,curve_cycles=? WHERE id=? AND mode=?`,
        [...this.params(value), id, mode],
      );
      if (!result.affectedRows) throw new BadRequestException('range not found');
      await this.replaceLevels(connection, mode, { ...value, id });
      await connection.commit();
      return { id, mode, ...value };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.db.pool.query('DELETE FROM game_difficulty_levels WHERE range_id = ?', [id]);
    await this.db.pool.execute('DELETE FROM game_difficulty_ranges WHERE id = ?', [id]);
    return { id };
  }

  @Post('reset')
  async reset(@Query('mode') mode = 'normal') {
    const safeMode = this.validateMode(mode);
    const defaults = this.buildDefaults(safeMode);
    const connection = await this.db.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `DELETE l FROM game_difficulty_levels l
         JOIN game_difficulty_ranges r ON r.id = l.range_id WHERE r.mode = ?`,
        [safeMode],
      );
      await connection.query('DELETE FROM game_difficulty_ranges WHERE mode = ?', [safeMode]);
      for (const value of defaults) {
        const [result]: any = await connection.execute(
          `INSERT INTO game_difficulty_ranges
           (mode,start_level,end_level,difficulty,grid_w,grid_h,max_layers,min_tiles,max_tiles,chaos,min_available_pairs,
            hidden_ratio,special_pair_count,curve_type,curve_amplitude,curve_cycles) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [safeMode, ...this.params(value)],
        );
        await this.replaceLevels(connection, safeMode, { ...value, id: result.insertId });
      }
      await connection.commit();
      return { mode: safeMode, count: defaults.length, levels: defaults.reduce((sum, item) => sum + item.endLevel - item.startLevel + 1, 0) };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private buildDefaults(mode: string): DifficultyRangeConfig[] {
    const config = MODE_CONFIG[mode];
    const defaults: DifficultyRangeConfig[] = [];
    if (mode === 'normal') {
      for (let bandStart = 1; bandStart <= config.maxLevel; bandStart += 100) {
        const bandEnd = Math.min(config.maxLevel, bandStart + 99);
        const groupSize = (Math.floor((bandStart - 1) / 100) + 1) * 10;
        for (let startLevel = bandStart; startLevel <= bandEnd; startLevel += groupSize) {
          const endLevel = Math.min(bandEnd, startLevel + groupSize - 1);
          const sample = createDefaultDifficultyLevel(Math.floor((startLevel + endLevel) / 2));
          defaults.push({ ...sample, startLevel, endLevel, curveType: 'wave', curveAmplitude: 0.12, curveCycles: 1 });
        }
      }
    } else {
      const { maxLevel, groupSize } = config;
      for (let startLevel = 1; startLevel <= maxLevel; startLevel += groupSize) {
        const endLevel = Math.min(maxLevel, startLevel + groupSize - 1);
        const sample = createDefaultDifficultyLevel(Math.floor((startLevel + endLevel) / 2));
        defaults.push({ ...sample, startLevel, endLevel, curveType: 'wave', curveAmplitude: 0.12, curveCycles: 1 });
      }
    }
    return defaults;
  }

  private async replaceLevels(connection: any, mode: string, range: DifficultyRangeConfig & { id: number }) {
    await connection.query(
      'DELETE FROM game_difficulty_levels WHERE range_id = ? AND (level < ? OR level > ?)',
      [range.id, range.startLevel, range.endLevel],
    );
    const levels = materializeRange(range).map((item) => ({ ...item, rangeId: range.id }));
    if (!levels.length) return;
    await connection.query(
      `INSERT INTO game_difficulty_levels
       (mode,level,range_id,difficulty,difficulty_label,curve_factor,grid_w,grid_h,max_layers,min_tiles,max_tiles,chaos,
        min_available_pairs,hidden_ratio,special_pair_count,manual_override) VALUES ?
       ON DUPLICATE KEY UPDATE range_id=VALUES(range_id),difficulty=IF(manual_override=0,VALUES(difficulty),difficulty),
       difficulty_label=IF(manual_override=0,VALUES(difficulty_label),difficulty_label),curve_factor=VALUES(curve_factor),
       grid_w=IF(manual_override=0,VALUES(grid_w),grid_w),grid_h=IF(manual_override=0,VALUES(grid_h),grid_h),
       max_layers=IF(manual_override=0,VALUES(max_layers),max_layers),min_tiles=IF(manual_override=0,VALUES(min_tiles),min_tiles),
       max_tiles=IF(manual_override=0,VALUES(max_tiles),max_tiles),chaos=IF(manual_override=0,VALUES(chaos),chaos),
       min_available_pairs=IF(manual_override=0,VALUES(min_available_pairs),min_available_pairs),
       hidden_ratio=IF(manual_override=0,VALUES(hidden_ratio),hidden_ratio),
       special_pair_count=IF(manual_override=0,VALUES(special_pair_count),special_pair_count)`,
      [levels.map((l) => this.levelParams(mode, l))],
    );
  }

  private levelParams(mode: string, value: MaterializedDifficultyLevel): any[] {
    return [mode, value.level, value.rangeId, value.difficulty, value.difficultyLabel, value.curveFactor, value.gridW, value.gridH, value.maxLayers,
      value.minTiles, value.maxTiles, value.chaos, value.minAvailablePairs, value.hiddenRatio, value.specialPairCount, 0];
  }

  private async assertNoOverlap(mode: string, startLevel: number, endLevel: number, excludeId?: number) {
    const params: any[] = [mode, endLevel, startLevel];
    let sql = 'SELECT id, start_level, end_level FROM game_difficulty_ranges WHERE mode = ? AND start_level <= ? AND end_level >= ?';
    if (excludeId !== undefined) { sql += ' AND id <> ?'; params.push(excludeId); }
    const [rows]: any = await this.db.pool.query(`${sql} LIMIT 1`, params);
    if (rows[0]) throw new BadRequestException(`range overlaps ${rows[0].start_level}-${rows[0].end_level}`);
  }

  private validateMode(mode?: string): string {
    const value = String(mode || 'normal').trim().toLowerCase();
    if (!VALID_MODES.includes(value)) throw new BadRequestException('invalid difficulty mode');
    return value;
  }

  private validate(input: DifficultyRangeConfig, mode: string): DifficultyRangeConfig {
    const value: any = { ...input };
    for (const key of ['startLevel','endLevel','difficulty','gridW','gridH','maxLayers','minTiles','maxTiles','minAvailablePairs','specialPairCount']) {
      const number = Number(value[key]);
      if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`${key} must be a non-negative number`);
      value[key] = Math.floor(number);
    }
    value.chaos = Number(value.chaos); value.hiddenRatio = Number(value.hiddenRatio);
    value.curveAmplitude = Number(value.curveAmplitude ?? 0.1); value.curveCycles = Number(value.curveCycles ?? 1);
    value.curveType = (['flat','linear','ease','wave'].includes(value.curveType) ? value.curveType : 'wave') as DifficultyCurveType;
    if (value.startLevel < 1 || value.endLevel < value.startLevel) throw new BadRequestException('invalid level range');
    const config = MODE_CONFIG[mode];
    if (config && value.endLevel > config.maxLevel) throw new BadRequestException(`level cannot exceed ${config.maxLevel} for mode ${mode}`);
    if (value.difficulty < 1 || value.difficulty > 3) throw new BadRequestException('difficulty must be 1, 2 or 3');
    if (value.maxLayers < 1 || value.maxLayers > 20) throw new BadRequestException('maxLayers must be between 1 and 20');
    if (value.minTiles > value.maxTiles || value.minTiles % 2 || value.maxTiles % 2) throw new BadRequestException('tile counts must be even and minTiles <= maxTiles');
    if (![value.chaos,value.hiddenRatio,value.curveAmplitude,value.curveCycles].every(Number.isFinite)) throw new BadRequestException('invalid curve or ratio');
    if (value.chaos < 0 || value.chaos > 1 || value.hiddenRatio < 0 || value.hiddenRatio > 1) throw new BadRequestException('ratios must be between 0 and 1');
    if (value.curveAmplitude < 0 || value.curveAmplitude > 0.75 || value.curveCycles < 0.25 || value.curveCycles > 20) throw new BadRequestException('invalid curve settings');
    return value;
  }

  private params(value: DifficultyRangeConfig): any[] {
    return [value.startLevel,value.endLevel,value.difficulty,value.gridW,value.gridH,value.maxLayers,value.minTiles,value.maxTiles,
      value.chaos,value.minAvailablePairs,value.hiddenRatio,value.specialPairCount,value.curveType,value.curveAmplitude,value.curveCycles];
  }

  private normalizeRange(row: any) {
    return { ...row, chaos: Number(row.chaos), hiddenRatio: Number(row.hiddenRatio), curveAmplitude: Number(row.curveAmplitude), curveCycles: Number(row.curveCycles) };
  }
  private normalizeLevel(row: any) {
    return { ...row, manualOverride: !!row.manualOverride, chaos: Number(row.chaos), hiddenRatio: Number(row.hiddenRatio), curveFactor: Number(row.curveFactor) };
  }
}

@Controller('difficulty-levels')
@UseGuards(AdminTokenGuard)
export class DifficultyLevelsController {
  constructor(private readonly db: DatabaseService) {}

  @Patch(':level')
  async update(@Param('level', ParseIntPipe) level: number, @Body() body: any, @Query('mode') mode = 'normal') {
    const safeMode = String(mode || 'normal').trim().toLowerCase();
    if (!VALID_MODES.includes(safeMode)) throw new BadRequestException('invalid difficulty mode');
    const label = ['easy','normal','hard'].includes(body.difficultyLabel) ? body.difficultyLabel : 'normal';
    const difficulty = label === 'easy' ? 1 : (label === 'hard' ? 3 : 2);
    const values = [body.gridW,body.gridH,body.maxLayers,body.minTiles,body.maxTiles,body.chaos,
      body.minAvailablePairs,body.hiddenRatio,body.specialPairCount].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new BadRequestException('invalid level values');
    await this.db.pool.execute(
      `UPDATE game_difficulty_levels SET difficulty=?,difficulty_label=?,grid_w=?,grid_h=?,max_layers=?,min_tiles=?,max_tiles=?,
       chaos=?,min_available_pairs=?,hidden_ratio=?,special_pair_count=?,manual_override=1
       WHERE mode=? AND level=? AND range_id IN (SELECT id FROM game_difficulty_ranges WHERE mode=?)`,
      [difficulty,label,...values,safeMode,level,safeMode],
    );
    return { level, mode: safeMode, difficulty, difficultyLabel: label };
  }
}
