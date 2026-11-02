/**
 * 通用工具函数：数值解析、格式化、DOM 小助手。
 * 这一层不依赖任何业务概念，方便单独测试。
 */

/** 保留两位小数；非数值返回 null，避免出现 NaN 到处传播 */
export function round2(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * 把 Excel 单元格转成数字。
 * 能处理 "12,345"、全角空格、首尾空白、百分比符号等常见脏数据。
 */
export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/[,，\s]/g, '');
  if (!text) return null;
  const cleaned = text.replace(/[%％]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** 整数解析，失败返回 null */
export function toInt(value) {
  const num = toNumber(value);
  return num === null ? null : Math.trunc(num);
}

/** 千分位 + 可选小数位 */
export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 位次展示：整数千分位 */
export function formatRank(value) {
  return formatNumber(value, 0);
}

/** 百分比展示，带符号 */
export function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** 防止把院校/专业名里的尖括号当 HTML 执行 */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/** 简易防抖，用于输入框实时重绘 */
export function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** 按年份升序排序（不改原数组） */
export function sortByYear(list) {
  return [...list].sort((a, b) => a.year - b.year);
}

/** 触发浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件名安全化：去掉 Windows/浏览器不允许的字符，并限制长度 */
export function safeFilename(name) {
  return String(name ?? '')
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '未命名';
}

/** 加权平均；权重全为 0 时退化为算术平均 */
export function weightedAverage(pairs) {
  let sumWeighted = 0;
  let sumWeight = 0;
  for (const [value, weight] of pairs) {
    sumWeighted += value * weight;
    sumWeight += weight;
  }
  if (sumWeight === 0) {
    if (pairs.length === 0) return null;
    return pairs.reduce((acc, [value]) => acc + value, 0) / pairs.length;
  }
  return sumWeighted / sumWeight;
}
