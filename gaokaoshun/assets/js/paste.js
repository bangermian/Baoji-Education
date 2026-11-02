/**
 * 粘贴导入：把用户从网页/Excel 复制出来的表格文本解析成结构化行。
 *
 * 为什么需要这个：
 *   掌上高考的招生计划分页控件无法被脚本驱动（可信点击也不触发请求），
 *   但**人在浏览器里是能看见、能选中、能复制的**。
 *   于是把"复制 → 粘贴"变成一条正式的导入通道，绕开所有反爬限制。
 *
 * 解析规则：
 *   · 优先按制表符切（浏览器/Excel 复制出来的就是 TSV）
 *   · 没有制表符时，按 2 个以上空格切
 *   · 第一行当表头，识别列含义
 */

import { toNumber } from './utils.js';

const COLUMN_RULES = [
  ['major', /专业|专业名称/],
  ['plan', /计划|招生计划|计划数/],
  ['tuition', /学费|学制/],
  ['batch', /批次/],
  ['score', /^分数$|^成绩$/],
  ['cumulative', /累计/],
  ['count', /^人数$/],
  ['lowScore', /最低分|投档线/],
  ['lowRank', /最低位次|位次|排名/],
  ['volume', /录取人数|录取数/],
  ['year', /年份/],
];

/** 判断一行用制表符还是多空格分隔 */
function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  return line.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c !== '');
}

/**
 * @param {string} text 粘贴进来的原始文本
 * @returns {{kind:'plan'|'segment'|'score'|'unknown', header:string[], rows:Array<object>, warnings:string[]}}
 */
export function parsePastedTable(text) {
  const warnings = [];
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, ' ').trimEnd())
    .filter((l) => l.trim() !== '');

  if (lines.length < 2) {
    return { kind: 'unknown', header: [], rows: [], warnings: ['至少需要表头 + 一行数据'] };
  }

  const header = splitLine(lines[0]);
  const map = {};
  for (const [field] of COLUMN_RULES) map[field] = -1;
  header.forEach((cell, i) => {
    for (const [field, pattern] of COLUMN_RULES) {
      if (map[field] === -1 && pattern.test(cell)) { map[field] = i; return; }
    }
  });

  const hasPlan = map.plan !== -1;
  const hasSegment = map.score !== -1 && map.cumulative !== -1;
  const hasScore = map.lowScore !== -1 || map.lowRank !== -1;

  const kind = hasSegment ? 'segment' : (hasPlan ? 'plan' : (hasScore ? 'score' : 'unknown'));
  if (kind === 'unknown') {
    warnings.push(`没认出表头：${header.join(' / ')}`);
    return { kind, header, rows: [], warnings };
  }

  const rows = [];
  let bad = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitLine(lines[i]);
    if (cells.length < header.length - 1) { bad += 1; continue; }
    const cell = (field) => (map[field] >= 0 ? String(cells[map[field]] ?? '').trim() : '');

    if (kind === 'segment') {
      const score = toNumber((cell('score').match(/\d{2,3}/) || [])[0]);
      const cumulative = toNumber(cell('cumulative'));
      if (!Number.isFinite(score) || !Number.isFinite(cumulative)) { bad += 1; continue; }
      rows.push({ score, cumulative: Math.round(cumulative) });
      continue;
    }

    if (kind === 'plan') {
      const major = cell('major') || '（未命名专业）';
      const plan = toNumber(cell('plan'));
      if (!Number.isFinite(plan)) { bad += 1; continue; }
      rows.push({ major, plan: Math.round(plan) });
      continue;
    }

    const major = cell('major') || '院校最低线';
    let rawScore = cell('lowScore');
    let lowScore = toNumber(rawScore);
    let lowRank = toNumber(cell('lowRank'));

    // 网页上常见 "670/1301" 这种「分数/位次」挤在一个单元格里的写法
    const combo = String(rawScore).match(/^(\d{3}(?:\.\d+)?)\s*\/\s*(\d+)$/);
    if (combo && !Number.isFinite(lowRank)) {
      lowScore = toNumber(combo[1]);
      lowRank = toNumber(combo[2]);
    }

    if (!Number.isFinite(lowScore) && !Number.isFinite(lowRank)) { bad += 1; continue; }
    rows.push({
      major,
      lowScore: Number.isFinite(lowScore) ? lowScore : null,
      lowRank: Number.isFinite(lowRank) ? lowRank : null,
      volume: toNumber(cell('volume')) || 0,
    });
  }

  if (bad > 0) warnings.push(`跳过 ${bad} 行（列数不足或数值缺失）`);
  return { kind, header, rows, warnings };
}

/** 招生计划合计 */
export function sumPlan(rows) {
  return (rows ?? []).reduce((sum, r) => sum + (Number(r.plan) || 0), 0);
}
