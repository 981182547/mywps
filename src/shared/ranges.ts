// 页码范围解析：支持 "1-3,5,8-"、"-3"、"5-3"（倒序），兼容中文逗号与各种横线

export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

function normalize(input: string): string {
  return input
    .replace(/[，、；;]/g, ',')
    .replace(/[—–－~～至到]/g, '-')
    .replace(/\s+/g, '')
}

function toPage(token: string, pageCount: number, raw: string): number {
  if (!/^\d+$/.test(token)) throw new UserError(`页码范围“${raw}”格式不正确`)
  const n = Number(token)
  if (n < 1 || n > pageCount) {
    throw new UserError(`页码 ${n} 超出范围（文件共 ${pageCount} 页）`)
  }
  return n
}

/** 解析单个片段，返回 0 起始的页索引 */
function parseSegment(seg: string, pageCount: number): number[] {
  const dash = seg.indexOf('-')
  if (dash === -1) return [toPage(seg, pageCount, seg) - 1]
  if (seg.indexOf('-', dash + 1) !== -1) throw new UserError(`页码范围“${seg}”格式不正确`)
  const left = seg.slice(0, dash)
  const right = seg.slice(dash + 1)
  const start = left === '' ? 1 : toPage(left, pageCount, seg)
  const end = right === '' ? pageCount : toPage(right, pageCount, seg)
  const out: number[] = []
  const step = start <= end ? 1 : -1
  for (let p = start; step > 0 ? p <= end : p >= end; p += step) out.push(p - 1)
  return out
}

/** 按逗号分组解析，每组对应一个片段 */
export function parseRangeGroups(input: string, pageCount: number): number[][] {
  const text = normalize(input)
  if (text === '') throw new UserError('请填写页码范围')
  const segs = text.split(',').filter((s) => s !== '')
  if (segs.length === 0) throw new UserError('请填写页码范围')
  return segs.map((s) => parseSegment(s, pageCount))
}

/** 解析为扁平的页索引列表；空字符串表示全部页面 */
export function parseRanges(input: string | undefined, pageCount: number): number[] {
  if (!input || normalize(input) === '') return Array.from({ length: pageCount }, (_, i) => i)
  return parseRangeGroups(input, pageCount).flat()
}
