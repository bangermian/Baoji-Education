/**
 * 图表渲染：K 线 + 成交量 + 分差 三联图，带联动缩放。
 *
 * 视觉口径（与说明页一致）：
 *   · 个股用「位次」作图，纵轴翻转 —— 第 1 名在最上方，越靠上越难考
 *   · 大盘/板块用「热度指数」作图 —— 数值越大越难考
 *   两种模式都满足「向上 = 变难」，红色统一表示"比上一年更难"。
 */

import { COLORS, DEFAULT_MA } from './config.js';
import { movingAverage } from './aggregate.js';
import { formatNumber, round2 } from './utils.js';

const AXIS_TEXT = { color: COLORS.axis, fontSize: 11 };

/** 涨跌配色：candlestick 用 color 表示 close>open，color0 表示 close<open */
function candleColors(mode) {
  // rank 模式纵轴翻转：位次变小（更难）在视觉上是"涨"，所以此时 color0 用红
  return mode === 'rank'
    ? { color: COLORS.down, color0: COLORS.up, borderColor: COLORS.downBorder, borderColor0: COLORS.upBorder }
    : { color: COLORS.up, color0: COLORS.down, borderColor: COLORS.upBorder, borderColor0: COLORS.downBorder };
}

function baseTooltip() {
  return {
    backgroundColor: COLORS.tooltipBg,
    borderColor: COLORS.tooltipBorder,
    textStyle: { color: '#1f2329', fontSize: 12 },
    extraCssText: 'box-shadow: 0 2px 8px rgba(0,0,0,.08); border-radius: 2px;',
  };
}

export function createChartController(echarts, elements) {
  const kline = echarts.init(elements.kline, null, { renderer: 'canvas' });
  const volume = echarts.init(elements.volume, null, { renderer: 'canvas' });
  const spread = echarts.init(elements.spread, null, { renderer: 'canvas' });

  const charts = [kline, volume, spread];

  // K 线 / 成交量 之间用官方联动（tooltip + 缩放都同步）；
  // 分差图年份可能少于主图，只接收 K 线的缩放，避免错位。
  echarts.connect([kline, volume]);
  kline.on('dataZoom', (event) => {
    const batch = event.batch?.length
      ? { batch: event.batch.map((item) => ({ start: item.start, end: item.end })) }
      : { start: event.start, end: event.end };
    spread.dispatchAction({ type: 'dataZoom', ...batch });
  });

  function maPeriods(config) {
    const periods = (config ?? DEFAULT_MA).map((value) => {
      const num = Math.floor(Number(value));
      return Number.isFinite(num) && num >= 1 ? num : null;
    });
    return periods.every((value) => value !== null) ? periods : DEFAULT_MA;
  }

  function renderKline({ mode, series, title, ma, baseline, outliers }) {
    const n = series.length;
    // 均线自适应：周期超过样本量就没有意义，直接不画（旧版 DEFAULT_MA 会在 6 个点上画出 3 条空线）
    const periods = maPeriods(ma).filter((period) => period <= n);
    const dates = series.map((item) => `${item.year}年`);
    const values = series.map((item) => [item.open, item.close, item.low, item.high]);
    const colors = candleColors(mode);
    const inverse = mode === 'rank';

    const baselineByYear = new Map((baseline ?? []).map((item) => [item.year, item.rank]));
    const baselineData = baseline && baseline.length > 0
      ? series.map((item) => {
        const value = baselineByYear.get(item.year);
        return Number.isFinite(value) ? round2(value) : null;
      })
      : null;

    const legendNames = ['K线', ...periods.map((p) => `MA${p}`)];
    if (baselineData) legendNames.push('同类基准');

    const maSeries = periods.map((period, index) => ({
      name: `MA${period}`,
      type: 'line',
      data: movingAverage(series, period),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.2, color: COLORS.ma[index] ?? COLORS.ma[0] },
      itemStyle: { color: COLORS.ma[index] ?? COLORS.ma[0] },
      z: 3,
      connectNulls: false,
    }));

    const baselineSeries = baselineData
      ? [{
        name: '同类基准',
        type: 'line',
        data: baselineData,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 1, color: '#9aa0a8', type: 'dashed' },
        itemStyle: { color: '#9aa0a8' },
        z: 4,
        connectNulls: true,
      }]
      : [];

    const hardest = series.reduce((best, item) => (best === null || item.close < best.close ? item : best), null);
    const easiest = series.reduce((best, item) => (best === null || item.close > best.close ? item : best), null);

    const markPoints = [];
    if (hardest) {
      markPoints.push({
        name: '历年最难',
        coord: [dates.indexOf(`${hardest.year}年`), hardest.close],
        value: mode === 'rank' ? formatNumber(hardest.close) : hardest.close.toFixed(1),
        itemStyle: { color: COLORS.up },
        label: { fontSize: 10, color: '#fff' },
      });
    }
    if (easiest && (!hardest || easiest.year !== hardest.year)) {
      markPoints.push({
        name: '历年最易',
        coord: [dates.indexOf(`${easiest.year}年`), easiest.close],
        value: mode === 'rank' ? formatNumber(easiest.close) : easiest.close.toFixed(1),
        itemStyle: { color: COLORS.down },
        label: { fontSize: 10, color: '#fff' },
      });
    }
    // 断档 / 异常年份（同比跳变超过 3×MAD 且至少 20%）
    for (const year of outliers ?? []) {
      const index = series.findIndex((item) => item.year === year);
      if (index < 0) continue;
      markPoints.push({
        name: '异常波动',
        coord: [index, series[index].close],
        value: '断档?',
        symbol: 'pin',
        symbolSize: 38,
        itemStyle: { color: '#f39c12' },
        label: { fontSize: 9, color: '#ffffff', fontWeight: 'bold' },
      });
    }

    kline.setOption({
      backgroundColor: 'transparent',
      animation: false,
      legend: {
        top: 8,
        left: 'center',
        data: legendNames,
        textStyle: { color: COLORS.axis, fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
        icon: 'roundRect',
      },
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#c9cdd4' }, crossStyle: { color: '#c9cdd4' } },
        formatter: (params) => formatKlineTooltip(params, series, mode, baselineByYear),
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: { left: 64, right: 24, top: 44, bottom: 28 },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: COLORS.grid } },
        axisLabel: AXIS_TEXT,
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        scale: true,
        inverse,
        // 上下各留 8% 空白：否则最高/最低那根 K 线会贴边被裁掉一半，
        // 顶部的标注图钉（markPoint）也会溢出画布。
        min: (v) => {
          const pad = (v.max - v.min) * 0.08 || Math.abs(v.max) * 0.02 || 1;
          return v.min - pad;
        },
        max: (v) => {
          const pad = (v.max - v.min) * 0.08 || Math.abs(v.max) * 0.02 || 1;
          return v.max + pad;
        },
        axisLine: { show: false },
        axisLabel: {
          ...AXIS_TEXT,
          formatter: (value) => (mode === 'rank' ? formatNumber(value) : value.toFixed(1)),
        },
        splitLine: { lineStyle: { color: COLORS.grid, type: 'dashed' } },
        name: mode === 'rank' ? '位次' : '热度',
        nameTextStyle: { color: COLORS.axis, fontSize: 11, align: 'right' },
      },
      dataZoom: [{ type: 'inside', xAxisIndex: [0], start: 0, end: 100, zoomOnMouseWheel: true }],
      // 标题由页面顶部的行情条承担，图内不再重复
      graphic: [],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: values,
          itemStyle: colors,
          barWidth: 10,
          markPoint: {
            symbol: 'pin',
            symbolSize: 42,
            label: { fontSize: 10, color: '#fff' },
            data: markPoints,
          },
          z: 2,
        },
        ...maSeries,
        ...baselineSeries,
      ],
    }, true);
  }

  function renderVolume({ series }) {
    const dates = series.map((item) => `${item.year}年`);
    const values = series.map((item) => item.volume ?? 0);
    const colors = series.map((item, index) => {
      if (index === 0) return COLORS.neutral;
      const prev = series[index - 1].volume ?? 0;
      return item.volume > prev ? COLORS.up : item.volume < prev ? COLORS.down : COLORS.neutral;
    });

    volume.setOption({
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (params) => {
          const index = params?.[0]?.dataIndex ?? 0;
          const item = series[index];
          if (!item) return '';
          const prev = index > 0 ? series[index - 1].volume ?? 0 : null;
          const delta = prev === null ? null : item.volume - prev;
          const lines = [`<b>${item.year} 年</b>`, `招生人数：${formatNumber(item.volume)} 人`];
          if (delta !== null) {
            const sign = delta > 0 ? '+' : '';
            const color = delta > 0 ? COLORS.up : delta < 0 ? COLORS.down : COLORS.neutral;
            lines.push(`较上年：<span style="color:${color}">${sign}${formatNumber(delta)} 人</span>`);
          }
          return lines.join('<br/>');
        },
      },
      grid: { left: 64, right: 24, top: 12, bottom: 6 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: COLORS.grid } },
        axisLabel: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        // 柱子顶部也要留白，否则最高的那根会顶到框线、数值标签被切
        max: (v) => (v.max > 0 ? Math.ceil(v.max * 1.12) : 10),
        axisLine: { show: false },
        axisLabel: { ...AXIS_TEXT, fontSize: 10, formatter: (value) => formatNumber(value) },
        splitLine: { lineStyle: { color: COLORS.grid, type: 'dashed' } },
        name: '招生',
        nameTextStyle: { color: COLORS.axis, fontSize: 10, align: 'right' },
      },
      dataZoom: [{ type: 'inside', xAxisIndex: [0], start: 0, end: 100 }],
      series: [{
        name: '招生人数',
        type: 'bar',
        data: values.map((value, index) => ({ value, itemStyle: { color: colors[index] } })),
        barWidth: 12,
      }],
    }, true);
  }

  function renderSpread({ series }) {
    // 优先用稳健分差 P10–P90；老数据没有分位数时回退到 max−min
    const hasQuantiles = series.some((item) => Number.isFinite(item.p10Score) && Number.isFinite(item.p90Score));
    const rows = series.filter((item) => (hasQuantiles
      ? Number.isFinite(item.p10Score) && Number.isFinite(item.p90Score)
      : Number.isFinite(item.maxScore) && Number.isFinite(item.minScore)));
    if (rows.length === 0) {
      spread.clear();
      return false;
    }

    const dates = rows.map((item) => `${item.year}年`);
    const lows = rows.map((item) => (hasQuantiles ? item.p10Score : item.minScore));
    const diffs = rows.map((item) => (hasQuantiles
      ? round2(item.p90Score - item.p10Score)
      : round2(item.maxScore - item.minScore)));
    const colors = rows.map((item, index) => {
      if (index === 0) return COLORS.neutral;
      const prevDiff = diffs[index - 1];
      return diffs[index] > prevDiff ? COLORS.up : diffs[index] < prevDiff ? COLORS.down : COLORS.neutral;
    });

    const allLow = Math.min(...lows);
    const allHigh = Math.max(...rows.map((item) => (hasQuantiles ? item.p90Score : item.maxScore)));
    const pad = Math.max(4, Math.round((allHigh - allLow) * 0.12));

    spread.setOption({
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        formatter: (params) => {
          const index = params?.[0]?.dataIndex ?? 0;
          const item = rows[index];
          if (!item) return '';
          return [
            `<b>${item.year} 年</b>`,
            `最高专业最低分：${item.maxScore ?? '-'}`,
            `最低专业最低分：${item.minScore ?? '-'}`,
            `分差：${diffs[index]} 分`,
          ].join('<br/>');
        },
      },
      grid: { left: 64, right: 24, top: 12, bottom: 6 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: COLORS.grid } },
        axisLabel: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        min: 0,
        axisLine: { show: false },
        axisLabel: { ...AXIS_TEXT, fontSize: 10 },
        splitLine: { lineStyle: { color: COLORS.grid, type: 'dashed' } },
        name: '分差',
        nameTextStyle: { color: COLORS.axis, fontSize: 10, align: 'right' },
      },
      dataZoom: [{ type: 'inside', xAxisIndex: [0], start: 0, end: 100 }],
      series: [
        {
          name: '分差',
          type: 'bar',
          data: diffs.map((value, index) => ({ value, itemStyle: { color: colors[index] } })),
          barWidth: 14,
          itemStyle: { borderRadius: [2, 2, 0, 0] },
          label: {
            show: true,
            position: 'top',
            formatter: (params) => `${params.value}`,
            color: COLORS.axis,
            fontSize: 10,
          },
        },
      ],
    }, true);
    return true;
  }

  function formatKlineTooltip(params, series, mode, baselineByYear) {
    const index = params?.[0]?.dataIndex ?? 0;
    const item = series[index];
    if (!item) return '';
    const rows = [`<b>${item.year} 年</b>`];

    if (mode === 'rank') {
      rows.push(`开盘位次：${formatNumber(item.open)}`);
      rows.push(`收盘位次：${formatNumber(item.close)}（各专业录取线加权平均）`);
      rows.push(`录取线区间：${formatNumber(item.best ?? item.low)} ~ ${formatNumber(item.worst ?? item.high)}（最难专业 ~ 最易专业）`);
      if (Number.isFinite(item.percentile)) {
        const suffix = item.percentileEstimated ? '（估算考生数）' : '';
        rows.push(`全省百分位：${item.percentile.toFixed(2)}%${suffix}`);
      }
      const baselineRank = baselineByYear?.get(item.year);
      if (Number.isFinite(baselineRank)) {
        rows.push(`同类基准位次：${formatNumber(baselineRank)}`);
      }
    } else {
      rows.push(`热度指数：<b>${item.close.toFixed(2)}</b>`);
      if (Number.isFinite(item.percentile)) rows.push(`加权平均百分位：${item.percentile.toFixed(2)}%`);
      if (Number.isFinite(item.schools)) rows.push(`样本院校：${item.schools} 所`);
      if (item.estimatedShare > 0) rows.push(`其中 ${item.estimatedShare}% 的样本缺考生数（按 7 万估算）`);
    }

    rows.push(`招生人数：${formatNumber(item.volume)} 人${item.lowSample ? '（样本偏少）' : ''}`);
    if (Number.isFinite(item.difficulty)) {
      rows.push(`录取率估计：<b>${item.difficulty.toFixed(2)}%</b>（招生 ÷ 位次）`);
    }
    if (Number.isFinite(item.maxHighScore)) rows.push(`最高分：${item.maxHighScore}`);
    if (Number.isFinite(item.p10Score) && Number.isFinite(item.p90Score)) {
      rows.push(`专业最低分 P10–P90：${item.p10Score} – ${item.p90Score}（分差 ${item.spread}）`);
    } else {
      if (Number.isFinite(item.maxScore)) rows.push(`最高专业最低分：${item.maxScore}`);
      if (Number.isFinite(item.minScore)) rows.push(`最低专业最低分：${item.minScore}`);
    }
    return rows.join('<br/>');
  }

  /** 渲染全部；返回分差图是否有数据（用于决定是否收起该图） */
  function render({ mode, series, title, ma, baseline, outliers }) {
    if (!series || series.length === 0) {
      charts.forEach((chart) => chart.clear());
      return { hasSpread: false };
    }
    renderKline({ mode, series, title, ma, baseline, outliers });
    renderVolume({ series });
    const hasSpread = renderSpread({ series });
    return { hasSpread };
  }

  function clear() {
    charts.forEach((chart) => chart.clear());
  }

  function resize() {
    charts.forEach((chart) => chart.resize());
  }

  return { render, clear, resize, kline, volume, spread };
}
