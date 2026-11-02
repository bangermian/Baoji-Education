/**
 * 全局配置：区域划分、板块枚举、配色、默认参数。
 * 所有"业务口径"都集中在这里，改阈值/配色/省市归属只需要动这一个文件。
 */

/** 区域 → 省份。用于大盘指数聚合与城市归属（键名即 <option> 的 value） */
export const REGIONS = {
  east: ['北京', '天津', '上海', '江苏', '浙江', '福建', '广东'],
  jiaodong: ['山东'],
  central: ['河北', '河南', '湖北', '湖南', '江西', '安徽'],
  southwest: ['四川', '重庆', '云南', '贵州'],
  beibuwan: ['广西', '海南'],
  northeast: ['黑龙江', '吉林', '辽宁'],
  northwest: ['陕西', '山西'],
};

export const REGION_LABELS = {
  east: '东部指数',
  jiaodong: '胶东指数',
  central: '中部指数',
  southwest: '西南指数',
  beibuwan: '北部湾指数',
  northeast: '东北指数',
  northwest: '西北指数',
};

/**
 * 省份 → 所属区域。找不到就返回 null（比如「待定」或没登记的省份）。
 * @param {string} province
 * @returns {string|null}
 */
export function regionOfProvince(province) {
  const name = String(province ?? '').trim();
  if (!name) return null;
  for (const [region, list] of Object.entries(REGIONS)) {
    if (list.includes(name)) return region;
  }
  return null;
}

/** 区域 → 它包含的省份（未知区域返回空数组） */
export function provincesOfRegion(region) {
  return REGIONS[region] ?? [];
}

/** 院校板块枚举，顺序即下拉顺序 */
export const PLATES = ['92', 'doublefirst', 'newresearch', 's11', 'shuangfei'];

export const PLATE_LABELS = {
  92: '92板块',
  doublefirst: '双一流板块',
  newresearch: '新型研究型大学板块',
  s11: 'S11中外合办板块',
  shuangfei: '双非板块',
};

/** 文件名里板块字段的别名 → 规范键；未命中时回落到 shuangfei（与旧版一致） */
export const PLATE_ALIASES = {
  92: '92',
  doublefirst: 'doublefirst',
  newresearch: 'newresearch',
  s11: 's11',
  shuangfei: 'shuangfei',
};

/**
 * 板块是**标签**，不是单选。
 *
 * 985/211 院校本来就属于「双一流」。如果只打一个 92 标签，
 * 用户选「双一流」时这些学校会全部消失——这正是旧版的 bug。
 * 这里把单个板块值展开成它应有的全部标签。
 *
 * @param {string} plate 数据里写的板块
 * @returns {string[]} 该院校归属的板块标签（至少一个）
 */
export function platesOf(plate) {
  switch (String(plate ?? '').toLowerCase()) {
    case '92':
      return ['92', 'doublefirst'];
    case 'doublefirst':
      return ['doublefirst'];
    case 'newresearch':
      return ['newresearch', 'doublefirst'];
    case 's11':
      return ['s11'];
    case 'shuangfei':
      return ['shuangfei'];
    default:
      return ['shuangfei'];
  }
}

export const COLORS = {
  up: '#e02b2b',
  upBorder: '#b71c1c',
  down: '#12a05c',
  downBorder: '#0a7a45',
  neutral: '#8f959e',
  ma: ['#f2a33c', '#8e6bd6', '#2f7fd0', '#17a2a2'],
  axis: '#8f959e',
  grid: '#eef0f3',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e3e5e8',
};

/** 均线默认周期 */
export const DEFAULT_MA = [5, 10, 20, 30];

/** 文件名缺失考生数时的兜底值（仅用于把位次换算成百分位） */
export const DEFAULT_CANDIDATES = 70000;

/** 允许加载的数据文件扩展名 */
export const ACCEPTED_EXT = /\.(xlsx|xls|csv)$/i;

/** 指数口径说明：个股以"位次"作图（纵轴翻转，越小越难）；指数以"热度"作图（越大越难） */
export const SERIES_MODE = {
  rank: 'rank',
  heat: 'heat',
  spread: 'spread',
  volume: 'volume',
};

export const STORAGE = {
  dbName: 'gaokaoshun',
  storeName: 'snapshots',
  key: 'latest',
  /** 数据结构版本：不一致时直接丢弃旧缓存，避免解析出诡异数据 */
  schemaVersion: 3,
};
