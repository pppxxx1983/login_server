import { DifficultyLevelConfig } from './difficulty-config';

export type DifficultyCurveType = 'flat' | 'linear' | 'ease' | 'wave';

export interface DifficultyRangeConfig extends Omit<DifficultyLevelConfig, 'level'> {
  id?: number;
  startLevel: number;
  endLevel: number;
  curveType: DifficultyCurveType;
  curveAmplitude: number;
  curveCycles: number;
}

export interface MaterializedDifficultyLevel extends DifficultyLevelConfig {
  rangeId: number;
  difficultyLabel: 'easy' | 'normal' | 'hard';
  curveFactor: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const even = (value: number) => Math.max(0, Math.round(value / 2) * 2);

export function curveOffset(type: DifficultyCurveType, progress: number, cycles: number): number {
  const t = clamp(progress, 0, 1);
  if (type === 'linear') return t * 2 - 1;
  if (type === 'ease') return -Math.cos(Math.PI * t);
  if (type === 'wave') return Math.sin(Math.PI * 2 * Math.max(0.25, cycles) * t);
  return 0;
}

export function materializeRange(range: DifficultyRangeConfig & { id: number }): MaterializedDifficultyLevel[] {
  const count = range.endLevel - range.startLevel + 1;
  const levels: MaterializedDifficultyLevel[] = [];
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
      gridW: Math.max(2, even(range.gridW * factor)),
      gridH: Math.max(2, even(range.gridH * factor)),
      maxLayers: Math.max(1, Math.round(range.maxLayers * factor)),
      minTiles: even(range.minTiles * factor),
      maxTiles: even(range.maxTiles * factor),
      chaos: Math.round(clamp(range.chaos * factor, 0, 1) * 10000) / 10000,
      minAvailablePairs: Math.max(0, Math.round(range.minAvailablePairs / factor)),
      hiddenRatio: Math.round(clamp(range.hiddenRatio * factor, 0, 1) * 10000) / 10000,
      specialPairCount: Math.max(0, Math.round(range.specialPairCount * factor)),
    });
  }
  return levels;
}
