<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as echarts from 'echarts';
import { api, clearToken } from './api';
import Login from './Login.vue';
import DifficultyRangeDetails from './DifficultyRangeDetails.vue';

const activeTab = ref('stats');
const loading = ref(false);
const keyword = ref('');
const players = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const selectedPlayer = ref<any>(null);
const dailyDate = ref('');
const dailyRanks = ref<any[]>([]);
const level = ref(1);
const levelRanks = ref<any[]>([]);
const difficultyRows = ref<any[]>([]);
const difficultyTotal = ref(0);
const difficultyLoading = ref(false);
const difficultyMode = ref('normal');
const autoMatchConfig = ref<Record<number, number>>({});
const autoMatchLoading = ref(false);
const eventKeyword = ref('');
const eventCategory = ref('');
const trackingView = ref('timeline');
const trackingEventOptions = ref<any[]>([]);
const selectedTrackingEvents = ref<string[]>([]);
const trackingDateRange = ref<[Date, Date] | null>(null);
const trackingGrain = ref('hour');
const trackingTimeline = ref<any[]>([]);
const trackingRows = ref<any[]>([]);
const trackingTotal = ref(0);
const trackingPage = ref(1);
const trackingLoading = ref(false);
const trackingChartRef = ref<HTMLElement | null>(null);
const dailyStats = ref<any[]>([]);
const dailyStatsTotal = ref(0);
const dailyStatsPage = ref(1);
const dailyStatsPageSize = ref(20);
const dailyStatsLoading = ref(false);
const dailyStatsDateRange = ref<[string, string] | null>(null);
const onlineStats = ref<any[]>([]);
const onlineStatsTotal = ref(0);
const onlineStatsPage = ref(1);
const onlineStatsPageSize = ref(20);
const onlineStatsLoading = ref(false);
const onlineStatsDateRange = ref<[string, string] | null>(null);
const currentOnline = ref(0);
const currentOnlineLoading = ref(false);
const onlineDurationDate = ref(new Date().toISOString().slice(0, 10));
const onlineDurationData = ref<any[]>([]);
const onlineDurationLoading = ref(false);
const onlineDurationSummary = ref<any>(null);
let trackingChart: echarts.ECharts | null = null;
let currentOnlineTimer: number | null = null;
let trackingResizeObserver: ResizeObserver | null = null;

const trackingEvents = [
  { category: '应用基础', event: '应用启动', key: 'app_launch', trigger: '游戏冷启动、热启动', required: true, params: '启动类型、前后台状态', purpose: '统计新增、启动频次、用户活跃', priority: true },
  { category: '应用基础', event: '会话开始', key: 'session_start', trigger: '每次进入游戏主界面', required: true, params: '会话 ID、进入时间', purpose: '拆分用户会话、计算在线时长' },
  { category: '应用基础', event: '会话结束', key: 'session_end', trigger: '退出游戏、切后台、进程销毁', required: true, params: '在线时长、退出原因', purpose: '付费时长、用户粘性、流失行为', priority: true },
  { category: '应用基础', event: '前后台切换', key: 'app_switch', trigger: '程序切入前台、切至后台', required: true, params: '切换类型、停留时长', purpose: '分析玩家间断游戏行为' },
  { category: '应用基础', event: '游戏崩溃', key: 'app_crash', trigger: '程序闪退、异常报错', required: true, params: '错误码、报错页面、机型', purpose: '降低异常流失、优化长留' },
  { category: '账号体系', event: '账号登录', key: 'user_login', trigger: '游客、账号、第三方登录成功', required: true, params: '登录方式、账号类型', purpose: '区分账号用户、精准留存统计', priority: true },
  { category: '账号体系', event: '账号注册', key: 'user_register', trigger: '完成账号注册流程', required: true, params: '注册渠道、注册方式', purpose: '新增用户转化分析', priority: true },
  { category: '新手引导', event: '引导开始', key: 'tutorial_start', trigger: '首次进入新手教程', required: true, params: '引导版本', purpose: '新手流程漏斗起点' },
  { category: '新手引导', event: '引导步骤', key: 'tutorial_step', trigger: '完成单个引导步骤', required: true, params: '步骤 ID、步骤耗时', purpose: '定位新手卡点、降低前期流失' },
  { category: '新手引导', event: '引导跳过', key: 'tutorial_skip', trigger: '手动跳过新手引导', required: true, params: '跳过节点、引导进度', purpose: '分析跳过引导对留存的影响' },
  { category: '新手引导', event: '引导完成', key: 'tutorial_complete', trigger: '全部新手教程结束', required: true, params: '引导总耗时', purpose: '核心新手完成率、次日留存核心指标' },
  { category: '核心玩法', event: '关卡开始', key: 'level_start', trigger: '点击开始挑战关卡', required: true, params: '关卡 ID、关卡难度、章节', purpose: '核心游戏参与度、生命周期活跃度' },
  { category: '核心玩法', event: '关卡中途退出', key: 'level_quit', trigger: '游戏中主动退出关卡', required: true, params: '关卡 ID、退出节点', purpose: '关卡中途流失分析' },
  { category: '核心玩法', event: '关卡失败', key: 'level_fail', trigger: '关卡挑战失败', required: true, params: '关卡 ID、失败原因、剩余资源', purpose: '定位关卡难度问题、优化留存' },
  { category: '核心玩法', event: '关卡重开', key: 'level_restart', trigger: '失败后重新挑战关卡', required: true, params: '关卡 ID、重玩次数', purpose: '判断玩家热衷、核心粘性' },
  { category: '核心玩法', event: '关卡通关', key: 'level_complete', trigger: '成功通关当前关卡', required: true, params: '关卡 ID、通关耗时、得分、星级', purpose: '玩家成长进度、生命周期分层' },
  { category: '资源经济', event: '货币获取', key: 'currency_add', trigger: '金币、钻石等货币增加', required: true, params: '货币类型、数量、获取来源', purpose: '游戏经济体系、长线留存设计', priority: true },
  { category: '资源经济', event: '货币消耗', key: 'currency_cost', trigger: '花费货币购买、复活、解锁', required: true, params: '货币类型、消耗数量、消耗场景', purpose: '玩家付费与资源依赖度分析', priority: true },
  { category: '资源经济', event: '道具获取', key: 'item_add', trigger: '获得游戏道具、Buff', required: true, params: '道具 ID、数量、获取途径', purpose: '道具投放与玩家留存关联' },
  { category: '资源经济', event: '道具使用', key: 'item_use', trigger: '对局内、界面使用道具', required: true, params: '道具 ID、使用场景、关卡 ID', purpose: '道具依赖、卡关自救行为分析' },
  { category: '广告变现', event: '广告请求', key: 'ad_request', trigger: '发起广告加载请求', required: true, params: '广告位、广告类型', purpose: '变现链路监控' },
  { category: '广告变现', event: '广告展示', key: 'ad_show', trigger: '广告弹窗成功展示', required: true, params: '广告位、广告类型', purpose: 'IAA 变现、玩家激励行为' },
  { category: '广告变现', event: '广告点击', key: 'ad_click', trigger: '点击广告内容', required: false, params: '广告位 ID', purpose: '广告价值分析' },
  { category: '广告变现', event: '广告播放完成', key: 'ad_finish', trigger: '激励视频完整播放结束', required: true, params: '广告类型、奖励内容', purpose: '激励广告依赖、提升活跃留存' },
  { category: '广告变现', event: '广告关闭', key: 'ad_close', trigger: '广告跳过、加载失败', required: false, params: '失败码、关闭类型', purpose: '优化广告体验、减少反感流失' },
  { category: '日常运营', event: '每日签到', key: 'sign_in', trigger: '完成每日签到领取奖励', required: true, params: '签到天数、连续签到次数', purpose: '提升日活、拉动长期留存', priority: true },
  { category: '日常运营', event: '任务领取', key: 'task_receive', trigger: '接取日常、限时任务', required: false, params: '任务 ID、任务类型', purpose: '运营活动粘性', priority: true },
  { category: '日常运营', event: '任务完成', key: 'task_finish', trigger: '达成任务条件并领奖', required: true, params: '任务 ID、奖励类型', purpose: '任务体系对长留的拉动效果', priority: true },
  { category: '页面弹窗', event: '页面访问', key: 'page_view', trigger: '进入任意功能页面', required: true, params: '页面名称、一级页面', purpose: '用户行为路径、流失路径追踪', priority: true },
  { category: '页面弹窗', event: '弹窗展示', key: 'popup_show', trigger: '活动、福利、提示弹窗弹出', required: false, params: '弹窗 ID、弹窗类型', purpose: '运营触达效果', priority: true },
  { category: '页面弹窗', event: '弹窗关闭', key: 'popup_close', trigger: '手动关闭弹窗', required: false, params: '弹窗 ID、关闭方式', purpose: '弹窗体验与用户反感流失', priority: true },
  { category: '社交裂变', event: '分享发起', key: 'share_launch', trigger: '点击分享按钮', required: false, params: '分享场景、分享渠道', purpose: '裂变拉新、回流留存', priority: true },
  { category: '社交裂变', event: '分享成功', key: 'share_success', trigger: '分享发送完成', required: false, params: '分享渠道、奖励内容', purpose: '裂变转化效果', priority: true },
  { category: '回流流失', event: '用户回流', key: 'user_return', trigger: '离线至少 1 天后重新登录', required: true, params: '离线天数、回流渠道', purpose: '回流用户分析、生命周期闭环' },
];

const eventCategories = [...new Set(trackingEvents.map((item) => item.category))];
const filteredTrackingEvents = computed(() => {
  const search = eventKeyword.value.trim().toLowerCase();
  return trackingEvents.filter((item) => {
    if (eventCategory.value && item.category !== eventCategory.value) return false;
    return !search || Object.values(item).some((value) => String(value).toLowerCase().includes(search));
  });
});

function trackingRowClass({ row }: { row: any }) {
  return row.priority ? 'priority-event-row' : '';
}

function trackingRangeParams() {
  const range = trackingDateRange.value;
  return {
    start: range && range[0] ? range[0].toISOString() : undefined,
    end: range && range[1] ? range[1].toISOString() : undefined,
  };
}

async function loadTrackingEventOptions() {
  const { data } = await api.get('/tracking/event-names');
  trackingEventOptions.value = data.items || [];
  if (!selectedTrackingEvents.value.length) {
    selectedTrackingEvents.value = trackingEventOptions.value.slice(0, 5).map((item: any) => item.eventName);
  }
}

async function loadTrackingTimeline() {
  trackingLoading.value = true;
  try {
    const { data } = await api.get('/tracking/timeline', {
      params: {
        eventNames: selectedTrackingEvents.value.join(','),
        grain: trackingGrain.value,
        ...trackingRangeParams(),
      },
    });
    trackingTimeline.value = data.items || [];
    await nextTick();
    renderTrackingChart();
  } finally { trackingLoading.value = false; }
}

async function loadTrackingRows() {
  trackingLoading.value = true;
  try {
    const { data } = await api.get('/tracking/events', {
      params: {
        eventNames: selectedTrackingEvents.value.join(','),
        page: trackingPage.value,
        pageSize: 50,
        ...trackingRangeParams(),
      },
    });
    trackingRows.value = data.items || [];
    trackingTotal.value = data.total || 0;
  } finally { trackingLoading.value = false; }
}

async function refreshTrackingData() {
  trackingPage.value = 1;
  await Promise.all([loadTrackingTimeline(), loadTrackingRows()]);
}

function renderTrackingChart() {
  const container = trackingChartRef.value;
  if (!container || container.clientWidth < 100 || container.clientHeight < 100) return;
  if (!trackingChart || trackingChart.getDom() !== container) {
    if (trackingChart) trackingChart.dispose();
    trackingChart = echarts.init(container);
  }
  const buckets = [...new Set(trackingTimeline.value.map((item: any) => item.bucket))];
  const series = selectedTrackingEvents.value.map((eventName) => {
    const values = new Map(
      trackingTimeline.value
        .filter((item: any) => item.eventName === eventName)
        .map((item: any) => [item.bucket, item.count])
    );
    return { name: eventName, type: 'line', smooth: true, symbolSize: 7, data: buckets.map((bucket) => values.get(bucket) || 0) };
  });
  trackingChart.setOption({
    tooltip: { trigger: 'axis' },
    title: trackingTimeline.value.length ? undefined : {
      text: selectedTrackingEvents.value.length ? '当前时间范围暂无埋点数据' : '请选择要显示的埋点事件',
      left: 'center',
      top: 'middle',
      textStyle: { color: '#94a3b8', fontSize: 15, fontWeight: 'normal' },
    },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 55, right: 25, top: 55, bottom: 65 },
    xAxis: { type: 'category', data: buckets, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', minInterval: 1, name: '数量' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 5 }],
    series,
  }, true);
}

function resizeTrackingChart() {
  const container = trackingChartRef.value;
  if (trackingChart && container && container.clientWidth >= 100 && container.clientHeight >= 100) {
    trackingChart.resize({ width: container.clientWidth, height: container.clientHeight });
  }
}

function disposeTrackingChart() {
  if (trackingChart) {
    trackingChart.dispose();
    trackingChart = null;
  }
}

async function showTrackingChart() {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  renderTrackingChart();
  setTimeout(() => {
    renderTrackingChart();
    resizeTrackingChart();
  }, 320);
}

function displayProperties(value: any): string {
  if (!value) return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const currentAdmin = ref<any>(null);
const checkingAuth = ref(true);

const admins = ref<any[]>([]);
const adminDialogVisible = ref(false);
const adminLoading = ref(false);
const adminForm = reactive({
  id: null as number | null,
  username: '',
  password: '',
  role: 'admin',
  isActive: true,
});
const isEditAdmin = computed(() => !!adminForm.id);

async function loadPlayers() {
  loading.value = true;
  try {
    const { data } = await api.get('/players', { params: { keyword: keyword.value, page: page.value, pageSize: 20 } });
    players.value = data.items;
    total.value = data.total;
  } finally { loading.value = false; }
}

async function openPlayer(playerId: string) {
  const { data } = await api.get(`/players/${encodeURIComponent(playerId)}`);
  selectedPlayer.value = data;
}

async function loadDailyRanks() {
  loading.value = true;
  try {
    const { data } = await api.get('/rankings/daily', { params: { date: dailyDate.value || undefined } });
    dailyDate.value = data.date;
    dailyRanks.value = data.items;
  } finally { loading.value = false; }
}

async function loadLevelRanks() {
  loading.value = true;
  try {
    const { data } = await api.get('/rankings/levels', { params: { level: level.value } });
    levelRanks.value = data.items;
  } finally { loading.value = false; }
}

async function loadDifficulty() {
  difficultyLoading.value = true;
  try {
    const { data } = await api.get('/difficulty', { params: { mode: difficultyMode.value } });
    difficultyRows.value = data.items || [];
    difficultyTotal.value = data.total || 0;
  } finally { difficultyLoading.value = false; }
}

async function saveDifficulty(row: any) {
  difficultyLoading.value = true;
  try {
    const wasNew = !row.id;
    const payload = { ...row, mode: difficultyMode.value };
    const { data } = row.id
      ? await api.patch(`/difficulty/${row.id}`, payload)
      : await api.post('/difficulty', payload);
    Object.assign(row, data);
    if (wasNew) difficultyTotal.value += 1;
    ElMessage.success(`关卡段 ${row.startLevel}-${row.endLevel} 已保存到数据库`);
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '保存失败');
  } finally { difficultyLoading.value = false; }
}

function addDifficultyRange() {
  const highestEnd = difficultyRows.value.reduce((max, item) => Math.max(max, Number(item.endLevel) || 0), 0);
  const startLevel = highestEnd + 1;
  const groupSize = difficultyMode.value === 'signin' ? 31 : 10;
  const maxLevel = difficultyMode.value === 'travel' ? 120 : (difficultyMode.value === 'signin' ? 31 : 1000);
  const safeStart = Math.min(startLevel, maxLevel);
  const safeEnd = Math.min(maxLevel, safeStart + groupSize - 1);
  difficultyRows.value.unshift({
    id: null, startLevel: safeStart, endLevel: safeEnd, difficulty: 1,
    gridW: 10, gridH: 14, maxLayers: 1, minTiles: 20, maxTiles: 40,
    chaos: 0.08, minAvailablePairs: 10, hiddenRatio: 0.04, specialPairCount: 1,
    curveType: 'wave', curveAmplitude: 0.12, curveCycles: 1,
  });
}

function difficultyRangeSaved(row: any, value: any) {
  Object.assign(row, value);
}

function setRangeCardGrid(row: any, field: 'gridW' | 'gridH', value: number | undefined) {
  row[field] = Math.max(2, Math.round(Number(value) || 1) * 2);
}

async function deleteDifficulty(row: any) {
  if (!row.id) { difficultyRows.value = difficultyRows.value.filter((item) => item !== row); return; }
  await ElMessageBox.confirm(`确定删除 ${row.startLevel}-${row.endLevel} 关的难度覆盖吗？`, '删除关卡段', { type: 'warning' });
  await api.delete(`/difficulty/${row.id}`);
  await loadDifficulty();
}

async function resetDifficulty() {
  const modeLabels: Record<string, string> = { normal: '普通', travel: '旅行', signin: '签到' };
  await ElMessageBox.confirm(`将重新生成【${modeLabels[difficultyMode.value]}】难度的默认关卡段，当前修改会被默认值替换，是否继续？`, '恢复默认配置', { type: 'warning' });
  difficultyLoading.value = true;
  try {
    await api.post('/difficulty/reset', null, { params: { mode: difficultyMode.value } });
    await loadDifficulty();
  } finally { difficultyLoading.value = false; }
}

async function loadAutoMatchConfig() {
  autoMatchLoading.value = true;
  try {
    const { data } = await api.get('/auto-match-config');
    autoMatchConfig.value = data.chances || {};
  } finally { autoMatchLoading.value = false; }
}

async function saveAutoMatchConfig() {
  autoMatchLoading.value = true;
  try {
    const chances: Record<number, number> = {};
    for (let i = 1; i <= 8; i += 1) {
      const value = Number(autoMatchConfig.value[i]);
      chances[i] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }
    const { data } = await api.post('/auto-match-config', { chances });
    autoMatchConfig.value = data.chances || {};
    ElMessage.success('自动匹配配置已保存');
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '保存失败');
  } finally { autoMatchLoading.value = false; }
}

async function resetAutoMatchConfig() {
  await ElMessageBox.confirm('将恢复自动匹配的默认概率，当前修改会被替换，是否继续？', '恢复默认配置', { type: 'warning' });
  autoMatchLoading.value = true;
  try {
    const { data } = await api.post('/auto-match-config/reset');
    autoMatchConfig.value = data.chances || {};
    ElMessage.success('已恢复默认配置');
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '恢复失败');
  } finally { autoMatchLoading.value = false; }
}

async function loadAdmins() {
  const { data } = await api.get('/admins');
  admins.value = data.items;
}

async function loadDailyStats() {
  dailyStatsLoading.value = true;
  try {
    const params: any = {
      page: dailyStatsPage.value,
      pageSize: dailyStatsPageSize.value,
    };
    if (dailyStatsDateRange.value && dailyStatsDateRange.value[0]) {
      params.startDate = dailyStatsDateRange.value[0];
    }
    if (dailyStatsDateRange.value && dailyStatsDateRange.value[1]) {
      params.endDate = dailyStatsDateRange.value[1];
    }
    const { data } = await api.get('/daily-stats', { params });
    dailyStats.value = data.items || [];
    dailyStatsTotal.value = data.total || 0;
  } finally { dailyStatsLoading.value = false; }
}

async function refreshDailyStats() {
  dailyStatsPage.value = 1;
  await loadDailyStats();
}

async function syncDailyStats() {
  dailyStatsLoading.value = true;
  try {
    await api.post('/daily-stats/sync');
    await api.post('/online-stats/sync');
    await refreshDailyStats();
  } finally { dailyStatsLoading.value = false; }
}

async function loadOnlineStats() {
  onlineStatsLoading.value = true;
  try {
    const params: any = {
      page: onlineStatsPage.value,
      pageSize: onlineStatsPageSize.value,
    };
    if (onlineStatsDateRange.value && onlineStatsDateRange.value[0]) {
      params.startDate = onlineStatsDateRange.value[0];
    }
    if (onlineStatsDateRange.value && onlineStatsDateRange.value[1]) {
      params.endDate = onlineStatsDateRange.value[1];
    }
    const { data } = await api.get('/online-stats', { params });
    onlineStats.value = data.items || [];
    onlineStatsTotal.value = data.total || 0;
  } finally { onlineStatsLoading.value = false; }
}

async function refreshOnlineStats() {
  onlineStatsPage.value = 1;
  await loadOnlineStats();
}

async function syncOnlineStats() {
  onlineStatsLoading.value = true;
  try {
    await api.post('/online-stats/sync');
    await refreshOnlineStats();
    await loadCurrentOnline();
  } finally { onlineStatsLoading.value = false; }
}

async function loadCurrentOnline() {
  currentOnlineLoading.value = true;
  try {
    const { data } = await api.get('/online-stats/current');
    currentOnline.value = data.currentOnline || 0;
  } finally { currentOnlineLoading.value = false; }
}

async function loadOnlineDuration() {
  onlineDurationLoading.value = true;
  try {
    const { data } = await api.get('/online-duration', {
      params: { date: onlineDurationDate.value || undefined },
    });
    onlineDurationData.value = data.items || [];
    onlineDurationSummary.value = {
      date: data.date,
      totalPaying: data.totalPaying,
      totalNonPaying: data.totalNonPaying,
      totalPlayers: data.totalPlayers,
    };
  } finally { onlineDurationLoading.value = false; }
}

function startCurrentOnlineTimer() {
  stopCurrentOnlineTimer();
  currentOnlineTimer = window.setInterval(loadCurrentOnline, 10000);
}

function stopCurrentOnlineTimer() {
  if (currentOnlineTimer) {
    clearInterval(currentOnlineTimer);
    currentOnlineTimer = null;
  }
}

async function jumpToDailyStatsPage(targetPage: number) {
  const maxPage = Math.max(1, Math.ceil(dailyStatsTotal.value / dailyStatsPageSize.value));
  dailyStatsPage.value = Math.max(1, Math.min(maxPage, targetPage));
  await loadDailyStats();
}

async function loadAll() {
  await Promise.all([loadDailyStats(), loadOnlineStats(), loadCurrentOnline(), loadOnlineDuration(), loadPlayers(), loadDailyRanks(), loadLevelRanks(), loadDifficulty(), loadAutoMatchConfig(), loadAdmins(), loadTrackingEventOptions()]);
  await refreshTrackingData();
}

async function checkAuth() {
  checkingAuth.value = true;
  const token = localStorage.getItem('admin_token');
  if (!token) {
    currentAdmin.value = null;
    checkingAuth.value = false;
    return;
  }
  try {
    const { data } = await api.get('/auth/me');
    currentAdmin.value = data;
  } catch {
    clearToken();
    currentAdmin.value = null;
    checkingAuth.value = false;
    return;
  }
  try {
    await loadAll();
  } catch (err) {
    console.error('load initial data failed', err);
  } finally {
    checkingAuth.value = false;
  }
}

function onLogin(admin: any) {
  currentAdmin.value = admin;
  loadAll();
}

async function logout() {
  try { await api.post('/auth/logout'); } catch {}
  clearToken();
  window.location.reload();
}

function openCreateAdmin() {
  adminForm.id = null;
  adminForm.username = '';
  adminForm.password = '';
  adminForm.role = 'admin';
  adminForm.isActive = true;
  adminDialogVisible.value = true;
}

function openEditAdmin(row: any) {
  adminForm.id = row.id;
  adminForm.username = row.username;
  adminForm.password = '';
  adminForm.role = row.role || 'admin';
  adminForm.isActive = row.isActive;
  adminDialogVisible.value = true;
}

async function saveAdmin() {
  if (!adminForm.username) return;
  adminLoading.value = true;
  try {
    if (isEditAdmin.value) {
      const payload: any = { role: adminForm.role, isActive: adminForm.isActive };
      if (adminForm.password) payload.password = adminForm.password;
      await api.patch(`/admins/${adminForm.id}`, payload);
    } else {
      await api.post('/admins', {
        username: adminForm.username,
        password: adminForm.password,
        role: adminForm.role,
      });
    }
    adminDialogVisible.value = false;
    await loadAdmins();
  } finally { adminLoading.value = false; }
}

async function deleteAdmin(id: number) {
  try {
    await ElMessageBox.confirm('确定删除该后台账号？', '提示', { type: 'warning' });
    await api.delete(`/admins/${id}`);
    await loadAdmins();
  } catch {}
}

onMounted(() => {
  window.addEventListener('resize', resizeTrackingChart);
  trackingResizeObserver = new ResizeObserver(() => resizeTrackingChart());
  checkAuth();
});
watch([activeTab, trackingView], async () => {
  if (activeTab.value === 'tracking' && trackingView.value === 'timeline') {
    if (!trackingEventOptions.value.length) await loadTrackingEventOptions();
    await loadTrackingTimeline();
    await showTrackingChart();
    if (trackingResizeObserver && trackingChartRef.value) {
      trackingResizeObserver.disconnect();
      trackingResizeObserver.observe(trackingChartRef.value);
    }
  } else {
    if (trackingResizeObserver) trackingResizeObserver.disconnect();
    disposeTrackingChart();
  }

  if (activeTab.value === 'online') {
    await loadCurrentOnline();
    startCurrentOnlineTimer();
  } else {
    stopCurrentOnlineTimer();
  }

  if (activeTab.value === 'online-duration') {
    if (!onlineDurationDate.value) {
      onlineDurationDate.value = new Date().toISOString().slice(0, 10);
    }
    await loadOnlineDuration();
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeTrackingChart);
  if (trackingResizeObserver) trackingResizeObserver.disconnect();
  disposeTrackingChart();
  stopCurrentOnlineTimer();
});
</script>

<template>
  <div v-if="checkingAuth" class="auth-loading">
    <el-icon class="is-loading" :size="32"><Loading /></el-icon>
  </div>

  <Login v-else-if="!currentAdmin" @success="onLogin" />

  <template v-else>
    <el-container class="layout">
      <el-header>
        <strong>VITA 数据后台</strong>
        <span>角色与排行</span>
        <div class="header-right">
          <span>{{ currentAdmin.username }}</span>
          <el-button type="danger" size="small" plain @click="logout">退出登录</el-button>
        </div>
      </el-header>
      <el-main>
        <div class="main-layout">
          <el-menu :default-active="activeTab" class="side-menu" @select="activeTab = $event">
            <el-sub-menu index="data">
              <template #title><span>数据统计</span></template>
              <el-menu-item index="stats">总数据</el-menu-item>
              <el-menu-item index="online">在线数据</el-menu-item>
              <el-menu-item index="online-duration">在线时长</el-menu-item>
              <el-menu-item index="daily">每日排行</el-menu-item>
              <el-menu-item index="levels">关卡排行</el-menu-item>
              <el-menu-item index="tracking">埋点配置</el-menu-item>
            </el-sub-menu>
            <el-sub-menu index="players">
              <template #title><span>玩家信息</span></template>
              <el-menu-item index="players">角色信息</el-menu-item>
            </el-sub-menu>
            <el-sub-menu index="admin">
              <template #title><span>后台管理</span></template>
              <el-menu-item index="admins">后台账号</el-menu-item>
              <el-menu-item index="difficulty">难度设置</el-menu-item>
              <el-menu-item index="auto-match">自动匹配</el-menu-item>
            </el-sub-menu>
          </el-menu>
          <div class="main-content">
          <div v-show="activeTab === 'stats'">
            <h2>总数据</h2>
            <el-table v-loading="dailyStatsLoading" :data="dailyStats" stripe border class="daily-stats-table">
              <el-table-column prop="statDate" label="日期" width="110" fixed align="center" />
              <el-table-column prop="loginCount" label="登录数" width="90" align="center" />
              <el-table-column prop="newUsers" label="新增用户" width="100" align="center" />
              <el-table-column prop="peakOnline" label="最高在线" width="100" align="center" />
              <el-table-column prop="avgOnline" label="平均在线" width="100" align="center" />
              <el-table-column prop="payingUsers" label="付费人数" width="100" align="center" />
              <el-table-column prop="retentionD1" label="次日留存数" width="110" align="center" />
              <el-table-column prop="retentionD1Rate" label="次日留存率" width="110" align="center">
                <template #default="{ row }">{{ row.retentionD1Rate }}%</template>
              </el-table-column>
              <el-table-column prop="retentionD3" label="3日留存数" width="110" align="center" />
              <el-table-column prop="retentionD3Rate" label="3日留存率" width="110" align="center">
                <template #default="{ row }">{{ row.retentionD3Rate }}%</template>
              </el-table-column>
              <el-table-column prop="retentionD7" label="7日留存数" width="110" align="center" />
              <el-table-column prop="retentionD7Rate" label="7日留存率" width="110" align="center">
                <template #default="{ row }">{{ row.retentionD7Rate }}%</template>
              </el-table-column>
              <el-table-column prop="retentionD15" label="15日留存数" width="120" align="center" />
              <el-table-column prop="retentionD15Rate" label="15日留存率" width="120" align="center">
                <template #default="{ row }">{{ row.retentionD15Rate }}%</template>
              </el-table-column>
            </el-table>
            <div class="pagination-bar">
              <el-date-picker
                v-model="dailyStatsDateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                style="width: 220px"
              />
              <el-button type="primary" :loading="dailyStatsLoading" @click="refreshDailyStats">查询</el-button>
              <el-button :loading="dailyStatsLoading" @click="refreshDailyStats">刷新</el-button>
              <el-button type="success" :loading="dailyStatsLoading" @click="syncDailyStats">同步数据</el-button>
              <el-pagination
                v-model:current-page="dailyStatsPage"
                v-model:page-size="dailyStatsPageSize"
                :page-sizes="[10, 20, 50, 100]"
                :total="dailyStatsTotal"
                layout="total, sizes, prev, pager, next, jumper"
                @current-change="loadDailyStats"
                @size-change="dailyStatsPage = 1; loadDailyStats()"
              />
              <div class="page-jump-ext">
                <el-button size="small" @click="jumpToDailyStatsPage(1)">首页</el-button>
                <el-button size="small" @click="jumpToDailyStatsPage(Math.max(1, Math.ceil(dailyStatsTotal / dailyStatsPageSize)))">末页</el-button>
                <span class="page-info">第 {{ dailyStatsPage }} / {{ Math.max(1, Math.ceil(dailyStatsTotal / dailyStatsPageSize)) }} 页</span>
              </div>
            </div>
          </div>

          <div v-show="activeTab === 'online'">
            <h2>在线数据</h2>
            <div class="stats-grid" style="margin-bottom: 18px;">
              <el-card shadow="hover" class="stats-card">
                <el-statistic title="当前在线" :value="currentOnline" />
              </el-card>
            </div>
            <el-table v-loading="onlineStatsLoading" :data="onlineStats" stripe border class="daily-stats-table">
              <el-table-column prop="statDate" label="日期" width="110" fixed align="center" />
              <el-table-column prop="realtimeOnline" label="实时在线" width="100" align="center" />
              <el-table-column prop="avgOnline" label="平均在线" width="100" align="center" />
              <el-table-column prop="totalOnline" label="总在线" width="100" align="center" />
            </el-table>
            <div class="pagination-bar">
              <el-date-picker
                v-model="onlineStatsDateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                style="width: 220px"
              />
              <el-button type="primary" :loading="onlineStatsLoading" @click="refreshOnlineStats">查询</el-button>
              <el-button :loading="onlineStatsLoading" @click="refreshOnlineStats">刷新</el-button>
              <el-button type="success" :loading="onlineStatsLoading" @click="syncOnlineStats">同步数据</el-button>
              <el-pagination
                v-model:current-page="onlineStatsPage"
                v-model:page-size="onlineStatsPageSize"
                :page-sizes="[10, 20, 50, 100]"
                :total="onlineStatsTotal"
                layout="total, sizes, prev, pager, next, jumper"
                @current-change="loadOnlineStats"
                @size-change="onlineStatsPage = 1; loadOnlineStats()"
              />
              <div class="page-jump-ext">
                <el-button size="small" @click="onlineStatsPage = 1; loadOnlineStats()">首页</el-button>
                <el-button size="small" @click="onlineStatsPage = Math.max(1, Math.ceil(onlineStatsTotal / onlineStatsPageSize)); loadOnlineStats()">末页</el-button>
                <span class="page-info">第 {{ onlineStatsPage }} / {{ Math.max(1, Math.ceil(onlineStatsTotal / onlineStatsPageSize)) }} 页</span>
              </div>
            </div>
          </div>

          <div v-show="activeTab === 'online-duration'">
            <h2>在线时长</h2>
            <div class="toolbar">
              <el-date-picker v-model="onlineDurationDate" value-format="YYYY-MM-DD" placeholder="选择日期" @change="loadOnlineDuration" />
              <el-button type="primary" :loading="onlineDurationLoading" @click="loadOnlineDuration">查询</el-button>
            </div>
            <div v-if="onlineDurationSummary" class="online-duration-summary">
              <span>日期：{{ onlineDurationSummary.date }}</span>
              <span>RMB玩家：{{ onlineDurationSummary.totalPaying }}</span>
              <span>非RMB玩家：{{ onlineDurationSummary.totalNonPaying }}</span>
              <span>总玩家：{{ onlineDurationSummary.totalPlayers }}</span>
            </div>
            <el-table v-loading="onlineDurationLoading" :data="onlineDurationData" stripe border class="daily-stats-table">
              <el-table-column prop="duration" label="在线时长(分钟)" width="140" align="center" />
              <el-table-column prop="payingPlayers" label="RMB玩家" width="110" align="center" />
              <el-table-column prop="payingRatio" label="RMB玩家占比" width="130" align="center">
                <template #default="{ row }">{{ row.payingRatio }}%</template>
              </el-table-column>
              <el-table-column prop="nonPayingPlayers" label="非RMB玩家" width="120" align="center" />
              <el-table-column prop="nonPayingRatio" label="非RMB玩家占比" width="150" align="center">
                <template #default="{ row }">{{ row.nonPayingRatio }}%</template>
              </el-table-column>
              <el-table-column prop="totalPlayers" label="总玩家" width="100" align="center" />
            </el-table>
          </div>

          <div v-show="activeTab === 'players'">
            <div class="toolbar">
              <el-input v-model="keyword" clearable placeholder="角色ID、名称或账号" @keyup.enter="page = 1; loadPlayers()" />
              <el-button type="primary" @click="page = 1; loadPlayers()">查询</el-button>
            </div>
            <el-table v-loading="loading" :data="players" stripe @row-click="(row: any) => openPlayer(row.playerId)">
              <el-table-column prop="playerId" label="角色 ID" min-width="240" />
              <el-table-column prop="name" label="角色名" min-width="140" />
              <el-table-column prop="account" label="账号" min-width="160" />
              <el-table-column prop="maxLevel" label="最高关卡" width="100" />
              <el-table-column prop="maxScore" label="最高分" width="120" />
              <el-table-column prop="scoreCount" label="挑战次数" width="100" />
              <el-table-column prop="updatedAt" label="更新时间" min-width="180" />
            </el-table>
            <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="prev, pager, next, total" @current-change="loadPlayers" />
          </div>

          <div v-show="activeTab === 'daily'">
            <div class="toolbar">
              <el-date-picker v-model="dailyDate" value-format="YYYY-MM-DD" placeholder="选择日期" />
              <el-button type="primary" @click="loadDailyRanks">查询</el-button>
            </div>
            <el-table v-loading="loading" :data="dailyRanks" stripe>
              <el-table-column prop="rank" label="名次" width="80" />
              <el-table-column prop="name" label="角色名" min-width="140" />
              <el-table-column prop="playerId" label="角色 ID" min-width="240" />
              <el-table-column prop="specialScore" label="特殊积分" width="120" />
              <el-table-column prop="level" label="关卡" width="90" />
              <el-table-column prop="score" label="分数" width="120" />
              <el-table-column prop="timeMs" label="耗时(ms)" width="120" />
            </el-table>
          </div>

          <div v-show="activeTab === 'levels'">
            <div class="toolbar">
              <el-input-number v-model="level" :min="1" :max="1000" />
              <el-button type="primary" @click="loadLevelRanks">查询</el-button>
            </div>
            <el-table v-loading="loading" :data="levelRanks" stripe>
              <el-table-column prop="rank" label="名次" width="80" />
              <el-table-column prop="name" label="角色名" min-width="140" />
              <el-table-column prop="playerId" label="角色 ID" min-width="240" />
              <el-table-column prop="score" label="最高分" width="120" />
              <el-table-column prop="combo" label="连击" width="100" />
              <el-table-column prop="timeMs" label="最短耗时(ms)" width="140" />
              <el-table-column prop="attempts" label="挑战次数" width="110" />
            </el-table>
          </div>

          <div v-show="activeTab === 'tracking'">
            <el-tabs v-model="trackingView" class="tracking-tabs">
              <el-tab-pane label="数量趋势" name="timeline">
                <div class="toolbar tracking-data-toolbar">
                  <el-date-picker v-model="trackingDateRange" type="datetimerange" range-separator="至" start-placeholder="开始时间" end-placeholder="结束时间" style="width: 320px" />
                  <el-radio-group v-model="trackingGrain">
                    <el-radio-button value="hour">小时</el-radio-button>
                    <el-radio-button value="day">天</el-radio-button>
                  </el-radio-group>
                  <el-button type="primary" :loading="trackingLoading" @click="refreshTrackingData">查询</el-button>
                </div>
                <div ref="trackingChartRef" class="tracking-chart"></div>
              </el-tab-pane>

              <el-tab-pane label="数据明细" name="events">
                <div class="toolbar tracking-data-toolbar">
                  <el-select v-model="selectedTrackingEvents" multiple collapse-tags placeholder="选择埋点事件" style="width: 420px">
                    <el-option v-for="item in trackingEventOptions" :key="item.eventName" :label="item.eventName" :value="item.eventName" />
                  </el-select>
                  <el-date-picker v-model="trackingDateRange" type="datetimerange" range-separator="至" start-placeholder="开始时间" end-placeholder="结束时间" style="width: 320px" />
                  <el-button type="primary" :loading="trackingLoading" @click="refreshTrackingData">查询</el-button>
                </div>
                <el-table v-loading="trackingLoading" :data="trackingRows" stripe border>
                  <el-table-column prop="clientTime" label="客户端时间" min-width="180" />
                  <el-table-column prop="eventName" label="事件名" width="170"><template #default="{ row }"><code>{{ row.eventName }}</code></template></el-table-column>
                  <el-table-column prop="playerId" label="角色 ID" min-width="220" />
                  <el-table-column prop="sessionId" label="会话 ID" min-width="220" show-overflow-tooltip />
                  <el-table-column prop="platform" label="平台" width="100" />
                  <el-table-column prop="appVersion" label="版本" width="110" />
                  <el-table-column prop="properties" label="参数" min-width="320" show-overflow-tooltip>
                    <template #default="{ row }">{{ displayProperties(row.properties) }}</template>
                  </el-table-column>
                </el-table>
                <el-pagination v-model:current-page="trackingPage" :page-size="50" :total="trackingTotal" layout="prev, pager, next, total" @current-change="loadTrackingRows" />
              </el-tab-pane>

              <el-tab-pane label="事件配置" name="config">
                <div class="toolbar tracking-toolbar">
                  <el-select v-model="eventCategory" clearable placeholder="全部分类" style="width: 160px">
                    <el-option v-for="category in eventCategories" :key="category" :label="category" :value="category" />
                  </el-select>
                  <el-input v-model="eventKeyword" clearable placeholder="搜索事件、事件名、参数或统计目的" />
                  <el-tag type="danger">重点埋点</el-tag>
                  <span class="event-count">共 {{ filteredTrackingEvents.length }} 项</span>
                </div>
                <el-table :data="filteredTrackingEvents" border stripe class="tracking-table" :row-class-name="trackingRowClass">
                  <el-table-column prop="category" label="分类" width="100" fixed />
                  <el-table-column prop="event" label="事件" width="120" fixed />
                  <el-table-column prop="key" label="事件名" width="170"><template #default="{ row }"><code>{{ row.key }}</code></template></el-table-column>
                  <el-table-column prop="trigger" label="触发时机" min-width="210" />
                  <el-table-column prop="required" label="必报" width="75" align="center"><template #default="{ row }"><el-tag :type="row.required ? 'success' : 'info'" size="small">{{ row.required ? '是' : '否' }}</el-tag></template></el-table-column>
                  <el-table-column prop="params" label="参数" min-width="230" />
                  <el-table-column prop="purpose" label="统计目的" min-width="250" />
                </el-table>
              </el-tab-pane>
            </el-tabs>
          </div>

          <div v-show="activeTab === 'difficulty'">
            <div class="toolbar difficulty-toolbar">
              <el-select v-model="difficultyMode" style="width: 120px" @change="loadDifficulty">
                <el-option label="普通" value="normal" />
                <el-option label="旅行" value="travel" />
                <el-option label="签到" value="signin" />
              </el-select>
              <el-button type="primary" @click="addDifficultyRange">新增关卡段</el-button>
              <el-button :loading="difficultyLoading" @click="loadDifficulty">刷新</el-button>
              <el-button type="warning" plain :loading="difficultyLoading" @click="resetDifficulty">恢复默认配置</el-button>
              <span class="difficulty-tip">当前模式：{{ difficultyMode === 'travel' ? '旅行（120关，10关一组）' : (difficultyMode === 'signin' ? '签到（1组，1-31关）' : '普通（1000关）') }}</span>
            </div>
            <el-table v-loading="difficultyLoading" :data="difficultyRows" border stripe class="difficulty-table">
              <el-table-column type="expand" width="48"><template #default="{ row }"><DifficultyRangeDetails v-if="row.id" :range="row" :mode="difficultyMode" @saved="(value: any) => difficultyRangeSaved(row, value)" /><div v-else class="difficulty-tip">请先保存新关卡段，再展开设置曲线。</div></template></el-table-column>
              <el-table-column label="起始关" width="90" fixed><template #default="{ row }"><el-input-number v-model="row.startLevel" :min="1" :controls="false" /></template></el-table-column>
              <el-table-column label="结束关" width="90" fixed><template #default="{ row }"><el-input-number v-model="row.endLevel" :min="row.startLevel || 1" :controls="false" /></template></el-table-column>
              <el-table-column label="难度" width="100"><template #default="{ row }"><el-input-number v-model="row.difficulty" :min="1" :max="3" :controls="false" /></template></el-table-column>
              <el-table-column label="每层列数" width="100"><template #default="{ row }"><el-input-number :model-value="Math.floor(row.gridW / 2)" :min="1" :controls="false" @change="(value: number | undefined) => setRangeCardGrid(row, 'gridW', value)" /></template></el-table-column>
              <el-table-column label="每层行数" width="100"><template #default="{ row }"><el-input-number :model-value="Math.floor(row.gridH / 2)" :min="1" :controls="false" @change="(value: number | undefined) => setRangeCardGrid(row, 'gridH', value)" /></template></el-table-column>
              <el-table-column label="层数" width="85"><template #default="{ row }"><el-input-number v-model="row.maxLayers" :min="1" :max="20" :controls="false" /></template></el-table-column>
              <el-table-column label="最少牌数" width="100"><template #default="{ row }"><el-input-number v-model="row.minTiles" :min="0" :step="2" :controls="false" /></template></el-table-column>
              <el-table-column label="最多牌数" width="100"><template #default="{ row }"><el-input-number v-model="row.maxTiles" :min="0" :step="2" :controls="false" /></template></el-table-column>
              <el-table-column label="混乱系数" width="105"><template #default="{ row }"><el-input-number v-model="row.chaos" :min="0" :max="1" :step="0.01" :precision="2" :controls="false" /></template></el-table-column>
              <el-table-column label="可消除对数" width="115"><template #default="{ row }"><el-input-number v-model="row.minAvailablePairs" :min="0" :controls="false" /></template></el-table-column>
              <el-table-column label="背牌比例" width="105"><template #default="{ row }"><el-input-number v-model="row.hiddenRatio" :min="0" :max="1" :step="0.01" :precision="2" :controls="false" /></template></el-table-column>
              <el-table-column label="特殊牌对数" width="115"><template #default="{ row }"><el-input-number v-model="row.specialPairCount" :min="0" :controls="false" /></template></el-table-column>
              <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="saveDifficulty(row)">保存</el-button><el-button link type="danger" @click="deleteDifficulty(row)">删除</el-button></template></el-table-column>
            </el-table>
            <div class="difficulty-count">共 {{ difficultyTotal }} 个关卡段</div>
          </div>

          <div v-show="activeTab === 'auto-match'">
            <div class="toolbar">
              <el-button type="primary" :loading="autoMatchLoading" @click="saveAutoMatchConfig">保存配置</el-button>
              <el-button :loading="autoMatchLoading" @click="loadAutoMatchConfig">刷新</el-button>
              <el-button type="warning" plain :loading="autoMatchLoading" @click="resetAutoMatchConfig">恢复默认</el-button>
            </div>
            <el-form label-width="120px" class="auto-match-form">
              <el-form-item v-for="pair in [8, 7, 6, 5, 4, 3, 2, 1]" :key="pair" :label="`剩余 ${pair} 对`">
                <el-input-number
                  v-model="autoMatchConfig[pair]"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  :precision="2"
                  :controls="false"
                  style="width: 140px"
                />
                <span class="auto-match-hint">触发概率（0~1）</span>
              </el-form-item>
            </el-form>
          </div>

          <div v-show="activeTab === 'admins'">
            <div class="toolbar">
              <el-button type="primary" @click="openCreateAdmin">新增账号</el-button>
            </div>
            <el-table :data="admins" stripe>
              <el-table-column prop="id" label="ID" width="80" />
              <el-table-column prop="username" label="账号" min-width="140" />
              <el-table-column prop="role" label="角色" width="120" />
              <el-table-column prop="isActive" label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '禁用' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="createdAt" label="创建时间" min-width="180" />
              <el-table-column label="操作" width="160">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openEditAdmin(row)">编辑</el-button>
                  <el-button link type="danger" @click="deleteAdmin(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
          </div>
        </div>
      </el-main>
    </el-container>

    <el-drawer v-model="selectedPlayer" title="角色详情" size="60%">
      <template v-if="selectedPlayer">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="角色 ID">{{ selectedPlayer.player.playerId }}</el-descriptions-item>
          <el-descriptions-item label="角色名">{{ selectedPlayer.player.name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="账号">{{ selectedPlayer.player.account || '-' }}</el-descriptions-item>
          <el-descriptions-item label="游戏名">{{ selectedPlayer.player.gameName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="头像">{{ selectedPlayer.player.avatarId }}</el-descriptions-item>
          <el-descriptions-item label="头像框">{{ selectedPlayer.player.avatarFrameId }}</el-descriptions-item>
        </el-descriptions>
        <h3>最近 100 次成绩</h3>
        <el-table :data="selectedPlayer.recentScores" size="small">
          <el-table-column prop="level" label="关卡" />
          <el-table-column prop="score" label="分数" />
          <el-table-column prop="combo" label="连击" />
          <el-table-column prop="specialScore" label="特殊积分" />
          <el-table-column prop="timeMs" label="耗时(ms)" />
          <el-table-column prop="createdAt" label="时间" min-width="180" />
        </el-table>
      </template>
    </el-drawer>

    <el-dialog v-model="adminDialogVisible" :title="isEditAdmin ? '编辑账号' : '新增账号'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="账号">
          <el-input v-model="adminForm.username" :disabled="isEditAdmin" placeholder="请输入账号" />
        </el-form-item>
        <el-form-item :label="isEditAdmin ? '新密码' : '密码'">
          <el-input v-model="adminForm.password" type="password" show-password :placeholder="isEditAdmin ? '留空则不修改' : '请输入密码'" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="adminForm.role" style="width: 100%">
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="adminForm.isActive" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adminDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="adminLoading" @click="saveAdmin">保存</el-button>
      </template>
    </el-dialog>
  </template>
</template>

<style scoped>
.auto-match-form {
  max-width: 420px;
  margin-top: 12px;
}
.auto-match-hint {
  margin-left: 12px;
  color: #94a3b8;
  font-size: 13px;
}
</style>
