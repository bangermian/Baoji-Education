/**
 * 指数计算：把个股 K 线聚合成大盘 / 板块指数。
 *
 * 核心口径（这是本次算法优化的重点）：
 *   位次的绝对值**跨省不可比**（天津第 10000 名和北京第 10000 名不是一回事），
 *   所以先把每所院校每年的位次换算成**该省的百分位**，再按招生人数加权平均，
 *   最后取热度 = 100 - 平均百分位。这样不同省份、不同考生规模的学校才能放进同一个指数。
 *
 *   旧版直接对原始位次做加权平均，再除以一个游客数，跨省合并时量纲是错的。
 */

import { PLATES, platesOf, REGIONS } from './config.js';
import { round2 } from './utils.js';

function emptyAcc() {
  return {
    weightedPercentile: 0,
    weight: 0,
    volume: 0,
    minPercentile: Infinity,
    maxPercentile: -Infinity,
    estimated: 0,
    total: 0,
    locations: new Set(),
  };
}

/** 单次遍历建立聚合桶：分组 × 板块 × 年份 */
function buildBuckets(schools) {
  const byLocation = new Map();
  const byProvince = new Map();

  const add = (store, groupKey, plate, candle, province) => {
    if (!Number.isFinite(candle.percentile)) return;

    let group = store.get(groupKey);
    if (!group) { group = new Map(); store.set(groupKey, group); }
    let plates = group.get(plate);
    if (!plates) { plates = new Map(); group.set(plate, plates); }
    let acc = plates.get(candle.year);
    if (!acc) { acc = emptyAcc(); plates.set(candle.year, acc); }

    const volume = candle.volume ?? 0;
    const weight = volume > 0 ? volume : 1;

    acc.weightedPercentile += candle.percentile * weight;
    acc.weight += weight;
    acc.volume += volume;
    acc.minPercentile = Math.min(acc.minPercentile, candle.percentile);
    acc.maxPercentile = Math.max(acc.maxPercentile, candle.percentile);
    acc.total += 1;
    if (candle.percentileEstimated) acc.estimated += 1;
    acc.locations.add(province);
  };

  for (const school of Object.values(schools)) {
    const location = school.location || '待定';
    // 板块是标签：985/211 同时属于 92 和双一流，两个桶都要进
    const tags = platesOf(school.plate);
    for (const candle of school.series ?? []) {
      add(byLocation, location, 'all', candle, school.province);
      add(byProvince, school.province, 'all', candle, school.province);
      for (const tag of tags) {
        add(byLocation, location, tag, candle, school.province);
        add(byProvince, school.province, tag, candle, school.province);
      }
    }
  }

  return { byLocation, byProvince };
}

/** 合并同一分组键集合、某板块、某一年的桶 */
function mergeBuckets(store, groupKeys, plate, year) {
  const merged = emptyAcc();
  for (const key of groupKeys) {
    const acc = store.get(key)?.get(plate)?.get(year);
    if (!acc) continue;
    merged.weightedPercentile += acc.weightedPercentile;
    merged.weight += acc.weight;
    merged.volume += acc.volume;
    merged.minPercentile = Math.min(merged.minPercentile, acc.minPercentile);
    merged.maxPercentile = Math.max(merged.maxPercentile, acc.maxPercentile);
    merged.estimated += acc.estimated;
    merged.total += acc.total;
    for (const province of acc.locations) merged.locations.add(province);
  }
  return merged;
}

/** 该分组集合在某板块下出现过的年份 */
function collectYears(store, groupKeys, plate) {
  const years = new Set();
  for (const key of groupKeys) {
    const plateMap = store.get(key)?.get(plate);
    if (!plateMap) continue;
    for (const year of plateMap.keys()) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/** 加权百分位 → 展示序列（热度空间：数值越大越难） */
function toIndexItem(year, merged) {
  if (merged.weight <= 0) return null;
  const percentile = round2(merged.weightedPercentile / merged.weight);
  if (percentile === null) return null;

  return {
    year,
    // 热度 = 100 - 百分位；best/worst 供 K 线上/下影线使用（注意热度方向与百分位相反）
    close: round2(100 - percentile),
    best: round2(100 - merged.maxPercentile),
    worst: round2(100 - merged.minPercentile),
    volume: merged.volume,
    percentile,
    schools: merged.total,
    estimatedShare: merged.total > 0 ? round2((merged.estimated / merged.total) * 100) : 0,
    provinces: [...merged.locations].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  };
}

function buildSeries(store, groupKeys, plate) {
  const series = [];
  for (const year of collectYears(store, groupKeys, plate)) {
    const merged = mergeBuckets(store, groupKeys, plate, year);
    const item = toIndexItem(year, merged);
    if (item) series.push(item);
  }
  return series;
}

/**
 * 计算全部大盘 / 板块指数。
 * @param {{schools:object}} state
 * @param {string[]} extraLocations 额外需要生成板块键的地点
 */
export function computeIndices(state, extraLocations = []) {
  const { byLocation, byProvince } = buildBuckets(state.schools);
  const market = {};
  const plate = {};

  // 大盘：按学校所在地聚合到区域
  for (const [regionKey, provinces] of Object.entries(REGIONS)) {
    market[regionKey] = {
      key: regionKey,
      mode: 'heat',
      data: buildSeries(byLocation, provinces, 'all'),
    };
  }

  // 区域 × 板块（按招生省份归组，便于回答"某板块在某大区的表现"）
  for (const [regionKey, provinces] of Object.entries(REGIONS)) {
    for (const plateKey of PLATES) {
      plate[`${regionKey}_${plateKey}`] = {
        key: `${regionKey}_${plateKey}`,
        mode: 'heat',
        data: buildSeries(byProvince, provinces, plateKey),
      };
    }
  }

  // 地点 × (板块 | 全部)：回答"某地高校整体热度"
  const locations = new Set([...byLocation.keys(), ...extraLocations]);
  for (const location of locations) {
    for (const plateKey of ['all', ...PLATES]) {
      plate[`loc_${location}_${plateKey}`] = {
        key: `loc_${location}_${plateKey}`,
        mode: 'heat',
        data: buildSeries(byLocation, [location], plateKey),
      };
    }
  }

  // 基准线：同省 × 同板块的平均百分位，用于算"个股相对同类强弱"
  const benchmarks = {};
  for (const province of byProvince.keys()) {
    for (const plateKey of ['all', ...PLATES]) {
      benchmarks[`${province}|${plateKey}`] = buildSeries(byProvince, [province], plateKey);
    }
  }

  return { market, plate, benchmarks };
}

/** 该指数是否有数据 */
export function hasSeries(entry) {
  return Boolean(entry && Array.isArray(entry.data) && entry.data.length > 0);
}
