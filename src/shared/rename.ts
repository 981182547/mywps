// 批量重命名规则：界面预览与引擎校验共用

export interface RenameRule {
  /** 名称模板：{name} 原文件名，{n} 序号，{date} 修改日期 */
  template: string
  start: number
  digits: number
  find: string
  replace: string
  /** 扩展名大小写 */
  extCase: 'keep' | 'lower' | 'upper'
}

export interface RenameSource {
  name: string
  mtime?: number
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function splitName(name: string): [string, string] {
  const i = name.lastIndexOf('.')
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']
}

function fmtDate(ms?: number): string {
  const d = ms ? new Date(ms) : new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export function applyRule(files: RenameSource[], rule: RenameRule): string[] {
  return files.map((f, i) => {
    let [base, ext] = splitName(f.name)
    if (rule.find) base = base.split(rule.find).join(rule.replace)
    const n = String(rule.start + i).padStart(Math.max(1, Math.min(8, rule.digits)), '0')
    const tpl = rule.template.trim() || '{name}'
    let out = tpl.replace(/\{name\}/g, base).replace(/\{n\}/g, n).replace(/\{date\}/g, fmtDate(f.mtime))
    if (rule.extCase === 'lower') ext = ext.toLowerCase()
    if (rule.extCase === 'upper') ext = ext.toUpperCase()
    out = out.trim()
    return out + ext
  })
}

/** 检查单个新文件名是否合法，返回问题描述 */
export function nameProblem(name: string): string | null {
  const [base] = splitName(name)
  if (!base.trim() || name.startsWith('.')) return '文件名不能为空'
  if (ILLEGAL.test(name)) return '包含不允许的字符 \\ / : * ? " < > |'
  if (RESERVED.test(base)) return '这是系统保留名称'
  if (/[. ]$/.test(name)) return '不能以空格或句点结尾'
  if (name.length > 200) return '文件名太长'
  return null
}

/**
 * 检查一组改名是否冲突（同一文件夹内新名称重复，忽略大小写以兼容 Windows）。
 * 返回与输入等长的问题列表。
 */
export function findConflicts(dirs: string[], newNames: string[]): (string | null)[] {
  const seen = new Map<string, number>()
  newNames.forEach((n, i) => {
    const key = `${dirs[i]}\u0000${n.toLowerCase()}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  })
  return newNames.map((n, i) => nameProblem(n) ?? ((seen.get(`${dirs[i]}\u0000${n.toLowerCase()}`) ?? 0) > 1 ? '与其他文件的新名称重复' : null))
}
