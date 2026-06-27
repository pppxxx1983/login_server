export interface DifficultyLevelConfig {
  level: number;
  difficulty: number;
  gridW: number;
  gridH: number;
  maxLayers: number;
  minTiles: number;
  maxTiles: number;
  chaos: number;
  minAvailablePairs: number;
  hiddenRatio: number;
  specialPairCount: number;
}

const profiles: Record<number, any> = {
  1: { tileScale: 0.88, chaosOffset: -0.12, hiddenOffset: -0.04, availablePairBonus: 2, layerBonus: -1, minSpecialPairs: 1, maxSpecialPairs: 4 },
  2: { tileScale: 1, chaosOffset: 0, hiddenOffset: 0, availablePairBonus: 0, layerBonus: 0, minSpecialPairs: 1, maxSpecialPairs: 7 },
  3: { tileScale: 1.1, chaosOffset: 0.13, hiddenOffset: 0.05, availablePairBonus: -1, layerBonus: 1, minSpecialPairs: 2, maxSpecialPairs: 10 },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const even = (value: number) => value % 2 === 0 ? value : value + 1;

export function createDefaultDifficultyLevel(level: number, baseDifficulty = 1): DifficultyLevelConfig {
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
  minTiles = even(Math.min(minTiles, capacity));
  maxTiles = even(Math.min(Math.max(minTiles, maxTiles), capacity));
  const totalPairs = (minTiles + maxTiles) / 4;
  const minAvailablePairs = Math.min(Math.max(2, Math.floor(10 - progress * 7) + profile.availablePairBonus), Math.floor(totalPairs / 2));
  const ratioCap = Math.max(1, Math.floor(totalPairs * 0.18));
  const specialPairCount = Math.max(0, Math.min(10, ratioCap, profile.minSpecialPairs + Math.floor(progress * (profile.maxSpecialPairs - profile.minSpecialPairs))));
  return {
    level: normalizedLevel, difficulty, gridW, gridH, maxLayers, minTiles, maxTiles,
    chaos: Math.round(clamp01(0.08 + progress * 0.82 + profile.chaosOffset) * 100) / 100,
    minAvailablePairs,
    hiddenRatio: Math.round(clamp01(0.08 + progress * 0.27 + profile.hiddenOffset) * 100) / 100,
    specialPairCount,
  };
}
