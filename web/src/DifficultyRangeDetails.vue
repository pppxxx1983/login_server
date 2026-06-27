<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import * as echarts from 'echarts';
import { api } from './api';

const props = defineProps<{ range: any; mode?: string }>();
const emit = defineEmits<{ saved: [value: any] }>();
const loading = ref(false);
const levels = ref<any[]>([]);
const chartRef = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
const curve = reactive({
  curveType: props.range.curveType || 'wave',
  curveAmplitude: Number(props.range.curveAmplitude ?? 0.12),
  curveCycles: Number(props.range.curveCycles ?? 1),
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const even = (value: number) => Math.max(0, Math.round(value / 2) * 2);
function offset(t: number): number {
  if (curve.curveType === 'linear') return t * 2 - 1;
  if (curve.curveType === 'ease') return -Math.cos(Math.PI * t);
  if (curve.curveType === 'wave') return Math.sin(Math.PI * 2 * Math.max(0.25, curve.curveCycles) * t);
  return 0;
}

function previewLevels() {
  const result: any[] = [];
  const count = props.range.endLevel - props.range.startLevel + 1;
  for (let level = props.range.startLevel; level <= props.range.endLevel; level++) {
    const t = count <= 1 ? 0 : (level - props.range.startLevel) / (count - 1);
    const factor = clamp(1 + curve.curveAmplitude * offset(t), 0.25, 3);
    const difficultyLabel = factor < 0.95 ? 'easy' : (factor > 1.05 ? 'hard' : 'normal');
    result.push({
      level, difficultyLabel, manualOverride: false, curveFactor: Number(factor.toFixed(4)),
      gridW: Math.max(2, even(props.range.gridW * factor)), gridH: Math.max(2, even(props.range.gridH * factor)),
      maxLayers: Math.max(1, Math.round(props.range.maxLayers * factor)),
      minTiles: even(props.range.minTiles * factor), maxTiles: even(props.range.maxTiles * factor),
      chaos: Number(clamp(props.range.chaos * factor, 0, 1).toFixed(4)),
      minAvailablePairs: Math.max(0, Math.round(props.range.minAvailablePairs / factor)),
      hiddenRatio: Number(clamp(props.range.hiddenRatio * factor, 0, 1).toFixed(4)),
      specialPairCount: Math.max(0, Math.round(props.range.specialPairCount * factor)),
    });
  }
  levels.value = result;
  renderChart();
}

async function loadLevels() {
  loading.value = true;
  try {
    const { data } = await api.get(`/difficulty/${props.range.id}/levels`, { params: { mode: props.mode } });
    levels.value = data.items || [];
    await nextTick();
    renderChart();
  } finally { loading.value = false; }
}

function curveChanged() {
  previewLevels();
}

async function saveCurve() {
  loading.value = true;
  try {
    const { data } = await api.patch(`/difficulty/${props.range.id}`, { ...props.range, ...curve });
    emit('saved', data);
    await loadLevels();
    ElMessage.success(`关卡段 ${data.startLevel}-${data.endLevel} 曲线及小关卡数据已保存`);
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '曲线保存失败');
  } finally { loading.value = false; }
}

async function saveLevel(row: any) {
  try {
    await api.patch(`/difficulty-levels/${row.level}`, row, { params: { mode: props.mode } });
    row.manualOverride = true;
    ElMessage.success(`第 ${row.level} 关已自动保存`);
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '小关卡保存失败');
  }
}

function setLevelCardGrid(row: any, field: 'gridW' | 'gridH', value: number | undefined) {
  row[field] = Math.max(2, Math.round(Number(value) || 1) * 2);
  saveLevel(row);
}

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value);
  chart.setOption({
    animation: false,
    grid: { left: 50, right: 20, top: 25, bottom: 35 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', name: '关卡', data: levels.value.map(item => item.level) },
    yAxis: { type: 'value', name: '难度系数', min: (value: any) => Math.max(0, value.min - 0.05), max: (value: any) => value.max + 0.05 },
    series: [{ type: 'line', smooth: curve.curveType === 'ease', symbolSize: 5, data: levels.value.map(item => item.curveFactor), areaStyle: { opacity: 0.12 } }],
  }, true);
}

onMounted(loadLevels);
onBeforeUnmount(() => { if (chart) chart.dispose(); });
</script>

<template>
  <div class="range-details">
    <div class="curve-controls">
      <strong>段内起伏曲线</strong>
      <el-select v-model="curve.curveType" style="width: 130px" @change="curveChanged">
        <el-option label="平直" value="flat" /><el-option label="线性上升" value="linear" />
        <el-option label="平滑上升" value="ease" /><el-option label="波浪起伏" value="wave" />
      </el-select>
      <span>振幅</span><el-input-number v-model="curve.curveAmplitude" :min="0" :max="0.75" :step="0.01" :precision="2" @input="curveChanged" />
      <span>周期</span><el-input-number v-model="curve.curveCycles" :min="0.25" :max="20" :step="0.25" @input="curveChanged" />
      <el-button type="primary" :loading="loading" @click="saveCurve">保存曲线并生成小关卡</el-button>
    </div>
    <div ref="chartRef" class="difficulty-curve-chart"></div>
    <el-table v-loading="loading" :data="levels" border stripe max-height="440" size="small">
      <el-table-column prop="level" label="关卡" width="65" fixed />
      <el-table-column label="标签" width="100" fixed><template #default="{ row }"><el-select v-model="row.difficultyLabel" @change="saveLevel(row)"><el-option label="简单" value="easy" /><el-option label="普通" value="normal" /><el-option label="困难" value="hard" /></el-select></template></el-table-column>
      <el-table-column label="来源" width="70"><template #default="{ row }"><el-tag v-if="row.manualOverride" type="warning" size="small">手动</el-tag><el-tag v-else type="info" size="small">曲线</el-tag></template></el-table-column>
      <el-table-column prop="curveFactor" label="曲线系数" width="90" />
      <el-table-column label="每层列数" width="95"><template #default="{ row }"><el-input-number :model-value="Math.floor(row.gridW / 2)" :min="1" :controls="false" @change="(value: number | undefined) => setLevelCardGrid(row, 'gridW', value)" /></template></el-table-column>
      <el-table-column label="每层行数" width="95"><template #default="{ row }"><el-input-number :model-value="Math.floor(row.gridH / 2)" :min="1" :controls="false" @change="(value: number | undefined) => setLevelCardGrid(row, 'gridH', value)" /></template></el-table-column>
      <el-table-column label="层数" width="75"><template #default="{ row }"><el-input-number v-model="row.maxLayers" :min="1" :controls="false" @change="saveLevel(row)" /></template></el-table-column>
      <el-table-column label="最少牌" width="85"><template #default="{ row }"><el-input-number v-model="row.minTiles" :step="2" :controls="false" @change="saveLevel(row)" /></template></el-table-column>
      <el-table-column label="最多牌" width="85"><template #default="{ row }"><el-input-number v-model="row.maxTiles" :step="2" :controls="false" @change="saveLevel(row)" /></template></el-table-column>
      <el-table-column label="混乱" width="85"><template #default="{ row }"><el-input-number v-model="row.chaos" :min="0" :max="1" :step="0.01" :controls="false" @change="saveLevel(row)" /></template></el-table-column>
      <el-table-column label="可消除对" width="95"><template #default="{ row }"><el-input-number v-model="row.minAvailablePairs" :controls="false" @change="saveLevel(row)" /></template></el-table-column>
      <el-table-column label="背牌比" width="85"><template #default="{ row }"><el-input-number v-model="row.hiddenRatio" :min="0" :max="1" :step="0.01" :controls="false" @change="saveLevel(row)" /></template></el-table-column>
      <el-table-column label="特殊牌对" width="95"><template #default="{ row }"><el-input-number v-model="row.specialPairCount" :controls="false" @change="saveLevel(row)" /></template></el-table-column>
      <el-table-column label="操作" width="70" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="saveLevel(row)">保存</el-button></template></el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.range-details { padding: 12px 18px 20px; background: #f8fafc; }
.curve-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.curve-controls .el-input-number { width: 120px; }
.difficulty-curve-chart { height: 260px; margin: 12px 0; background: white; }
</style>
