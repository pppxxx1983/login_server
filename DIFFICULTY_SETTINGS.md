# 难度设置参数说明

本文档说明 `analytics` 管理后台里的“难度设置”功能，包括可配置参数、默认生成规则、曲线生成逻辑、接口和数据表。

## 功能入口

- 前端入口：`web/src/App.vue`，左侧菜单“难度设置”。
- 小关卡展开面板：`web/src/DifficultyRangeDetails.vue`。
- 后端接口：`server/src/difficulty.controller.ts`。
- 默认参数算法：`server/src/difficulty-config.ts`。
- 段内曲线算法：`server/src/difficulty-curve.ts`。
- 数据表初始化：`server/src/database.service.ts`。

## 难度模式

系统支持 3 种模式，接口通过 `mode` 参数区分：

| mode | 名称 | 最大关卡 | 默认分组 |
| --- | --- | ---: | --- |
| `normal` | 普通 | 1000 | 每 100 关为一个大段，大段内分组长度递增：1-100 每 10 关一组，101-200 每 20 关一组，依此类推 |
| `travel` | 旅行 | 120 | 每 10 关一组，共 12 组 |
| `signin` | 签到 | 31 | 1-31 关为 1 组 |

模式配置文件为 `server/config/difficulty-modes.json`。当前后端真正生效的最大关卡和默认分组规则定义在 `server/src/difficulty.controller.ts` 的 `MODE_CONFIG` 和 `buildDefaults()` 中。

## 配置层级

难度设置分两层：

1. 关卡段配置，存储在 `game_difficulty_ranges`。
   关卡段是模板，例如 1-10 关共用一套基础参数和一条段内曲线。

2. 小关卡配置，存储在 `game_difficulty_levels`。
   保存关卡段时，系统会根据关卡段参数和曲线系数生成每一关的实际参数。

如果某个小关卡被手动编辑，`manual_override` 会变成 `1`。之后重新保存关卡段时，该关卡的多数玩法参数会保留手动值，只更新 `range_id` 和 `curve_factor`。

## 关卡段参数

| 前端名称 | 字段 | 类型/范围 | 含义 |
| --- | --- | --- | --- |
| 起始关 | `startLevel` / `start_level` | 整数，>= 1 | 关卡段起始关卡 |
| 结束关 | `endLevel` / `end_level` | 整数，>= 起始关 | 关卡段结束关卡，不能超过当前模式最大关卡 |
| 难度 | `difficulty` | 1, 2, 3 | 段基础难度等级，1 简单，2 普通，3 困难 |
| 每层列数 | `gridW` / `grid_w` | 非负整数，生成时至少 2 且取偶数 | 棋盘横向格子数；前端小关卡面板按 `gridW / 2` 显示为“每层列数” |
| 每层行数 | `gridH` / `grid_h` | 非负整数，生成时至少 2 且取偶数 | 棋盘纵向格子数；前端小关卡面板按 `gridH / 2` 显示为“每层行数” |
| 层数 | `maxLayers` / `max_layers` | 1-20 | 最大堆叠层数 |
| 最少牌 | `minTiles` / `min_tiles` | 偶数，<= 最多牌 | 生成关卡时的最少牌数量 |
| 最多牌 | `maxTiles` / `max_tiles` | 偶数，>= 最少牌 | 生成关卡时的最多牌数量 |
| 混乱 | `chaos` | 0-1 | 布局混乱度，值越大通常越难 |
| 可消除对 | `minAvailablePairs` / `min_available_pairs` | 非负整数 | 初始/生成时至少保证的可消除牌对数量；曲线变难时会减少 |
| 背牌比 | `hiddenRatio` / `hidden_ratio` | 0-1 | 背牌或隐藏牌比例，值越大通常越难 |
| 特殊牌对 | `specialPairCount` / `special_pair_count` | 非负整数 | 特殊牌对数量 |
| 曲线类型 | `curveType` / `curve_type` | `flat`、`linear`、`ease`、`wave` | 段内难度起伏方式 |
| 曲线振幅 | `curveAmplitude` / `curve_amplitude` | 0-0.75 | 曲线对基础参数的影响强度 |
| 曲线周期 | `curveCycles` / `curve_cycles` | 0.25-20 | `wave` 类型的波动周期数 |

## 曲线类型

每个小关卡会先计算段内进度：

```text
progress = (level - startLevel) / (endLevel - startLevel)
```

当关卡段只有 1 关时，`progress = 0`。

不同曲线类型的偏移量：

| 曲线类型 | 公式 | 说明 |
| --- | --- | --- |
| `flat` | `0` | 全段不波动，系数恒为 1 |
| `linear` | `progress * 2 - 1` | 从低到高线性递增 |
| `ease` | `-cos(pi * progress)` | 从低到高平滑递增 |
| `wave` | `sin(2 * pi * max(0.25, curveCycles) * progress)` | 按周期波动，默认 1 个周期 |

最终曲线系数：

```text
curveFactor = clamp(1 + curveAmplitude * offset, 0.25, 3)
```

小关卡难度标签根据 `curveFactor` 决定：

| 条件 | `difficulty` | `difficultyLabel` |
| --- | ---: | --- |
| `curveFactor < 0.95` | 1 | `easy` |
| `0.95 <= curveFactor <= 1.05` | 2 | `normal` |
| `curveFactor > 1.05` | 3 | `hard` |

## 小关卡参数生成规则

保存关卡段后，`materializeRange()` 会按以下规则生成小关卡：

| 字段 | 生成规则 |
| --- | --- |
| `gridW` | `max(2, even(range.gridW * curveFactor))` |
| `gridH` | `max(2, even(range.gridH * curveFactor))` |
| `maxLayers` | `max(1, round(range.maxLayers * curveFactor))` |
| `minTiles` | `even(range.minTiles * curveFactor)` |
| `maxTiles` | `even(range.maxTiles * curveFactor)` |
| `chaos` | `clamp(range.chaos * curveFactor, 0, 1)`，保留 4 位小数 |
| `minAvailablePairs` | `max(0, round(range.minAvailablePairs / curveFactor))` |
| `hiddenRatio` | `clamp(range.hiddenRatio * curveFactor, 0, 1)`，保留 4 位小数 |
| `specialPairCount` | `max(0, round(range.specialPairCount * curveFactor))` |

其中 `even()` 会把数值四舍五入到最接近的偶数。

注意：`minAvailablePairs` 与其他难度参数方向相反。曲线系数越大，棋盘、牌数、混乱、背牌、特殊牌对通常越高，但可消除对会除以系数，因此变少。

## 默认参数生成规则

默认参数由 `createDefaultDifficultyLevel(level, baseDifficulty = 1)` 生成。

### 默认难度节奏

每 10 关为一个循环：

- 第 4-7 关，即 `(level - 1) % 10` 为 3 到 6 时，默认提高一个难度档。
- 其他关默认使用较低难度档。
- `baseDifficulty` 默认为 1，所以常规结果主要在难度 1 和 2 之间切换。

### 随关卡进度增长

`progress = (min(level, 1000) - 1) / 999`。

核心增长规则：

- `gridW` 从 10 起步，最多增长到 18，步长为 2。
- `gridH` 从 14 起步，最多增长到 18，步长为 2。
- `maxLayers` 随关卡阈值增长：
  - `level > 120`：2 层
  - `level > 260`：3 层
  - `level > 420`：4 层
  - `level > 600`：5 层
  - `level > 760`：6 层
  - `level > 900`：7 层
  - `level > 970`：8 层
- `minTiles`、`maxTiles` 随进度增长，并受容量上限限制。
- `chaos` 基础为 `0.08 + progress * 0.82`，再叠加难度档偏移。
- `hiddenRatio` 基础为 `0.08 + progress * 0.27`，再叠加难度档偏移。
- `specialPairCount` 随进度和难度档增加，最多 10。
- `minAvailablePairs` 随进度减少，难度越高额外减少。

### 难度档 profile

| 难度 | 牌数倍率 | 混乱偏移 | 背牌偏移 | 可消除对修正 | 层数修正 | 特殊牌对范围 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 0.88 | -0.12 | -0.04 | +2 | -1 | 1-4 |
| 2 | 1.00 | 0 | 0 | 0 | 0 | 1-7 |
| 3 | 1.10 | +0.13 | +0.05 | -1 | +1 | 2-10 |

## 管理后台行为

- “新增关卡段”会按当前模式自动给出下一个关卡段：
  - 普通、旅行：默认新增 10 关。
  - 签到：默认新增 31 关。
  - 普通最多 1000 关，旅行最多 120 关，签到最多 31 关。
- 保存关卡段时会校验：
  - 同一模式下关卡段不能重叠。
  - 结束关不能超过模式最大关卡。
  - 难度只能是 1、2、3。
  - 层数为 1-20。
  - 最少牌和最多牌必须是偶数，且最少牌不能大于最多牌。
  - `chaos`、`hiddenRatio` 必须在 0-1。
  - `curveAmplitude` 必须在 0-0.75，`curveCycles` 必须在 0.25-20。
- 展开关卡段后，可以预览曲线和小关卡参数。
- 修改曲线并保存，会重新生成该关卡段的小关卡数据。
- 修改单个小关卡会立即保存，并把 `manualOverride` 标记为手动。
- “恢复默认配置”会删除当前模式下已有的关卡段和小关卡，再按默认规则重建。

## 接口说明

所有接口都经过 `AdminTokenGuard`，需要后台管理员登录态。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/difficulty?mode=normal` | 查询某模式的关卡段列表 |
| `GET` | `/difficulty/:id/levels?mode=normal` | 查询某关卡段的小关卡列表 |
| `POST` | `/difficulty` | 新增关卡段，并生成小关卡 |
| `PATCH` | `/difficulty/:id` | 更新关卡段，并重新生成小关卡 |
| `DELETE` | `/difficulty/:id` | 删除关卡段及其小关卡 |
| `POST` | `/difficulty/reset?mode=normal` | 重建某模式默认配置 |
| `PATCH` | `/difficulty-levels/:level?mode=normal` | 手动更新单个小关卡 |

## 数据表

### `game_difficulty_ranges`

关卡段模板表。

| 字段 | 说明 |
| --- | --- |
| `id` | 自增主键 |
| `mode` | 模式：`normal`、`travel`、`signin` |
| `start_level` / `end_level` | 关卡段范围 |
| `difficulty` | 段基础难度 |
| `grid_w` / `grid_h` | 棋盘尺寸基础值 |
| `max_layers` | 最大层数基础值 |
| `min_tiles` / `max_tiles` | 牌数范围基础值 |
| `chaos` | 混乱度基础值 |
| `min_available_pairs` | 可消除对基础值 |
| `hidden_ratio` | 背牌比基础值 |
| `special_pair_count` | 特殊牌对基础值 |
| `curve_type` | 曲线类型 |
| `curve_amplitude` | 曲线振幅 |
| `curve_cycles` | 曲线周期 |
| `updated_at` | 更新时间 |

索引：`idx_difficulty_range (mode, start_level, end_level)`。

### `game_difficulty_levels`

小关卡实际参数表。

| 字段 | 说明 |
| --- | --- |
| `mode` | 模式 |
| `level` | 关卡号 |
| `range_id` | 来源关卡段 ID |
| `difficulty` | 小关卡难度数值 |
| `difficulty_label` | 小关卡难度标签：`easy`、`normal`、`hard` |
| `curve_factor` | 生成该关卡时使用的曲线系数 |
| `grid_w` / `grid_h` | 小关卡实际棋盘尺寸 |
| `max_layers` | 小关卡实际最大层数 |
| `min_tiles` / `max_tiles` | 小关卡实际牌数范围 |
| `chaos` | 小关卡实际混乱度 |
| `min_available_pairs` | 小关卡实际可消除对 |
| `hidden_ratio` | 小关卡实际背牌比 |
| `special_pair_count` | 小关卡实际特殊牌对 |
| `manual_override` | 是否手动覆盖，`1` 表示手动 |
| `updated_at` | 更新时间 |

主键：`(mode, level)`。

## 配置建议

- 优先调整关卡段参数和曲线，少量异常关卡再用小关卡手动覆盖。
- 如果希望一段内稳定，使用 `flat` 或较小的 `curveAmplitude`。
- 如果希望一段内逐步变难，使用 `linear` 或 `ease`。
- 如果希望一段内有起伏，使用 `wave`，通过 `curveCycles` 控制起伏次数。
- 调高难度时优先小幅增加 `maxLayers`、`minTiles`、`maxTiles`、`chaos`、`hiddenRatio`，同时谨慎降低 `minAvailablePairs`。
- 牌数必须保持偶数，否则后端会拒绝保存。
- 恢复默认配置会覆盖当前模式已有配置，操作前应确认当前数据不需要保留。
