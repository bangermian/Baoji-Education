/**
 * 聚合计算：专业记录 → 院校年度 K 线。
 *
 * 口径（与 help.html 的公式一致）：
 *   专业平均位次 = (最高位次 + 最低位次) / 2
 *   院校收盘位次 = Σ(专业平均位次 × 该专业录取人数) / Σ(录取人数)
 *   开盘位次     = 上一年的收盘位次（首年为当年收盘）
 *   上下影线     = 当年所有专业里最好 / 最差的位次
 *   百分位       = 收盘位次 / 该省当年考生数 × 100
 *
 * 百分位是跨省可比的量纲，指数层只聚合百分位，不再直接平均位次。
 */

import { DEFAULT_CANDIDATES } from './config.js';
import { round2, sortByYear } from './utils.js';

/**
 * 按年度聚合某个院校的全部专业记录。
 * @param {Record<string, Array<object>>} majors 专业名 → 记录数组
 * @returns {Array<object>} 按年份升序
 */
export function yearlyAggregate(majors) {
  const byYear = new Map();

  for (const records of Object.values(majors ?? {})) {
    for (const record of records) {
      const year = record.year;
      if (!Number.isFinite(year)) continue;

      let acc = byYear.get(year);
      if (!acc) {
        acc = {
          sumWeightedRank: 0,
          weight: 0,
          volume: 0,
          best: Infinity,
          worst: -Infinity,
          maxLowScore: null,
          minLowScore: null,
          maxHighScore: null,
          lowScores: [],
        };
        byYear.set(year, acc);
      }

      const volume = Number(record.volume) || 0;
      const weight = volume > 0 ? volume : 1;
      // 收盘位次 = 该专业的**录取线（最低位次）**。
      // 早先用过 (最高位次+最低位次)/2，但掌上高考只公开最低位次，
      // 有最高位次的数据会系统性偏"难"约 11%，两套口径混在一起就没法比了。
      const cutoffRank = record.lowRank;

      acc.sumWeightedRank += cutoffRank * weight;
      acc.weight += weight;
      acc.volume += volume;

      // 影线 = 全校各专业录取线的跨度：上沿最难专业、下沿最易专业。
      // 早先用 highRank 当上沿，但它只对少数有公开数据的学校存在，
      // 为了保证每所学校口径一致，上下沿都用录取线。
      if (Number.isFinite(cutoffRank)) {
        acc.best = Math.min(acc.best, cutoffRank);
        acc.worst = Math.max(acc.worst, cutoffRank);
      }

      if (Number.isFinite(record.lowScore)) {
        acc.maxLowScore = acc.maxLowScore === null ? record.lowScore : Math.max(acc.maxLowScore, record.lowScore);
        acc.minLowScore = acc.minLowScore === null ? record.lowScore : Math.min(acc.minLowScore, record.lowScore);
        acc.lowScores.push(record.lowScore);
      }
      if (Number.isFinite(record.highScore)) {
        acc.maxHighScore = acc.maxHighScore === null ? record.highScore : Math.max(acc.maxHighScore, record.highScore);
      }
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, acc]) => {
      const close = acc.weight > 0 ? round2(acc.sumWeightedRank / acc.weight) : 0;
      const best = Number.isFinite(acc.best) ? acc.best : close;
      const worst = Number.isFinite(acc.worst) ? acc.worst : close;

      // 稳健分差：用 P10–P90 代替 max−min，避免"专业数量多则极差大"的可比性问题
      const sortedScores = [...acc.lowScores].sort((a, b) => a - b);
      const p10 = quantile(sortedScores, 0.1);
      const p90 = quantile(sortedScores, 0.9);
      const spread = p10 !== null && p90 !== null ? round2(p90 - p10) : null;

      return {
        year,
        close,
        best,
        worst,
        volume: acc.volume,
        maxScore: acc.maxLowScore,
        minScore: acc.minLowScore,
        maxHighScore: acc.maxHighScore,
        p10Score: p10,
        p90Score: p90,
        spread,
        // 录取率估计 ≈ 招生人数 / 位次：同时控制扩招缩招与考生规模
        difficulty: close > 0 ? round2((acc.volume / close) * 100) : null,
      };
    });
}

/**
 * 线性插值分位数（与 Excel 的 PERCENTILE.INC 同口径）。
 * @param {number[]} sorted 已升序排列
 */
export function quantile(sorted, q) {
  if (!sorted || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return round2(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
}

/**
 * 给每年补上百分位。
 * 缺少考生数时用默认值估算，并打上 estimated 标记（界面上会提示）。
 * @param {Array<object>} years yearlyAggregate 的结果
 * @param {Record<string|number, number>} candidatesByYear 该省逐年考生数
 */
export function attachPercentiles(years, candidatesByYear = {}) {
  return years.map((item) => {
    const declared = candidatesByYear?.[item.year];
    const candidates = declared > 0 ? declared : DEFAULT_CANDIDATES;
    return {
      ...item,
      candidates,
      percentile: item.close > 0 ? round2((item.close / candidates) * 100) : null,
      percentileEstimated: !(declared > 0),
    };
  });
}

/**
 * 给年度聚合结果补上 open / low / high，得到可直接喂给 ECharts 的 K 线数据。
 *
 * 注意：位次"越小越难"，best 是数值最小的位次。ECharts 的 candlestick 要求
 * low ≤ high（纯数值比较），所以这里让 low 取四者最小值、high 取最大值，
 * 视觉方向由 yAxis.inverse 负责。
 */
export function toCandles(series) {
  const sorted = sortByYear(series ?? []);
  return sorted.map((item, index) => {
    const open = index === 0 ? item.close : sorted[index - 1].close;
    const best = item.best ?? item.close;
    const worst = item.worst ?? item.close;
    return {
      year: item.year,
      open,
      close: item.close,
      low: Math.min(open, item.close, best),
      high: Math.max(open, item.close, worst),
      best,
      worst,
      volume: item.volume ?? 0,
      maxScore: item.maxScore ?? null,
      minScore: item.minScore ?? null,
      maxHighScore: item.maxHighScore ?? null,
      percentile: item.percentile ?? null,
      percentileEstimated: Boolean(item.percentileEstimated),
      candidates: item.candidates ?? null,
      p10Score: item.p10Score ?? null,
      p90Score: item.p90Score ?? null,
      spread: item.spread ?? null,
      difficulty: item.difficulty ?? null,
      lowSample: (item.volume ?? 0) > 0 && (item.volume ?? 0) < 20,
    };
  });
}

/**
 * 断档 / 异常年份检测（稳健方法）。
 *
 * 用同比变化率的中位数做中心、MAD 做尺度：
 *   MAD = median(|x - median(x)|)，标准化尺度 1.4826 × MAD
 *   |x - median| > max(3 × 1.4826 × MAD, 20%) 视为异常
 *
 * 之所以不用均值±3σ：均值与标准差本身会被那个异常值拽走（掩蔽效应）。
 * @param {Array<{year:number, close:number}>} candles
 * @returns {{flagged:Set<number>, changes:Array<{year:number, change:number, z:number}>}}
 */
export function detectOutliers(candles) {
  const changes = [];
  for (let i = 1; i < (candles?.length ?? 0); i += 1) {
    const prev = candles[i - 1].close;
    if (!prev) continue;
    changes.push({ year: candles[i].year, change: (candles[i].close - prev) / prev });
  }

  const flagged = new Set();
  if (changes.length < 3) return { flagged, changes };

  const sorted = changes.map((c) => c.change).sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const deviations = changes.map((c) => Math.abs(c.change - median)).sort((a, b) => a - b);
  const mad = quantile(deviations, 0.5);
  const scale = 1.4826 * mad;
  const threshold = Math.max(3 * scale, 0.2); // 至少 20% 的同比跳动才算异常

  for (const item of changes) {
    item.z = scale > 0 ? round2(Math.abs(item.change - median) / scale) : null;
    if (Math.abs(item.change - median) > threshold) flagged.add(item.year);
  }
  return { flagged, changes };
}

/**
 * 专业字典 → 院校整体 K 线
 * @param {object} majors
 * @param {Record<string|number, number>} candidatesByYear
 */
export function buildSchoolSeries(majors, candidatesByYear = {}) {
  return toCandles(attachPercentiles(yearlyAggregate(majors), candidatesByYear));
}

/** 单个专业 → K 线 */
export function buildMajorSeries(records, candidatesByYear = {}) {
  const yearly = sortByYear(records ?? []).map((record) => {
    const close = round2(record.lowRank);
    return {
      year: record.year,
      close,
      best: record.lowRank,
      worst: record.lowRank,
      volume: record.volume ?? 0,
      maxScore: record.lowScore ?? null,
      minScore: record.lowScore ?? null,
      maxHighScore: record.highScore ?? null,
      // 单专业没有"校内分差"可言
      spread: null,
      p10Score: null,
      p90Score: null,
      difficulty: close > 0 ? round2(((record.volume ?? 0) / close) * 100) : null,
    };
  });
  return toCandles(attachPercentiles(yearly, candidatesByYear));
}

/**
 * 移动平均。前 n-1 个点用 '-' 占位，保持与横轴等长（ECharts 会跳过）。
 */
export function movingAverage(data, period) {
  const window = Math.max(1, Math.floor(period));
  const result = new Array(data.length).fill('-');
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i].close;
    if (i >= window) sum -= data[i - window].close;
    if (i >= window - 1) result[i] = round2(sum / window);
  }
  return result;
}

/** 年度涨跌（位次变化）。 */
export function changeOfLatest(candles) {
  if (!candles || candles.length === 0) return null;
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!prev || !prev.close) return { latest, prev: null, delta: 0, percent: null, direction: 'flat' };
  const delta = round2(latest.close - prev.close);
  const percent = round2((delta / prev.close) * 100);
  const direction = delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  return { latest, prev, delta, percent, direction };
}

/** 波动率：年度涨跌幅的标准差（越小越稳定），用于给"稳定性"排序 */
export function volatility(candles) {
  const changes = [];
  for (let i = 1; i < (candles?.length ?? 0); i += 1) {
    const prev = candles[i - 1].close;
    if (!prev) continue;
    changes.push((candles[i].close - prev) / prev);
  }
  if (changes.length < 2) return null;
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / (changes.length - 1);
  return round2(Math.sqrt(variance) * 100);
}
